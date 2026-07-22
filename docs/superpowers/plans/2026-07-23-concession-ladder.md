# 완화 사다리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_concession_matches`를 5단계(0~4, 예산 단계는 기본/상한 2회 시도라 실제 최대 6회) 누적 완화 사다리로 재작성하고, 그 결과를 소비하는 프론트 4개 파일(`concession-copy.ts`/`result-concession-panel.tsx`/`result-map-sheet.tsx`/`adjust/page.tsx`)을 새 스키마에 맞춰 갱신한다. 사다리 단계별 진단 문구·태그도 이번에 정확히 반영한다("조금 더 양보하면" 접기 섹션 UI만 서브3으로 남김).

**Architecture:** SQL 헬퍼 `_concession_ladder_step`(서브1의 `_priority_hard_ok` 재사용)을 파라미터만 바꿔 최대 7번 호출하는 순차 사다리. 1곳 이상이면 멈추고, 3곳 미만이면 다음 단계를 1회 더 실행해 차집합으로 `extra`에 담는다. 응답은 `{ main, extra }` 구조.

**Tech Stack:** Supabase Postgres(plpgsql), Next.js App Router, TypeScript.

## Global Constraints

- 설계 스펙: `docs/superpowers/specs/2026-07-22-concession-ladder-design.md` — 사다리 파라미터표, 정렬 공식, 응답 스키마는 이 문서 그대로.
- 통근·예산 완화는 개인별 병목 판별(`a_target`/`b_target`, 기존 로직) 유지 — 병목 아닌 사람에게는 폭을 넓혀도 실효 없음(원래 상한 그대로 적용됨).
- 사다리 파라미터(누적식, `step`은 UI 노출 번호로 4a/4b 모두 4):
  | idx | step | commute_widen | budget_widen | relieve |
  |---|---|---|---|---|
  | 0 | 0 | 0 | 0 | false |
  | 1 | 1 | 5 | 0 | false |
  | 2 | 2 | 5 | 0 | true |
  | 3 | 3 | 15 | 0 | true |
  | 4 | 4 | 15 | 80000000 | true |
  | 5 | 4 | 15 | 160000000 | true |
- 정렬: `sort_score = (4 - (a_violations+b_violations))*10 - abs(a_violations-b_violations) + (_priority_score(A)+_priority_score(B))`
- `extra.total_count`는 차집합 크기와 같다(사다리가 누적식이라 다음 단계 후보 집합이 항상 메인 단계의 상위집합이므로 `다음단계 total_count - 메인 total_count`로 정확히 계산됨, 코드별 대조 불필요).
- `extra.areas`는 다음 단계의 상위 10개 중 메인 `areas`에 없는 code만(차집합).
- **이 저장소엔 자동화 테스트 러너가 없다.** SQL은 서브1과 동일하게 원격 프로덕션(project ref `kvhsviugkbvrjdkfhlra`, 이미 linked)에 `supabase db push`로 직접 배포하고 실세션으로 검증한다(Docker 미설치로 로컬 스택 불가, 이미 사용자 승인됨). 프론트는 `npx tsc --noEmit` + `npm run lint` + 개발 서버 확인으로 대체.
- 진단 문구·태그(스펙 §4 표 그대로):

  | ladder_step | 태그 | 진단 메시지 |
  |---|---|---|
  | 0 | 없음(null) | "두 분 조건이 거의 맞았어요" |
  | 1 | "폭 넓힘" | "출퇴근 폭을 조금 넓혀 찾아봤어요" |
  | 2 | "2순위 내려놓음" | "두 분의 2순위 조건을 잠시 내려놓고 찾아봤어요" |
  | 3 | "폭 넓힘" | "출퇴근 조건이 가장 멀었어요. 그만큼 폭을 넓혀 찾아봤어요" |
  | 4 | "예산 폭 넓힘" | "예산 범위를 조금 넓혀 찾아봤어요" |
  | null(실패) | — | "폭을 많이 넓혀도 맞는 동네를 찾기 어려웠어요." |
- Repo 컨벤션: 한국어 커밋 메시지

---

## 파일 구조

- **Create** `supabase/migrations/20260723000000_concession_ladder.sql` — `_concession_ladder_step` 헬퍼 + `get_concession_matches` 전면 재작성.
- **Modify** `src/lib/concession-copy.ts` — 타입 전면 교체(`main`/`extra` 구조) + `buildConcessionCopy` 재작성.
- **Modify** `src/components/result-concession-panel.tsx` — `giveTag` prop 추가, "서로 양보" 띠 노출 조건 변경.
- **Modify** `src/components/result-map-sheet.tsx` — `concession.areas`/`total_count` 참조를 `concession.main.*`로, `ResultConcessionPanel`에 `giveTag` 전달.
- **Modify** `src/app/s/[id]/adjust/page.tsx` — `budgetRecommendation` 계산을 새 스키마(`concession.main.give.a/b`, `field` 대신 `budget_widen_krw`)로.

---

### Task 1: SQL — `_concession_ladder_step` 헬퍼 + `get_concession_matches` 재작성

**Files:**
- Create: `supabase/migrations/20260723000000_concession_ladder.sql`

**Interfaces:**
- Produces: `public._concession_ladder_step(sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint, relieve_a2 boolean, relieve_b2 boolean) returns jsonb` — `{ areas: jsonb[], total_count: bigint }`. `get_concession_matches(sid uuid) returns jsonb` — `{ main: {...}, extra: {...} | null }`(정확한 형태는 아래 Step 1 코드 참고). Task 2가 이 JSON 형태 그대로 TypeScript 타입을 정의한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260723000000_concession_ladder.sql`:

```sql
-- =============================================================
-- 콜드 스테이션 회복 v2(docs/cold-station-recovery-spec-v2.md) 서브프로젝트 2.
-- get_concession_matches를 누적 완화 사다리로 재작성한다. 각 단계는 동일한
-- 판정 함수(_concession_ladder_step)를 파라미터만 바꿔 재호출한다(새 엔진
-- 불필요 — 스펙 §3). 순위 하드필터는 서브1의 _priority_hard_ok를 그대로 쓴다.
-- =============================================================

-- =============================================================
-- _concession_ladder_step: 사다리 한 단계의 후보를 계산한다. 통근/예산은
-- widen_min/widen_budget만큼 넓힌 범위로 판정하되, a_target/b_target이 그
-- 필드일 때만 실효를 갖는다(병목 아닌 사람은 넓혀도 원래 상한 그대로).
-- 순위(1·2순위) 하드필터는 relieve_a2/relieve_b2로 2순위 해제 여부를 받는다.
-- =============================================================
create or replace function public._concession_ladder_step(
  sid uuid,
  a_target text,        -- 'commute' | 'budget' | null(양보 불필요)
  b_target text,
  widen_min int,
  widen_budget bigint,
  relieve_a2 boolean,
  relieve_b2 boolean
) returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  areas_json jsonb;
  total_count bigint;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select
      ar.code, ar.name, ar.sigungu, ar.lat, ar.lng, st.avg_price_krw,
      ca.minutes as a_minutes, cb.minutes as b_minutes,
      jsonb_build_object(
        'area_size', coalesce(st.size_59_ok, false),
        'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
        'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
      ) as satisfied
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = (select key from a_origin)
    join public.commute_cache cb
      on cb.area_code = ar.code and cb.mode = b_p.transport_mode
     and cb.origin_key = (select key from b_origin)
    where
      (case when a_target = 'commute' then ca.minutes <= a_p.commute_max_min + widen_min
            else ca.minutes <= a_p.commute_max_min end)
      and (case when a_target = 'budget' then (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw + widen_budget)
                else (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw) end)
      and (case when b_target = 'commute' then cb.minutes <= b_p.commute_max_min + widen_min
            else cb.minutes <= b_p.commute_max_min end)
      and (case when b_target = 'budget' then (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw + widen_budget)
                else (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw) end)
  ),
  eligible as (
    select b.* from base b
    where public._priority_hard_ok(a_p.id, b.satisfied, relieve_a2)
      and public._priority_hard_ok(b_p.id, b.satisfied, relieve_b2)
  ),
  scored as (
    select
      e.*,
      public._priority_score(a_p.id, e.satisfied) + public._priority_score(b_p.id, e.satisfied) as priority_score,
      (e.a_minutes > a_p.commute_max_min)::int
        + (a_p.budget_max_krw is not null and e.avg_price_krw > a_p.budget_max_krw)::int as a_violations,
      (e.b_minutes > b_p.commute_max_min)::int
        + (b_p.budget_max_krw is not null and e.avg_price_krw > b_p.budget_max_krw)::int as b_violations
    from eligible e
  ),
  ranked as (
    select *,
      (4 - (a_violations + b_violations)) * 10
        - abs(a_violations - b_violations)
        + priority_score as sort_score
    from scored
  )
  select
    coalesce(jsonb_agg(x.obj order by x.rnk) filter (where x.rnk <= 10), '[]'::jsonb),
    count(*)
  into areas_json, total_count
  from (
    select
      jsonb_build_object(
        'code', r.code, 'name', r.name, 'sigungu', r.sigungu, 'lat', r.lat, 'lng', r.lng,
        'avg_price_krw', r.avg_price_krw, 'a_minutes', r.a_minutes, 'b_minutes', r.b_minutes,
        'satisfied', r.satisfied, 'a_violations', r.a_violations, 'b_violations', r.b_violations
      ) as obj,
      row_number() over (order by r.sort_score desc, (r.a_minutes + r.b_minutes) asc) as rnk
    from ranked r
  ) x;

  return jsonb_build_object('areas', areas_json, 'total_count', coalesce(total_count, 0));
end $$;

-- =============================================================
-- get_concession_matches: 사다리 순차 실행(1곳 이상이면 멈춤) + 3곳 미만이면
-- 다음 단계를 opt-in "extra"로 1회 더 계산(메인과 겹치는 지역은 차집합 제외).
-- =============================================================
create or replace function public.get_concession_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;

  a_commute_fail bigint;
  a_budget_fail bigint;
  b_commute_fail bigint;
  b_budget_fail bigint;
  a_target text;
  b_target text;

  a_relieved_code text;
  b_relieved_code text;

  steps jsonb;
  step_count int;
  i int;
  step jsonb;
  step_result jsonb;
  next_step jsonb;
  next_result jsonb;

  main jsonb;
  extra jsonb;
  main_codes text[];
  extra_areas jsonb;
  extra_total bigint;

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

  -- ===== 1) 병목 판별(원래 상한 기준) — 서브1 이전부터 있던 로직 그대로 =====
  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select ar.code, st.avg_price_krw, ca.minutes as a_minutes, cb.minutes as b_minutes
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = (select key from a_origin)
    join public.commute_cache cb
      on cb.area_code = ar.code and cb.mode = b_p.transport_mode
     and cb.origin_key = (select key from b_origin)
  )
  select
    count(*) filter (where a_minutes > a_p.commute_max_min),
    count(*) filter (where a_p.budget_max_krw is not null and avg_price_krw > a_p.budget_max_krw),
    count(*) filter (where b_minutes > b_p.commute_max_min),
    count(*) filter (where b_p.budget_max_krw is not null and avg_price_krw > b_p.budget_max_krw)
  into a_commute_fail, a_budget_fail, b_commute_fail, b_budget_fail
  from base;

  a_target := case
    when a_commute_fail = 0 and a_budget_fail = 0 then null
    when a_commute_fail >= a_budget_fail then 'commute'
    else 'budget'
  end;
  b_target := case
    when b_commute_fail = 0 and b_budget_fail = 0 then null
    when b_commute_fail >= b_budget_fail then 'commute'
    else 'budget'
  end;

  select condition_code into a_relieved_code
    from public.participant_conditions where participant_id = a_p.id and priority = 2;
  select condition_code into b_relieved_code
    from public.participant_conditions where participant_id = b_p.id and priority = 2;

  -- ===== 2) 사다리 단계 정의(누적식). step은 UI 노출 번호(4a/4b 모두 4) =====
  steps := jsonb_build_array(
    jsonb_build_object('step', 0, 'commute_widen', 0,  'budget_widen', 0,         'relieve', false),
    jsonb_build_object('step', 1, 'commute_widen', 5,  'budget_widen', 0,         'relieve', false),
    jsonb_build_object('step', 2, 'commute_widen', 5,  'budget_widen', 0,         'relieve', true),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 0,         'relieve', true),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 80000000,  'relieve', true),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve', true)
  );
  step_count := jsonb_array_length(steps);

  main := null;
  extra := null;

  -- ===== 3) 순차 실행, 첫 성공(total_count>=1)에서 멈춘다 =====
  for i in 0..step_count - 1 loop
    step := steps -> i;
    step_result := public._concession_ladder_step(
      sid, a_target, b_target,
      (step ->> 'commute_widen')::int,
      (step ->> 'budget_widen')::bigint,
      (step ->> 'relieve')::boolean,
      (step ->> 'relieve')::boolean
    );

    if (step_result ->> 'total_count')::bigint >= 1 then
      main := jsonb_build_object(
        'ladder_step', (step ->> 'step')::int,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when (step ->> 'relieve')::boolean then a_relieved_code else null end
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when (step ->> 'relieve')::boolean then b_relieved_code else null end
          )
        ),
        'areas', step_result -> 'areas',
        'total_count', step_result -> 'total_count'
      );

      -- ===== 4) 3곳 미만이고 다음 단계가 있으면 opt-in extra(차집합) 계산 =====
      if (step_result ->> 'total_count')::bigint < 3 and i + 1 < step_count then
        next_step := steps -> (i + 1);
        next_result := public._concession_ladder_step(
          sid, a_target, b_target,
          (next_step ->> 'commute_widen')::int,
          (next_step ->> 'budget_widen')::bigint,
          (next_step ->> 'relieve')::boolean,
          (next_step ->> 'relieve')::boolean
        );

        select coalesce(array_agg(a ->> 'code'), '{}') into main_codes
        from jsonb_array_elements(main -> 'areas') a;

        select coalesce(jsonb_agg(a), '[]'::jsonb) into extra_areas
        from jsonb_array_elements(next_result -> 'areas') a
        where not (a ->> 'code' = any(main_codes));

        -- 사다리가 누적식이라 다음 단계 후보 집합은 항상 메인 단계의
        -- 상위집합이므로, 전체 개수 차이가 곧 차집합 크기와 같다.
        extra_total := (next_result ->> 'total_count')::bigint - (main ->> 'total_count')::bigint;

        extra := jsonb_build_object(
          'ladder_step', (next_step ->> 'step')::int,
          'give', jsonb_build_object(
            'a', jsonb_build_object(
              'commute_widen_min', case when a_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when a_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', case when (next_step ->> 'relieve')::boolean then a_relieved_code else null end
            ),
            'b', jsonb_build_object(
              'commute_widen_min', case when b_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when b_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', case when (next_step ->> 'relieve')::boolean then b_relieved_code else null end
            )
          ),
          'areas', extra_areas,
          'total_count', extra_total
        );
      end if;

      exit;
    end if;

    if i = step_count - 1 then
      -- 마지막 단계까지 전부 0곳 — ladder_step은 null(실패)로 남긴다.
      -- 프론트는 실패 시 areas/give를 쓰지 않는다(팁카드+조율 버튼만 노출).
      main := jsonb_build_object(
        'ladder_step', null,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when (step ->> 'relieve')::boolean then a_relieved_code else null end
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when (step ->> 'relieve')::boolean then b_relieved_code else null end
          )
        ),
        'areas', '[]'::jsonb,
        'total_count', 0
      );
    end if;
  end loop;

  result := jsonb_build_object('main', main, 'extra', extra);
  return result;
end $$;
```

- [ ] **Step 2: 원격 프로젝트에 배포**

Run: `cd /Users/dowon/urijib && supabase db push`
Expected: `20260723000000_concession_ladder.sql`가 원격(`kvhsviugkbvrjdkfhlra`)에 적용됐다는 출력.

- [ ] **Step 3: 배포 확인**

Run: `supabase migration list`
Expected: `20260723000000`이 local과 remote 양쪽에 나타남.

- [ ] **Step 4: 실제 세션으로 사다리 동작 검증**

`.env.local`을 워크트리에 복사하고(메인 저장소에서), Node+playwright로 실제 세션을 만들어
검증한다(서브1 검증 스크립트와 동일한 패턴 — `create_session`/`join_session` RPC로 A/B 생성,
REST PATCH로 `participants`에 좌표/통근상한/예산/`commute_batch_done_at` 직접 세팅,
`participant_conditions`에 순위 세팅).

최소 3가지 시나리오를 확인한다:
1. **0단계에서 즉시 성공**: 통근·예산 상한을 넉넉하게 주되 두 사람의 1·2순위 조건이
   겹치지 않게 설정해 필수 교집합만으로 0곳이 되도록 만듦 → `get_concession_matches` 호출 →
   `main.ladder_step`이 0 이상 어느 한 단계에서 멈추는지, `total_count >= 1`인지, `give.a`/`give.b`가
   해당 단계 파라미터와 일치하는지 확인.
2. **여러 단계를 거쳐 성공 + extra 발생**: 통근 상한을 매우 타이트하게 줘서 0~3단계까지
   0곳이 나오다가 4단계(예산)에서 살아나는 시나리오를 만들고, 만약 그 시점 `total_count < 3`이면
   `extra`가 채워지는지, `extra.areas`에 `main.areas`와 겹치는 code가 없는지 확인.
3. **전부 실패**: 통근·예산 상한을 극단적으로 타이트하게 줘서 6단계 모두 0곳이 되게 만들고
   `main.ladder_step === null`, `main.areas === []`, `extra === null`인지 확인.

각 시나리오 후 테스트 세션은 반드시 삭제한다. 검증 스크립트는 커밋하지 않는다(scratch).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723000000_concession_ladder.sql
git commit -m "추가: get_concession_matches를 완화 사다리로 재작성"
```

---

### Task 2: `concession-copy.ts` — 새 스키마 타입 + `buildConcessionCopy` 재작성

**Files:**
- Modify: `src/lib/concession-copy.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ConcessionGiveSide {
    commute_widen_min: number
    budget_widen_krw: number
    relieved_condition: string | null
  }
  export interface ConcessionArea {
    code: string; name: string; sigungu: string
    lat: number | null; lng: number | null
    avg_price_krw: number | null
    a_minutes: number; b_minutes: number
    satisfied: Record<string, boolean>
    a_violations: number; b_violations: number
  }
  export interface ConcessionLadderResult {
    ladder_step: 0 | 1 | 2 | 3 | 4 | null
    give: { a: ConcessionGiveSide; b: ConcessionGiveSide }
    areas: ConcessionArea[]
    total_count: number
  }
  export interface ConcessionMatchResult {
    main: ConcessionLadderResult
    extra: ConcessionLadderResult | null
  }
  export function buildConcessionCopy(result: ConcessionMatchResult): {
    message: string; giveDetail: string; giveTag: string | null; tipTitle: string; tipBody: string
  }
  ```
  Task 3·4·5가 이 타입과 `buildConcessionCopy`의 반환 형태(특히 새로 추가된 `giveTag`)를 그대로 소비한다.

- [ ] **Step 1: 파일 전체 교체**

`src/lib/concession-copy.ts`:

```ts
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'

export interface ConcessionGiveSide {
  commute_widen_min: number
  budget_widen_krw: number
  relieved_condition: string | null
}

export interface ConcessionArea {
  code: string
  name: string
  sigungu: string
  lat: number | null
  lng: number | null
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  satisfied: Record<string, boolean>
  a_violations: number
  b_violations: number
}

export interface ConcessionLadderResult {
  ladder_step: 0 | 1 | 2 | 3 | 4 | null
  give: { a: ConcessionGiveSide; b: ConcessionGiveSide }
  areas: ConcessionArea[]
  total_count: number
}

// get_concession_matches 응답 — main은 항상 존재(실패해도 ladder_step=null로
// areas=[]인 상태로 옴), extra는 main이 3곳 미만일 때만 채워진다.
export interface ConcessionMatchResult {
  main: ConcessionLadderResult
  extra: ConcessionLadderResult | null
}

function giveText(side: ConcessionGiveSide, role: 'A' | 'B'): string | null {
  const parts: string[] = []
  if (side.relieved_condition) {
    parts.push(`${role} ${CONDITION_LABEL[side.relieved_condition] ?? side.relieved_condition} 내려놓음`)
  }
  if (side.commute_widen_min > 0) parts.push(`${role} +${side.commute_widen_min}분`)
  if (side.budget_widen_krw > 0) parts.push(`${role} +${formatEok(side.budget_widen_krw)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

const STEP_MESSAGE: Record<number, string> = {
  0: '두 분 조건이 거의 맞았어요',
  1: '출퇴근 폭을 조금 넓혀 찾아봤어요',
  2: '두 분의 2순위 조건을 잠시 내려놓고 찾아봤어요',
  3: '출퇴근 조건이 가장 멀었어요. 그만큼 폭을 넓혀 찾아봤어요',
  4: '예산 범위를 조금 넓혀 찾아봤어요',
}

const STEP_TAG: Record<number, string | null> = {
  0: null,
  1: '폭 넓힘',
  2: '2순위 내려놓음',
  3: '폭 넓힘',
  4: '예산 폭 넓힘',
}

// get_concession_matches 응답을 ResultConcessionPanel이 바로 쓸 수 있는
// 카피(문구)로 변환한다. PRD §시스템 역할 경계 원칙("B가 양보하세요류의
// 처방적 메시지는 금지")에 따라 원인만 설명하고 특정 role에게 행동을
// 지시하지 않는다.
export function buildConcessionCopy(result: ConcessionMatchResult) {
  const { main } = result

  if (main.ladder_step == null) {
    return {
      message: '폭을 많이 넓혀도 맞는 동네를 찾기 어려웠어요.',
      giveDetail: '',
      giveTag: null,
      tipTitle: '이렇게 조정해보세요',
      tipBody: '조건이나 우선순위를 조정하면 맞는 동네가 나올 수 있어요.',
    }
  }

  const giveParts = [giveText(main.give.a, 'A'), giveText(main.give.b, 'B')].filter(
    (v): v is string => v != null
  )
  const giveDetail =
    giveParts.length > 0 ? giveParts.join(' · ') : '조건을 조율하면 새로 열리는 동네를 여기서 보여드려요'

  return {
    message: STEP_MESSAGE[main.ladder_step],
    giveDetail,
    giveTag: STEP_TAG[main.ladder_step],
    tipTitle: '이렇게 조정해보세요',
    tipBody: '',
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 이 파일 자체는 에러 없음. `result-map-sheet.tsx`/`adjust/page.tsx`에서 아직 옛 스키마를 참조해
타입 에러가 나는 게 정상(Task 3·4·5에서 해소).

- [ ] **Step 3: Commit**

```bash
git add src/lib/concession-copy.ts
git commit -m "변경: concession-copy가 완화 사다리 새 응답 스키마를 쓰도록 재작성"
```

---

### Task 3: `ResultConcessionPanel` — `giveTag` prop 추가

**Files:**
- Modify: `src/components/result-concession-panel.tsx`

**Interfaces:**
- Consumes: `buildConcessionCopy`의 `giveTag: string | null` (Task 2)
- Produces: `ResultConcessionPanelProps.giveTag: string | null` — Task 4가 `concessionCopy?.giveTag ?? null`을 그대로 전달한다.

- [ ] **Step 1: props에 `giveTag` 추가**

`src/components/result-concession-panel.tsx`의 `ResultConcessionPanelProps` 인터페이스(9-28행)에서
`giveDetail: string,` 다음 줄에 추가:

```ts
  // "서로 양보" 요약 줄의 배지 텍스트("폭 넓힘"/"2순위 내려놓음"/"예산 폭 넓힘").
  // null이면 양보 없이 이미 열린 상태(사다리 0단계)라 배지 자체를 숨긴다.
  giveTag: string | null
```

함수 파라미터 구조분해(37-47행)에도 `giveTag,`를 `giveDetail,` 다음 줄에 추가.

- [ ] **Step 2: "서로 양보" 띠 노출 조건 변경**

67행의 `{!isZero && (` 을 `{!isZero && giveTag != null && (` 로 바꾼다.

76행의 하드코딩된 텍스트:
```tsx
                  폭 넓힘
```
를 동적 값으로 바꾼다:
```tsx
                  {giveTag}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `result-map-sheet.tsx`에서 `giveTag` prop 누락으로 인한 타입 에러(정상 — Task 4에서 해소). 이 파일 자체는 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/components/result-concession-panel.tsx
git commit -m "변경: ResultConcessionPanel에 giveTag prop 추가, 0단계엔 서로양보 띠 숨김"
```

---

### Task 4: `result-map-sheet.tsx` — 새 스키마 연결

**Files:**
- Modify: `src/components/result-map-sheet.tsx`

**Interfaces:**
- Consumes: `ConcessionMatchResult`(Task 2, `main`/`extra` 구조), `buildConcessionCopy`(Task 2, `giveTag` 포함), `ResultConcessionPanelProps.giveTag`(Task 3)
- Produces: 없음(최종 연결 지점)

- [ ] **Step 1: `concessionHoods` 빌드 로직에서 `concession.areas` → `concession.main.areas`**

345-358행:

```tsx
  // 서로 양보(AB) 단일안 후보 — get_concession_matches가 계산해둔 순위 그대로 쓴다.
  const aBudgetMaxKrw = participants?.find((p) => p.role === 'A')?.budget_max_krw ?? null
  const bBudgetMaxKrw = participants?.find((p) => p.role === 'B')?.budget_max_krw ?? null
  const concessionHoods: ConcessionAreaData[] = (concession?.main.areas ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    sigungu: a.sigungu,
    lat: a.lat ?? undefined,
    lng: a.lng ?? undefined,
    benefitTags: computeBenefitTags(
      { avg_price_krw: a.avg_price_krw, satisfied: a.satisfied },
      { aBudgetMaxKrw, bBudgetMaxKrw }
    ),
  }))
  const concessionCopy = concession ? buildConcessionCopy(concession) : null
```

(바뀐 부분은 `concession?.areas` → `concession?.main.areas` 한 줄뿐, 나머지는 그대로.)

- [ ] **Step 2: `ResultConcessionPanel` 호출부에 `giveTag` 전달 + `totalCount`를 `main.total_count`로**

514-524행 부근(`<ResultConcessionPanel` 호출):

```tsx
                      <ResultConcessionPanel
                        message={concessionCopy?.message ?? '두 분 조건에 맞는 동네를 찾는 중이에요'}
                        giveDetail={concessionCopy?.giveDetail ?? ''}
                        giveTag={concessionCopy?.giveTag ?? null}
                        hoods={concessionHoods}
                        totalCount={concession?.main.total_count ?? 0}
                        tipTitle={concessionCopy?.tipTitle ?? '이렇게 조정해보세요'}
                        tipBody={concessionCopy?.tipBody ?? ''}
                        onAdjust={onRetry}
                        onSelectHood={(hood) => {
                          if (hood.lat != null && hood.lng != null) focusPin(hood.lat, hood.lng)
                        }}
                        onViewMap={
                          concessionHoods.length > 0 ? () => setSnap(SNAP_COLLAPSED) : undefined
                        }
                      />
```

(바뀐 부분: `giveTag` 줄 추가, `totalCount={concession?.total_count ?? 0}` → `totalCount={concession?.main.total_count ?? 0}`. `onAdjust`/`onSelectHood`/`onViewMap`은 그대로.)

- [ ] **Step 3: 타입 체크 + lint**

Run: `npx tsc --noEmit`
Expected: `adjust/page.tsx`에 남은 에러(Task 5에서 해소) 외엔 에러 없음.

Run: `npm run lint`
Expected: 이 파일에서 새 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/components/result-map-sheet.tsx
git commit -m "연결: result-map-sheet가 완화 사다리 main/extra 스키마를 쓰도록 갱신"
```

---

### Task 5: `/adjust` 페이지 — `budgetRecommendation` 새 스키마 반영

**Files:**
- Modify: `src/app/s/[id]/adjust/page.tsx`

**Interfaces:**
- Consumes: `ConcessionMatchResult`(Task 2, `main.give.a/b`가 이제 `ConcessionGiveSide`이며 항상 non-null, `field` 대신 `budget_widen_krw`)
- Produces: 없음

- [ ] **Step 1: `budgetRecommendation` 계산 갱신**

296-304행:

```ts
  const budgetRecommendation = (() => {
    if (!concession || !data || !me) return null
    if (concession.main.total_count === 0) return null
    const lowerRole: 'A' | 'B' = data.a.budget_max_krw <= data.b.budget_max_krw ? 'A' : 'B'
    if (me.role !== lowerRole) return null
    const side = lowerRole === 'A' ? concession.main.give.a : concession.main.give.b
    if (side.budget_widen_krw === 0) return null
    return { kind: 'budget' as const, role: lowerRole, amount: side.budget_widen_krw, areaCount: concession.main.total_count }
  })()
```

(`concession.total_count` → `concession.main.total_count`, `concession.give.a/b` → `concession.main.give.a/b`,
`side`가 더 이상 `| null`이 아니므로 `if (!side || side.field !== 'budget')` → `if (side.budget_widen_krw === 0)`,
`side.amount` → `side.budget_widen_krw`.)

- [ ] **Step 2: 타입 체크 + lint**

Run: `npx tsc --noEmit`
Expected: 프로젝트 전체 0 에러(마지막 남은 소비자였으므로 여기서 완전히 해소).

Run: `npm run lint`
Expected: 이 파일에서 새 에러 없음(기존 무관 오류는 그대로).

- [ ] **Step 3: Commit**

```bash
git add 'src/app/s/[id]/adjust/page.tsx'
git commit -m "변경: 조율 화면 예산 추천 카드가 완화 사다리 새 스키마를 쓰도록 갱신"
```

---

### Task 6: 통합 검증 — 실세션으로 사다리 각 단계 화면 확인

**Files:** 없음(코드 변경 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 개발 서버 실행 확인**

기존에 떠 있는 `next dev`(포트 3000)를 그대로 쓰거나, 없으면 `npm run dev`로 새로 띄운다.

- [ ] **Step 2: 시나리오별 실제 화면 확인**

Task 1에서 검증에 썼던 것과 유사한 실세션 3종(즉시 성공/여러 단계 거쳐 성공+extra/전부 실패)을
다시 만들어(또는 재사용) `/s/{id}/result`에 접속해 확인한다:
- `ResultConcessionPanel`의 "서로 양보" 띠가 사다리 단계에 맞는 태그(폭 넓힘/2순위 내려놓음/예산 폭 넓힘)로
  뜨는지, 0단계 성공 케이스에선 띠 자체가 안 보이는지
- 진단 메시지가 스펙 §4 문구와 일치하는지
- 동네 카드("얻는 것" 배지)가 정상 렌더링되는지(서브1 때 만든 `computeBenefitTags` 그대로 동작해야 함)
- 전부 실패 케이스에서 팁카드 + "조건 조율하기" 버튼이 정상 노출되는지
- 콘솔 에러 없는지

`/s/{id}/adjust`에도 접속해 `budgetRecommendation` 카드(있는 세션이면)가 정상 렌더링되는지 확인한다.

- [ ] **Step 3: 테스트 세션 정리**

검증에 쓴 세션을 `sessions` 테이블에서 서비스 롤 키로 삭제.

---

## Self-Review 체크리스트 (실행 전 참고용)

- **스펙 커버리지**: SQL 사다리(Task 1) / 타입·문구(Task 2) / 패널 태그(Task 3) / 연결(Task 4) / adjust 페이지(Task 5) / 검증(Task 6) — 설계 스펙과 "알려진 후속 이슈" 섹션에서 식별된 소비자 4개 파일 전부 커버됨.
- **플레이스홀더 없음**: 모든 스텝에 실제 SQL/TS 코드 포함.
- **타입 일관성**: `ConcessionMatchResult`(Task 2에서 정의) → `result-map-sheet.tsx`(Task 4) → `adjust/page.tsx`(Task 5) 전 구간 동일 타입 사용. `giveTag`는 Task 2(buildConcessionCopy 반환값) → Task 3(prop 정의) → Task 4(전달) 순서로 정확히 이어짐.
- **SQL/TS 필드명 일치**: `ladder_step`/`give.a.commute_widen_min`/`give.a.budget_widen_krw`/`give.a.relieved_condition`/`areas`/`total_count`가 Task 1 SQL의 `jsonb_build_object` 키와 Task 2 TS 인터페이스 필드명이 정확히 일치함(재확인됨).
