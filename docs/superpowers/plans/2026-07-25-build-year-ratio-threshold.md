# 신축(build_year) 조건 판정 방식 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신축(build_year) 조건의 area_stats 판정 방식을 "건축년도 평균"에서 "10년 이내 거래 비중(≥30%)"으로 바꿔, 실제로 신축 매물이 있는데도 평균에 깎여 탈락하던 동네들이 정상적으로 매칭되게 한다.

**Architecture:** `area_stats`에 매칭 전용 컬럼 `build_year_ok`를 추가하고, `scripts/refresh-trade-stats.ts`가 실거래 데이터로 이 컬럼을 채운다. `satisfied.build_year`를 인라인 계산하던 5개 SQL 함수를 이 컬럼 참조로 교체한다. `built_year_avg`(평균, 공유 페이지 표시용)는 그대로 유지 — 매칭 로직과 표시 로직을 분리한다.

**Tech Stack:** Supabase Postgres(마이그레이션), TypeScript(`tsx`로 실행하는 배치 스크립트), 국토교통부 실거래가 공공 API.

## Global Constraints

- 이 저장소엔 자동화 테스트 러너가 없다. 검증은 (a) `npx tsc --noEmit`/`npm run lint`, (b) `tsx`로 실행하는 1회성 검증 스크립트(끝나면 삭제), (c) `supabase db push` 후 실제 프로덕션에 스로우어웨이 세션을 만들어 RPC를 직접 호출하는 방식으로 한다 — 기존 관행(`docs/superpowers/plans/2026-07-22-priority-filter-tiering.md` 등)과 동일.
- 원격 프로젝트는 이미 linked 상태(`kvhsviugkbvrjdkfhlra`, `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`과 동일) — `supabase db push`는 바로 프로덕션에 적용된다. **배포(Task 1의 db push, Task 3의 백필 실행, Task 4의 db push)는 사용자 확인 후 실행한다** — 각 배포 단계 직전에 진행 여부를 확인받는다.
- **배포 순서 고정**: Task 1(컬럼 추가, 배포) → Task 2(스크립트 수정, 로컬) → Task 3(백필 실행, 프로덕션 DB 씀) → Task 4(로직 전환 마이그레이션, 배포). 순서를 바꾸면 `build_year_ok`가 비어있는 상태에서 로직만 바뀌어 신축 조건이 일시적으로 전원 탈락한다(스펙 문서 "배포 순서" 절 참고).
- 신축 비율 임계값은 **30%**(`BUILD_YEAR_RECENT_RATIO_THRESHOLD = 0.3`), 신축 기준 연수는 **10년**(`RECENT_YEARS = 10`) — 둘 다 사용자 확인된 값, 임의로 바꾸지 않는다.
- `built_year_avg` 컬럼, `src/lib/shared-result.ts`, `src/app/share/[slug]/page.tsx`, `conditions.descr`(온보딩 조건 설명 문구)는 이번 계획에서 손대지 않는다.
- 스펙: `docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md`

---

## File Structure

- Create: `supabase/migrations/20260725050000_build_year_ratio_column.sql` — `area_stats.build_year_ok` 컬럼 추가만.
- Modify: `scripts/refresh-trade-stats.ts` — 비율 계산 상수/로직 추가, `summarize()` export, upsert row에 필드 추가.
- Create: `supabase/migrations/20260725060000_build_year_ratio_logic.sql` — 5개 함수의 인라인 계산을 `build_year_ok` 참조로 교체.
- 프론트/그 외 파일은 변경 없음(서버가 계산한 `satisfied.build_year`를 그대로 내려주므로).

---

### Task 1: `area_stats.build_year_ok` 컬럼 추가

**Files:**
- Create: `supabase/migrations/20260725050000_build_year_ratio_column.sql`

**Interfaces:**
- Produces: `public.area_stats.build_year_ok boolean` 컬럼(아직 아무 로직도 참조하지 않음 — Task 4에서 참조 시작).

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- =============================================================
-- 신축(build_year) 조건 판정 방식 개선 1/2: 컬럼만 추가한다(로직은 아직
-- 안 바꿈). docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md
-- 참고 — 배포 순서상 이 마이그레이션 → refresh-trade-stats.ts 백필 →
-- 로직 전환 마이그레이션(20260725060000) 순서를 반드시 지켜야 한다.
-- 순서를 바꾸면 build_year_ok가 전부 null인 상태에서 로직만 바뀌어 신축
-- 조건이 일시적으로 전원 탈락하는 역효과가 생긴다.
-- =============================================================
alter table public.area_stats add column build_year_ok boolean;

comment on column public.area_stats.build_year_ok is
  '최근 6개월 실거래 중 10년 이내 준공 비중이 30% 이상이면 true. built_year_avg(평균, 공유 결과 페이지 표시용)와 달리 매칭 판정 전용 — refresh-trade-stats.ts가 채운다.';
```

- [ ] **Step 2: 사용자에게 배포 확인 후 적용**

Run: `cd /Users/dowon/urijib && supabase db push`
Expected: `20260725050000_build_year_ratio_column.sql`만 pending으로 표시되고 적용 성공.

- [ ] **Step 3: 적용 확인**

Run: `supabase migration list`
Expected: `20260725050000`의 `remote` 값이 `local`과 동일하게 채워짐.

- [ ] **Step 4: 회귀 없음 확인(컬럼만 추가했으므로 기존 동작 불변이어야 함)**

`get_matches` 응답이 이전과 동일한지 프로덕션에서 가벼운 스모크 테스트로 확인한다(임시 세션 생성 → 호출 → 삭제, Task 4에서 쓸 방식과 동일 — 여기서는 "에러 없이 정상 응답하는지"만 확인하면 충분).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260725050000_build_year_ratio_column.sql
git commit -m "$(cat <<'EOF'
추가: area_stats.build_year_ok 컬럼(신축 판정 방식 개선 1/2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `refresh-trade-stats.ts` — 비율 기반 `build_year_ok` 계산 추가

**Files:**
- Modify: `scripts/refresh-trade-stats.ts:32-34` (상수), `scripts/refresh-trade-stats.ts:118-128` (`summarize`), `scripts/refresh-trade-stats.ts:184-190` (row 타입), `scripts/refresh-trade-stats.ts:207-211` (row push)

**Interfaces:**
- Produces: `summarize(trades: TradeItem[])`가 반환하는 객체에 `build_year_ok: boolean` 필드 추가(기존 `avg_price_krw`/`built_year_avg`/`size_59_ok`는 그대로).

- [ ] **Step 1: 상수 추가**

`scripts/refresh-trade-stats.ts:32-34`(현재 `const TRADE_MONTHS = 6`, `const SIZE_THRESHOLD_M2 = 59`, `const REQUEST_DELAY_MS = 200`) 바로 아래에 추가:

```ts
const TRADE_MONTHS = 6
const SIZE_THRESHOLD_M2 = 59
const REQUEST_DELAY_MS = 200
// 신축 판정 재정의(docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md):
// "평균 건축년도"가 아니라 size_59_ok와 같은 비율 방식 — 최근 RECENT_YEARS년
// 이내 준공 거래 비중이 이 임계값 이상이면 신축 조건 충족으로 본다.
const RECENT_YEARS = 10
const BUILD_YEAR_RECENT_RATIO_THRESHOLD = 0.3
```

- [ ] **Step 2: `summarize()`에 `build_year_ok` 계산 추가, export**

`scripts/refresh-trade-stats.ts:118-128`을 다음으로 교체(함수 시그니처에 `export` 추가 — Step 4의 검증 스크립트가 import해서 쓴다):

```ts
export function summarize(trades: TradeItem[]) {
  const priceManwonSum = trades.reduce((sum, t) => sum + Number(t.dealAmount.replace(/,/g, '')), 0)
  const buildYearSum = trades.reduce((sum, t) => sum + t.buildYear, 0)
  const largeCount = trades.filter((t) => t.excluUseAr >= SIZE_THRESHOLD_M2).length
  const recentCount = trades.filter((t) => t.buildYear >= new Date().getFullYear() - RECENT_YEARS).length

  return {
    avg_price_krw: Math.round((priceManwonSum / trades.length) * 10000),
    built_year_avg: Math.round(buildYearSum / trades.length),
    size_59_ok: largeCount / trades.length >= 0.5,
    build_year_ok: recentCount / trades.length >= BUILD_YEAR_RECENT_RATIO_THRESHOLD,
  }
}
```

- [ ] **Step 3: row 타입에 필드 추가**

`scripts/refresh-trade-stats.ts:184-190`을 다음으로 교체:

```ts
  const rows: {
    area_code: string
    avg_price_krw: number
    built_year_avg: number
    size_59_ok: boolean
    build_year_ok: boolean
    refreshed_at: string
  }[] = []
```

(`rows.push({ area_code: area.code, ...summarize(trades), refreshed_at: ... })` 부분은 스프레드로 이미 `build_year_ok`를 포함하게 되므로 수정 불필요 — `scripts/refresh-trade-stats.ts:207-211` 그대로 둔다.)

- [ ] **Step 4: 순수 함수 검증 스크립트 작성**

`.scratch_verify_summarize.mjs`(임시 파일, 프로젝트 루트):

```js
import { summarize } from './scripts/refresh-trade-stats.ts'

function trade(buildYear) {
  return { umdNm: 'x', dealAmount: '50000', excluUseAr: 60, buildYear }
}

const currentYear = new Date().getFullYear()
const recent = () => trade(currentYear - 5)
const old = () => trade(currentYear - 30)

const cases = [
  { name: '정확히 30%(3/10) → true', trades: [...Array(3).fill(0).map(recent), ...Array(7).fill(0).map(old)], expected: true },
  { name: '20%(2/10) → false', trades: [...Array(2).fill(0).map(recent), ...Array(8).fill(0).map(old)], expected: false },
  { name: '전부 신축(10/10) → true', trades: Array(10).fill(0).map(recent), expected: true },
  { name: '전부 구축(0/10) → false', trades: Array(10).fill(0).map(old), expected: false },
]

let allPass = true
for (const c of cases) {
  const result = summarize(c.trades).build_year_ok
  const ok = result === c.expected
  allPass &&= ok
  console.log(`${c.name}: got=${result} expected=${c.expected} ${ok ? 'PASS' : 'FAIL'}`)
}
console.log(allPass ? '\n전부 PASS' : '\nFAIL 있음')
```

- [ ] **Step 5: 실행해서 실패 확인(수정 전 코드 대상 — 아직 `build_year_ok` 없으므로 실패해야 정상)**

Step 1~3을 적용하기 **전**이라면 이 스크립트는 `summarize is not a function`(export 안 됐으므로) 또는 `build_year_ok: undefined`로 실패한다. Step 1~3을 이미 적용했다면 이 순서 확인은 건너뛰고 바로 Step 6으로.

- [ ] **Step 6: 실행해서 통과 확인**

Run: `npx tsx .scratch_verify_summarize.mjs`
Expected: 4개 케이스 전부 `PASS`, 마지막 줄 `전부 PASS`.

- [ ] **Step 7: 검증 스크립트 삭제**

```bash
rm .scratch_verify_summarize.mjs
```

- [ ] **Step 8: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 9: Commit**

```bash
git add scripts/refresh-trade-stats.ts
git commit -m "$(cat <<'EOF'
수정: 신축 판정을 평균 건축년도에서 10년 이내 거래 비중(30%)으로 변경

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 프로덕션 백필

**Files:** 없음(스크립트 실행만 — Task 2에서 이미 수정 완료)

**Interfaces:**
- Consumes: Task 1의 `area_stats.build_year_ok` 컬럼, Task 2의 수정된 `refresh-trade-stats.ts`.
- Produces: 프로덕션 `area_stats`의 모든 행에 실제 `build_year_ok` 값 채움.

- [ ] **Step 1: 사용자에게 실행 확인 후 백필 실행**

Run: `cd /Users/dowon/urijib && npx tsx scripts/refresh-trade-stats.ts`
Expected: 마지막 줄에 `area_stats 예산/년식/평형 갱신 완료: N건 (...)` 출력, 에러 없음. 국토부 API 호출이라 사장 조건에 따라 1~2분 소요될 수 있다.

- [ ] **Step 2: 통과율 확인 — 드라이런 수치(37.5%대)와 크게 다르지 않은지 확인**

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data } = await supabase.from('area_stats').select('build_year_ok')
  const total = data.length
  const pass = data.filter((r) => r.build_year_ok).length
  console.log(\`build_year_ok=true: \${pass}/\${total} (\${((pass/total)*100).toFixed(1)}%)\`)
})
"
```

Expected: 대략 30~45% 범위(드라이런 때 152개 동네 기준 37.5%였음 — 전체 155개 area_stats 기준이라 소폭 다를 수 있음). 이 범위를 크게 벗어나면(예: 5% 이하거나 90% 이상) Task 2의 계산 로직을 다시 확인한다.

- [ ] **Step 3: Commit 불필요**

(이 태스크는 배치 실행이라 커밋할 코드 변경이 없음 — Task 2에서 이미 커밋됨.)

---

### Task 4: SQL 로직 전환 — 5개 함수를 `build_year_ok` 참조로 교체

**Files:**
- Create: `supabase/migrations/20260725060000_build_year_ratio_logic.sql`

**Interfaces:**
- Consumes: Task 1/3에서 채워진 `area_stats.build_year_ok`.
- Produces: `_session_candidates`, `get_solo_preview`, `_concession_ladder_step`, `_concession_condition_stats`, `_adjust_candidates`가 전부 `satisfied.build_year`를 `coalesce(st.build_year_ok, false)`로 계산. `get_matches`/`get_concession_matches`/`get_adjust_data`는 이 함수들을 호출만 하므로 자동 반영(직접 수정 없음).

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- =============================================================
-- 신축(build_year) 조건 판정 방식 개선 2/2: 인라인 "평균 >= 올해-10" 계산을
-- area_stats.build_year_ok(비율 기반, Task 1/3에서 채움)로 교체한다.
-- docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md 참고.
-- 이 마이그레이션은 20260725050000(컬럼 추가) + 백필이 끝난 뒤에만 적용한다.
--
-- 현재 satisfied.build_year를 직접 계산하는 5곳(grep + 최신 정의 확인 완료):
-- _session_candidates / get_solo_preview / _concession_ladder_step /
-- _concession_condition_stats(2곳) / _adjust_candidates.
-- get_matches/get_concession_matches/get_adjust_data는 이 함수들을 호출만
-- 하므로 별도 수정 불필요.
-- =============================================================

-- ===== 1) _session_candidates (원 정의: 20260714000000_area_coords_in_matches.sql) =====
create or replace function public._session_candidates(sid uuid)
returns table (
  code text, name text, sigungu text,
  avg_price_krw bigint, a_minutes int, b_minutes int,
  lat double precision, lng double precision,
  satisfied jsonb
) language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
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

  return query
  select
    ar.code, ar.name, ar.sigungu,
    st.avg_price_krw, ca.minutes, cb.minutes,
    ar.lat, ar.lng,
    jsonb_build_object(
      'area_size', coalesce(st.size_59_ok, false),
      'build_year', coalesce(st.build_year_ok, false),
      'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
    )
  from public.areas ar
  join public.area_stats st on st.area_code = ar.code
  join public.commute_cache ca
    on ca.area_code = ar.code and ca.mode = a_p.transport_mode
   and ca.origin_key = round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3)
  join public.commute_cache cb
    on cb.area_code = ar.code and cb.mode = b_p.transport_mode
   and cb.origin_key = round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3)
  where ca.minutes <= a_p.commute_max_min
    and cb.minutes <= b_p.commute_max_min;
end $$;

-- ===== 2) get_solo_preview (원 정의: 20260725030000_priority_hard_filter_fix.sql) =====
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
        'build_year', coalesce(st.build_year_ok, false),
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
    where public._priority_hard_ok(a_p.id, c.satisfied, 1)
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

-- ===== 3) _concession_ladder_step (원 정의: 20260725000000_concession_priority_safety_net.sql) =====
create or replace function public._concession_ladder_step(
  sid uuid,
  a_target text,
  b_target text,
  widen_min int,
  widen_budget bigint,
  min_priority_a int,
  min_priority_b int
) returns jsonb language plpgsql stable as $$
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
        'build_year', coalesce(st.build_year_ok, false),
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
    where public._priority_hard_ok(a_p.id, b.satisfied, min_priority_a)
      and public._priority_hard_ok(b_p.id, b.satisfied, min_priority_b)
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

-- ===== 4) _concession_condition_stats (원 정의: 20260725010000_concession_condition_impact.sql, 2곳) =====
create or replace function public._concession_condition_stats(
  sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint,
  relieved_code text
) returns jsonb language plpgsql stable as $$
declare
  a_p record;
  b_p record;
  candidate_codes text[];
  code text;
  impact jsonb := '[]'::jsonb;
  cnt bigint;
  benefit_json jsonb := null;
  remaining_codes text[];
  area_tag_1 text;
  area_tag_2 text;
  cnt_tag_1 bigint;
  cnt_tag_2 bigint;
  cnt_budget bigint;
  min_budget bigint;
  tags jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  select coalesce(array_agg(distinct pc.condition_code), '{}') into candidate_codes
  from public.participant_conditions pc
  where pc.participant_id in (a_p.id, b_p.id) and pc.priority in (1, 2);

  foreach code in array candidate_codes loop
    with a_origin as (
      select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
    ),
    b_origin as (
      select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
    ),
    base as (
      select
        jsonb_build_object(
          'area_size', coalesce(st.size_59_ok, false),
          'build_year', coalesce(st.build_year_ok, false),
          'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
        ) as satisfied,
        st.avg_price_krw
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
    )
    select count(*) into cnt
    from base b
    where public._priority_hard_ok_except(a_p.id, b.satisfied, code)
      and public._priority_hard_ok_except(b_p.id, b.satisfied, code);

    impact := impact || jsonb_build_object('condition_code', code, 'total_count', cnt);
  end loop;

  if relieved_code is not null then
    select array_agg(t.code order by t.ord) into remaining_codes
    from unnest(array['area_size', 'build_year', 'infra']) with ordinality as t(code, ord)
    where t.code <> relieved_code;
    area_tag_1 := remaining_codes[1];
    area_tag_2 := remaining_codes[2];
    min_budget := least(coalesce(a_p.budget_max_krw, 9223372036854775807), coalesce(b_p.budget_max_krw, 9223372036854775807));

    with a_origin as (
      select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
    ),
    b_origin as (
      select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
    ),
    base as (
      select
        jsonb_build_object(
          'area_size', coalesce(st.size_59_ok, false),
          'build_year', coalesce(st.build_year_ok, false),
          'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
        ) as satisfied,
        st.avg_price_krw
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
      where public._priority_hard_ok_except(a_p.id, b.satisfied, relieved_code)
        and public._priority_hard_ok_except(b_p.id, b.satisfied, relieved_code)
    )
    select
      count(*) filter (where (satisfied ->> area_tag_1)::boolean),
      count(*) filter (where (satisfied ->> area_tag_2)::boolean),
      count(*) filter (where avg_price_krw is not null and avg_price_krw <= min_budget * 0.9)
    into cnt_tag_1, cnt_tag_2, cnt_budget
    from eligible;

    tags := '[]'::jsonb;
    if cnt_tag_1 > 0 then
      tags := tags || jsonb_build_object('code', area_tag_1, 'count', cnt_tag_1);
    end if;
    if cnt_tag_2 > 0 then
      tags := tags || jsonb_build_object('code', area_tag_2, 'count', cnt_tag_2);
    end if;
    if cnt_budget > 0 and a_p.budget_max_krw is not null and b_p.budget_max_krw is not null then
      tags := tags || jsonb_build_object('code', 'budget', 'count', cnt_budget);
    end if;

    if jsonb_array_length(tags) > 0 then
      benefit_json := jsonb_build_object('condition_code', relieved_code, 'tags', tags);
    end if;
  end if;

  return jsonb_build_object('condition_impact', impact, 'benefit', benefit_json);
end $$;

-- ===== 5) _adjust_candidates (원 정의: 20260725020000_adjust_commute_slider.sql) =====
create or replace function public._adjust_candidates(sid uuid)
returns table (
  code text, name text, sigungu text,
  avg_price_krw bigint, a_minutes int, b_minutes int,
  lat double precision, lng double precision,
  satisfied jsonb
) language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
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

  return query
  select
    ar.code, ar.name, ar.sigungu,
    st.avg_price_krw, ca.minutes, cb.minutes,
    ar.lat, ar.lng,
    jsonb_build_object(
      'area_size', coalesce(st.size_59_ok, false),
      'build_year', coalesce(st.build_year_ok, false),
      'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
    )
  from public.areas ar
  join public.area_stats st on st.area_code = ar.code
  join public.commute_cache ca
    on ca.area_code = ar.code and ca.mode = a_p.transport_mode
   and ca.origin_key = round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3)
  join public.commute_cache cb
    on cb.area_code = ar.code and cb.mode = b_p.transport_mode
   and cb.origin_key = round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3)
  where ca.minutes <= a_p.commute_max_min + 30
    and cb.minutes <= b_p.commute_max_min + 30;
end $$;
```

- [ ] **Step 2: 사용자에게 배포 확인 후 적용**

Run: `supabase db push`
Expected: `20260725060000_build_year_ratio_logic.sql` 적용 성공.

- [ ] **Step 3: 실제 프로덕션 스모크 테스트 — 신축 1순위 케이스로 매칭 수 증가 확인**

스펙 문서의 검증 계획은 "로컬 시뮬레이션 + 프로덕션 스모크테스트" 둘 다를 언급하지만, 이번 변경은 컬럼 하나 참조로 바꾸는 좁은 범위라 로컬 Postgres를 다시 띄우는 것보다 실제 배포본을 직접 호출하는 프로덕션 스모크 테스트만으로 충분하다고 판단한다(이번 대화에서 우선순위 하드필터 버그를 검증할 때 쓴 것과 동일한 패턴 — 실제 세션을 만들어 실제 RPC를 호출). `.scratch_verify_build_year.mjs`(임시 파일):

```js
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const admin = createClient(url, serviceKey)
const clientA = createClient(url, anonKey)
const clientB = createClient(url, anonKey)

const { data: authA } = await clientA.auth.signInAnonymously()
const { data: authB } = await clientB.auth.signInAnonymously()

const { data: session } = await admin.from('sessions').insert({}).select('id').single()
const sid = session.id

const ORIGIN_A = { lat: 37.400000, lng: 127.100000 }
const ORIGIN_B = { lat: 37.500000, lng: 127.040000 }

await admin.from('participants').insert([
  { session_id: sid, user_id: authA.user.id, role: 'A', anchor_lat: ORIGIN_A.lat, anchor_lng: ORIGIN_A.lng, transport_mode: 'transit', commute_max_min: 60, budget_max_krw: 1_000_000_000, completed_at: new Date().toISOString() },
  { session_id: sid, user_id: authB.user.id, role: 'B', anchor_lat: ORIGIN_B.lat, anchor_lng: ORIGIN_B.lng, transport_mode: 'transit', commute_max_min: 60, budget_max_krw: 1_000_000_000, completed_at: new Date().toISOString() },
])
const { data: parts } = await admin.from('participants').select('id, role').eq('session_id', sid)
const aId = parts.find((p) => p.role === 'A').id
const bId = parts.find((p) => p.role === 'B').id

// 둘 다 신축(build_year)을 1순위로 — 이 개선의 핵심 타겟 케이스.
await admin.from('participant_conditions').insert([
  { participant_id: aId, condition_code: 'build_year', priority: 1 },
  { participant_id: aId, condition_code: 'infra', priority: 2 },
  { participant_id: aId, condition_code: 'area_size', priority: 3 },
  { participant_id: bId, condition_code: 'build_year', priority: 1 },
  { participant_id: bId, condition_code: 'area_size', priority: 2 },
  { participant_id: bId, condition_code: 'infra', priority: 3 },
])

const { data: areas } = await admin.from('areas').select('code')
const keyA = `${ORIGIN_A.lat.toFixed(3)},${ORIGIN_A.lng.toFixed(3)}`
const keyB = `${ORIGIN_B.lat.toFixed(3)},${ORIGIN_B.lng.toFixed(3)}`
const rows = areas.flatMap((a) => [
  { origin_key: keyA, area_code: a.code, mode: 'transit', minutes: 30 },
  { origin_key: keyB, area_code: a.code, mode: 'transit', minutes: 30 },
])
await admin.from('commute_cache').upsert(rows, { onConflict: 'origin_key,area_code,mode' })

const { data: matches, error } = await clientA.rpc('get_matches', { sid })
if (error) throw error
console.log('candidate_count:', matches.candidate_count)
console.log('match_count (신축 1순위, 개선 후):', matches.match_count)

await admin.from('commute_cache').delete().in('origin_key', [keyA, keyB])
await admin.from('sessions').delete().eq('id', sid)
console.log('cleanup done')
```

Run: `node --env-file=.env.local .scratch_verify_build_year.mjs`
Expected: `match_count`가 0 근처가 아니라 `candidate_count`의 상당 비율(대략 30%대 이상)로 나옴 — 개선 전이었다면 `build_year_ok` 통과 지역이 7.7%뿐이라 훨씬 적은 수가 나왔을 케이스. 실행 후 `.scratch_verify_build_year.mjs` 삭제.

```bash
rm .scratch_verify_build_year.mjs
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260725060000_build_year_ratio_logic.sql
git commit -m "$(cat <<'EOF'
수정: satisfied.build_year 계산을 area_stats.build_year_ok 참조로 전환

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 표시 로직 불변 확인 및 최종 정리

**Files:** 없음(확인만)

- [ ] **Step 1: 공유 결과 페이지가 안 바뀌었는지 확인**

Run: `git diff main -- src/lib/shared-result.ts src/app/share/[slug]/page.tsx` (이번 계획 시작 커밋 기준)
Expected: 출력 없음(diff 없음) — `built_year_avg` 표시 로직을 이번 계획에서 전혀 건드리지 않았음을 재확인.

- [ ] **Step 2: 최종 린트/타입체크**

Run: `npx tsc --noEmit && npx eslint scripts/refresh-trade-stats.ts`
Expected: 에러 없음.

- [ ] **Step 3: 스펙 문서에 완료 표시**

`docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md` 맨 위에 한 줄 추가:

```markdown
> **구현 완료** — `docs/superpowers/plans/2026-07-25-build-year-ratio-threshold.md` 참고.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md
git commit -m "$(cat <<'EOF'
문서: 신축 비율 임계값 개선 구현 완료 표시

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
