# 매칭 필터 강도 차등화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평수/신축/인프라 3개 조건의 순위(1~3위)별 필터 강도를 차등화한다 — 1순위는 하드필터, 2순위는 소프트필터(향후 완화 사다리에서 해제 가능), 3순위는 정렬 가중치만. `get_matches`, `get_solo_preview`, `/adjust` 라이브 프리뷰 3곳에 일관되게 적용한다.

**Architecture:** SQL 공유 헬퍼 `_priority_hard_ok(pid, satisfied, relieve_priority_2 default false)`를 새로 만들고 `get_matches`/`get_solo_preview`에 `passed` CTE로 연결한다. `/adjust` 페이지엔 동등한 TS 헬퍼 `priorityHardOk`를 추가해 클라이언트 라이브 프리뷰가 서버 계산과 일치하게 만든다.

**Tech Stack:** Supabase Postgres(plpgsql), Next.js App Router, TypeScript.

## Global Constraints

- 조건 종류(area_size/build_year/infra)·순위(1~3, `participant_conditions.priority`) 스키마는 변경 없음 — 설계 스펙(`docs/superpowers/specs/2026-07-22-priority-filter-tiering-design.md`) §배경
- `_priority_hard_ok(pid, satisfied, relieve_priority_2 default false)`: `relieve_priority_2=false`면 1·2순위 조건이 모두 충족돼야 true. `relieve_priority_2=true`(이번 스코프에서는 호출부 없음, 향후 서브2가 씀)면 1순위만 검사 — 같은 스펙 §아키텍처
- `get_matches`: `candidate_count`는 기존처럼 예산+통근 통과 기준(`cand`) 유지, `match_count`/`matches`만 새 `passed`(하드필터 통과) 기준으로 바뀐다 — `candidate_count`는 Mixpanel 계측에만 쓰여 화면 분기에 영향 없음(이미 확인됨)
- `get_solo_preview`: A 혼자 기준으로 동일한 `_priority_hard_ok` 필터 적용
- `/adjust` 페이지의 `priorityHardOk`는 이번 스코프에서 항상 기본값(미해제)으로만 호출 — 라이브 프리뷰는 완화 사다리를 반영하지 않음
- 정렬 가중치(`_priority_score`/`priorityWeight`)는 변경하지 않는다
- **이 저장소엔 자동화 테스트 러너가 없다.** SQL 마이그레이션은 로컬 Supabase 스택(Docker 미설치로 사용 불가) 대신 원격 프로젝트(`urijib`, ref `kvhsviugkbvrjdkfhlra`, 이미 `supabase link` 완료)에 `supabase db push`로 직접 적용하고, 실제 세션을 만들어 RPC를 REST로 호출해 검증한다. 프론트는 `npx tsc --noEmit` + `npm run lint` + 개발 서버 확인으로 대체한다.

---

## 파일 구조

- **Create** `supabase/migrations/20260722010000_priority_hard_filter.sql` — `_priority_hard_ok` 헬퍼 + `get_matches`/`get_solo_preview` 재정의(`create or replace`, 기존 함수 시그니처 그대로라 하위 호환).
- **Modify** `src/app/s/[id]/adjust/page.tsx` — `priorityHardOk` TS 헬퍼 추가 + `passing` useMemo에 필터 추가.

---

### Task 1: SQL — `_priority_hard_ok` 헬퍼 + `get_matches`/`get_solo_preview` 재정의

**Files:**
- Create: `supabase/migrations/20260722010000_priority_hard_filter.sql`

**Interfaces:**
- Produces: `public._priority_hard_ok(pid uuid, satisfied jsonb, relieve_priority_2 boolean default false) returns boolean` — Task 3(통합 검증)와 향후 서브프로젝트 2가 이 함수를 그대로 재사용한다. `get_matches`/`get_solo_preview`의 JSON 응답 스키마(필드명)는 변경 없음 — 기존 프론트 타입(`MatchResult`, `SoloPreviewResult`)과 호환.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260722010000_priority_hard_filter.sql`:

```sql
-- =============================================================
-- 콜드 스테이션 회복 v2(docs/cold-station-recovery-spec-v2.md) 서브프로젝트 1.
-- 평수/신축/인프라 3개 조건의 순위(1~3)별 필터 강도를 차등화한다:
--   1순위 = 하드필터, 2순위 = 소프트필터(추후 완화 사다리에서 해제 대상),
--   3순위 = 정렬 가중치만(필터 없음, 기존 _priority_score 그대로).
-- relieve_priority_2 파라미터는 이번 스코프에서 쓰지 않는다(항상 기본값 false로
-- 호출) — 다음 서브프로젝트(완화 사다리)의 "2순위 해제" 단계가 true로 재호출해
-- 같은 로직을 재사용한다.
-- =============================================================
create or replace function public._priority_hard_ok(
  pid uuid, satisfied jsonb, relieve_priority_2 boolean default false
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority <= (case when relieve_priority_2 then 1 else 2 end)
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;

-- =============================================================
-- get_matches: cand(예산+통근 하드필터 통과) 뒤에 passed(순위 하드필터 통과)를
-- 다시 도입한다. candidate_count는 cand 기준 그대로, match_count/matches만
-- passed 기준으로 바뀐다. 정렬(_priority_score 합산)은 기존 그대로.
-- =============================================================
create or replace function public.get_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  low_budget bigint;
  result jsonb;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  if a_p.id is null or b_p.id is null
     or a_p.completed_at is null or b_p.completed_at is null then
    raise exception '아직 두 사람 모두 조건 입력을 마치지 않았어요';
  end if;

  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);

  with cand as (
    select * from public._session_candidates(sid) c
    where a_p.budget_max_krw is null or c.avg_price_krw <= low_budget
  ),
  passed as (
    select c.* from cand c
    where public._priority_hard_ok(a_p.id, c.satisfied)
      and public._priority_hard_ok(b_p.id, c.satisfied)
  )
  select jsonb_build_object(
    'ready', true,
    'priorities', jsonb_build_object(
      'a', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
            from public.participant_conditions where participant_id = a_p.id),
      'b', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
            from public.participant_conditions where participant_id = b_p.id)
    ),
    'budget', jsonb_build_object(
      'a_budget_krw', a_p.budget_max_krw,
      'b_budget_krw', b_p.budget_max_krw,
      'applied_krw', low_budget,
      'conflict', a_p.budget_max_krw is distinct from b_p.budget_max_krw
    ),
    'candidate_count', (select count(*) from cand),
    'match_count', (select count(*) from passed),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'sigungu', p.sigungu,
        'avg_price_krw', p.avg_price_krw,
        'a_minutes', p.a_minutes, 'b_minutes', p.b_minutes,
        'lat', p.lat, 'lng', p.lng,
        'satisfied', p.satisfied
      ) order by
        public._priority_score(a_p.id, p.satisfied) + public._priority_score(b_p.id, p.satisfied) desc,
        (p.a_minutes + p.b_minutes) asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- =============================================================
-- get_solo_preview: A 혼자 기준으로 동일한 순위 하드필터 적용.
-- =============================================================
create or replace function public.get_solo_preview(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  result jsonb;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';

  if a_p.id is null or a_p.completed_at is null then
    raise exception '아직 본인 조건 입력을 마치지 않았어요';
  end if;

  with cand as (
    select
      ar.code, ar.name, ar.sigungu, st.avg_price_krw, ca.minutes as a_minutes,
      ar.lat, ar.lng,
      jsonb_build_object(
        'area_size', coalesce(st.size_59_ok, false),
        'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
        'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
      ) as satisfied
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3)
    where ca.minutes <= a_p.commute_max_min
      and (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw)
  ),
  passed as (
    select c.* from cand c
    where public._priority_hard_ok(a_p.id, c.satisfied)
  )
  select jsonb_build_object(
    'priorities', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
                   from public.participant_conditions where participant_id = a_p.id),
    'budget_krw', a_p.budget_max_krw,
    'candidate_count', (select count(*) from cand),
    'match_count', (select count(*) from passed),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'sigungu', p.sigungu,
        'avg_price_krw', p.avg_price_krw,
        'a_minutes', p.a_minutes,
        'lat', p.lat, 'lng', p.lng,
        'satisfied', p.satisfied
      ) order by
        public._priority_score(a_p.id, p.satisfied) desc,
        p.a_minutes asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;
```

- [ ] **Step 2: 원격 프로젝트에 배포**

Run: `cd /Users/dowon/urijib && supabase db push`
Expected: `20260722010000_priority_hard_filter.sql`가 원격(`kvhsviugkbvrjdkfhlra`)에 적용됐다는 출력. 실패 시 SQL 문법 에러를 먼저 고친다(원격 DB이므로 신중하게 diff를 확인하고 적용).

- [ ] **Step 3: 배포 확인**

Run: `supabase migration list`
Expected: `20260722010000`이 local과 remote 양쪽에 나타남.

- [ ] **Step 4: 실제 세션으로 하드필터 동작 검증**

Node 스크립트로 실제 세션을 만들어 검증한다. `.env.local`에서 환경변수를 읽고, `create_session`/`join_session` RPC로 A/B를 만든 뒤:
1. A와 B의 `participant_conditions`에 순위를 의도적으로 다르게 넣는다(예: A는 `infra`를 1순위로, B는 `area_size`를 1순위로) — 두 조건이 동시에 하드필터가 되는 케이스를 만든다.
2. `get_matches` RPC를 호출해 `candidate_count >= match_count`인지, `matches` 배열의 모든 원소가 `satisfied.infra === true`이고 `satisfied.area_size === true`인지(1순위 필터) 직접 검사한다.
3. `get_solo_preview`도 A 하나만으로 동일하게 호출해 A의 1순위 조건이 필터링되는지 확인한다.
4. 확인 후 `supabase.from('sessions').delete().eq('id', sessionId)`로 테스트 세션을 정리한다(스크립트 자체는 커밋하지 않음 — scratchpad에서만 실행).

Expected: `matches` 배열의 모든 원소가 A·B 각각의 1순위 조건을 만족함. 콘솔 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260722010000_priority_hard_filter.sql
git commit -m "추가: 순위 기반 매칭 필터 강도 차등화(1순위 하드/2순위 소프트/3순위 가중치)"
```

---

### Task 2: `/adjust` 페이지 — TS `priorityHardOk` 헬퍼 + 라이브 프리뷰 필터

**Files:**
- Modify: `src/app/s/[id]/adjust/page.tsx`

**Interfaces:**
- Consumes: 없음(Task 1의 SQL 변경과 독립적으로 동작 — `data.candidates`는 여전히 `get_adjust_data`가 필터링 없이 내려주는 원시 후보 목록)
- Produces: 없음(페이지 내부 전용 헬퍼)

- [ ] **Step 1: `priorityHardOk` 헬퍼 추가**

`src/app/s/[id]/adjust/page.tsx`의 `priorityWeight` 함수(58-61행) 바로 아래에 추가:

```ts
// get_matches의 _priority_hard_ok(SQL)와 동일한 규칙 — 1·2순위 조건이 전부
// 충족돼야 통과. relievePriority2는 이 페이지에서는 항상 기본값(false)으로만
// 쓴다(라이브 프리뷰는 완화 사다리를 반영하지 않음).
function priorityHardOk(order: string[], satisfied: Record<string, boolean>, relievePriority2 = false) {
  const threshold = relievePriority2 ? 1 : 2
  return order.slice(0, threshold).every((code) => satisfied[code])
}
```

- [ ] **Step 2: `passing` useMemo에 필터 추가**

308-320행의 `passing` useMemo를 다음으로 바꾼다:

```tsx
  const passing = useMemo(() => {
    if (!data) return []
    return data.candidates
      .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budgetValue)
      .filter((c) => priorityHardOk(aOrder, c.satisfied) && priorityHardOk(bOrder, c.satisfied))
      .map((c) => {
        const score = CODES.reduce((sum, code) => {
          if (!c.satisfied[code]) return sum
          return sum + priorityWeight(aOrder, code) + priorityWeight(bOrder, code)
        }, 0)
        return { ...c, score }
      })
      .sort((x, y) => y.score - x.score || x.a_minutes + x.b_minutes - (y.a_minutes + y.b_minutes))
  }, [data, aOrder, bOrder, budgetValue])
```

- [ ] **Step 3: 타입 체크 + lint**

Run: `npx tsc --noEmit`
Expected: 에러 0건

Run: `npm run lint`
Expected: 이 파일에서 새 에러 없음(기존에 무관한 파일에 있던 사전 존재 오류는 무시)

- [ ] **Step 4: Commit**

```bash
git add 'src/app/s/[id]/adjust/page.tsx'
git commit -m "변경: 조율 화면 라이브 프리뷰에 순위 하드필터 반영"
```

---

### Task 3: 통합 검증 — get_matches와 `/adjust` 라이브 프리뷰 일관성 확인

**Files:** 없음(코드 변경 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`(이미 떠 있는 인스턴스가 있으면 그걸 사용)

- [ ] **Step 2: 실제 세션으로 `/adjust` 페이지 시나리오 확인**

Task 1에서 만든 것과 같은 방식으로(순위가 서로 다른 A/B) 세션을 만들고 `/s/{id}/adjust`에 접속한다. 화면에 표시되는 "N곳" 카운트가 `get_matches`가 반환하는 `match_count`와 일치하는지 확인한다(순위를 드래그로 바꿔보면서 카운트 변화가 즉시 반영되는지도 함께 확인).

- [ ] **Step 3: 회귀 확인 — 결과 화면**

같은 세션의 `/s/{id}/result`에 접속해 정상적으로 렌더링되는지 확인한다(이전 세션에서 만든 `ResultConcessionPanel`/`ConcessionAreaCard`는 `get_concession_matches`를 쓰므로 이번 변경과 무관하지만, `get_matches` 응답 스키마가 그대로인지 화면이 깨지지 않는지로 간접 확인한다).

- [ ] **Step 4: 테스트 세션 정리**

Run: 검증에 쓴 세션을 `sessions` 테이블에서 삭제(service role key로).

---

## Self-Review 체크리스트 (실행 전 참고용)

- **스펙 커버리지**: `_priority_hard_ok` 헬퍼(Task 1) / `get_matches`·`get_solo_preview` 적용(Task 1) / `/adjust` 페이지 적용(Task 2) / 통합 검증(Task 3) — 설계 스펙의 "변경 대상 3곳" 전부 커버됨.
- **플레이스홀더 없음**: 모든 스텝에 실제 SQL/TS 코드와 명령어 포함.
- **타입 일관성**: `_priority_hard_ok(pid uuid, satisfied jsonb, relieve_priority_2 boolean default false)` 시그니처가 Task 1 전체에서 동일하게 쓰임. TS `priorityHardOk(order, satisfied, relievePriority2=false)`도 SQL과 파라미터 의미가 1:1로 대응.
- **롤백 경로**: 원격에 직접 배포하므로, Step 4(실제 세션 검증)에서 문제가 발견되면 `get_matches`/`get_solo_preview`를 이전 버전(20260721020000의 정의)으로 되돌리는 `create or replace` 마이그레이션을 추가로 작성해 재배포한다 — 별도 롤백 스크립트를 미리 만들어두지 않고, 필요 시 그 자리에서 대응한다(스펙 문서에 이전 버전 SQL이 전문 남아있어 참조 가능).
