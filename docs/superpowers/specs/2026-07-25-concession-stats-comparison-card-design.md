# 콜드 스테이션 조율 패널 — 통계 비교 카드 설계

## 배경

결과 화면에서 두 사람의 통근·예산 조건에 맞는 구역이 0곳(콜드 스테이션)일 때 `ResultConcessionPanel`이 뜬다. 현재 작업 트리(미커밋)에는 이 패널을 팁 카드 캐러셀로 바꾸는 작업이 진행 중인데, 캐러셀 2·3번째 자리(`OtherCouplesCard`, `OpenedAreasCard`)가 전부 목업 수치다:

- `OtherCouplesCard`("다른 커플들은 이렇게 조율했어요") — 이 세션과 무관한 고정 문구. 실제 집계 API가 없다.
- `OpenedAreasCard`("함께 양보로 열리는 동네예요") — `MOCK_CHART_ROWS`(년식/인프라/평수 양보 시 10/7/4곳)를 하드코딩.

이번 작업은 이 두 카드를 정리한다: `OtherCouplesCard`는 가짜 사회적 증거라 제거하고, `OpenedAreasCard`는 실제 계산으로 교체한다.

## 범위

**포함**
- `ResultConcessionPanel`을 3카드 가로 스크롤 → 2카드 스와이프 페이저(점 인디케이터)로 재구성
- `OtherCouplesCard` 제거
- `OpenedAreasCard`(→ `StatsComparisonCard`로 개명)를 실제 데이터로 교체: 조건별(년식/인프라/평수) 양보 시 열리는 구역 수 막대차트 + 추천 조건의 "이런 곳이 열려요" 특징 칩
- `get_concession_matches` RPC 확장: `condition_impact`, `benefit` 필드 추가
- `concession-copy.ts`에 이 필드들을 카드 props로 변환하는 순수 함수 추가

**제외**
- `OtherCouplesCard`가 채우던 "다른 커플 통계" 자리 — 실제 집계 기능이 생기면 별도 작업
- `extra`(사다리 3곳 미만 보충) 기반 통계 — 현재도 프론트에서 안 쓰임, 이번에도 `main` 기준으로만 계산
- CTA 버튼, 상단 헤더("총 N곳"), 카드 1(추천안 팁 카드) 내부 — 변경 없음

## 1. UI — 스와이프 페이저

`result-concession-panel.tsx`:
- `OtherCouplesCard` 함수 삭제
- 현재 `overflow-x-auto` 가로 스크롤 wrapper를 페이저로 교체: 바깥 `overflow-hidden`, 안쪽 트랙에 `transform: translateX(-page * 100%)`, 각 카드 `w-full shrink-0` (기존 고정 `w-[350px]` 제거)
- 점 인디케이터를 카드 아래·CTA 위에 추가 (활성 점만 폭이 넓어지는 스타일, `stats-card-mockup.jsx` 참고)
- `page` state는 컴포넌트 내부에서 관리(부모로 끌어올릴 필요 없음)
- **`condition_impact`가 빈 배열이면 카드 2를 아예 렌더링하지 않는다** — 페이지 1장, 점 인디케이터도 숨김 (실제로는 onboarding에서 조건을 안 고를 수 없어 거의 발생하지 않지만 방어적으로 처리)
- CTA 버튼은 지금처럼 페이지와 무관하게 항상 노출

## 2. 백엔드 — `get_concession_matches` 확장

새 마이그레이션 `supabase/migrations/20260725010000_concession_condition_impact.sql`.

### 2-1. `_priority_hard_ok_except`

기존 `_priority_hard_ok(pid, satisfied, min_priority)`는 우선순위 슬롯(1·2순위) 단위로 완화한다. 이번엔 "특정 조건 코드 하나만" 완화해야 하므로 별도 함수를 추가한다(기존 함수는 변경하지 않음):

```sql
create or replace function public._priority_hard_ok_except(
  pid uuid, satisfied jsonb, excluded_code text
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority in (1, 2)
      and pc.condition_code <> excluded_code
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;
```

### 2-2. `_concession_condition_stats`

`main`이 정해진 뒤(사다리에서 승리한 step의 `a_target`/`b_target`/`widen_min`/`widen_budget`을 그대로 받아) 호출하는 새 함수. `_concession_ladder_step`과 같은 `base` CTE(구역 + 통근·예산 필터)를 재사용하되, 우선순위 하드필터를 `_priority_hard_ok_except`로 바꾼다.

```sql
create or replace function public._concession_condition_stats(
  sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint
) returns jsonb language plpgsql stable as $$
declare
  a_p record;
  b_p record;
  candidate_codes text[];
  code text;
  impact jsonb := '[]'::jsonb;
  cnt bigint;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  -- A·B 중 누구든 1·2순위로 고른 조건만 후보(최대 3개: area_size/build_year/infra)
  select coalesce(array_agg(distinct pc.condition_code), '{}') into candidate_codes
  from public.participant_conditions pc
  where pc.participant_id in (a_p.id, b_p.id) and pc.priority in (1, 2);

  foreach code in array candidate_codes loop
    -- base CTE + commute/budget 필터는 _concession_ladder_step과 동일한 조건,
    -- 우선순위 하드필터만 _priority_hard_ok_except(code)로 교체해 카운트한다.
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
    )
    select count(*) into cnt
    from base b
    where public._priority_hard_ok_except(a_p.id, b.satisfied, code)
      and public._priority_hard_ok_except(b_p.id, b.satisfied, code);

    impact := impact || jsonb_build_object('condition_code', code, 'total_count', cnt);
  end loop;

  return jsonb_build_object('condition_impact', impact);
end $$;
```

주석: 실제 구현 시 `foreach` 안에서 CTE를 매번 재평가하는 게 PL/pgSQL 문법상 번거로우면(동적 SQL 없이 루프 안에 WITH를 못 쓰는 버전 이슈) 배열 3개 이하이므로 `unnest(candidate_codes)`를 조인해 집합 연산 한 번으로 처리하는 것도 동일 결과 — 구현 단계에서 실제 PL/pgSQL 제약 확인 후 더 단순한 형태를 선택해도 된다. 이 설계는 **무엇을 계산하는지**를 고정하는 것이지 SQL 문법 형태를 강제하지 않는다.

### 2-3. `benefit` 계산

`give.a.relieved_condition`과 `give.b.relieved_condition`을 합쳐 **중복 제거한 코드 집합**을 구한다(둘 다 같은 코드를 완화했으면 1개, A/B가 서로 다른 조건을 완화했으면 2개, 완화가 없으면 0개). 이 집합의 크기가 **정확히 1일 때만** benefit을 계산한다. 크기가 0(step 0/1, 완화 불필요)이거나 2(A·B가 서로 다른 조건을 완화 — "OO을 양보하면" 문구가 조건 하나를 가리켜야 해서 대상이 모호해짐)이거나 `relieved_all`(step 5 안전망, 특정 조건 하나를 지목할 수 없음)이면 `benefit = null`.

완화된 코드를 제외한 나머지 구조 조건 2개 + 예산 여유를, `main.total_count` 전체(캡 10개짜리 `areas` 배열이 아니라 전체 카운트) 기준으로 계산한다:

| 태그 | 판정 | 라벨 |
|---|---|---|
| 구조 조건 A | `satisfied.{code} = true` (완화된 코드 제외 나머지 2개 중 하나) | `{CONDITION_LABEL[code]} 우수 N곳` |
| 구조 조건 B | 위와 동일, 나머지 하나 | `{CONDITION_LABEL[code]} 우수 N곳` |
| 예산 여유 | `avg_price_krw <= min(a.budget_max_krw, b.budget_max_krw) * 0.9` (둘 중 하나라도 null이면 이 태그는 스킵) | `예산 여유 N곳` |

이 90% 기준은 `2026-07-22-concession-benefit-cards-design.md`(현재는 대체된 구 설계지만 이 프로젝트에서 이미 검증된 관례)와 동일한 값을 그대로 재사용한다.

count가 0인 태그는 제외. 세 태그 모두 0이면 `benefit = null`(카드 하단 박스 자체를 숨김).

`main` 안에 다음 형태로 붙인다:

```json
{
  "condition_impact": [{ "condition_code": "build_year", "total_count": 10 }, ...],
  "benefit": {
    "condition_code": "build_year",
    "tags": [{ "code": "infra", "count": 6 }, { "code": "budget", "count": 5 }]
  } // or null
}
```

`get_concession_matches` 본문에서 `main` 확정 직후(현재 안전망 마이그레이션의 for 루프 안, `exit` 전) `_concession_condition_stats`를 호출해 `condition_impact`를 얻고, `benefit`은 이 함수 안에서든 호출부에서든 위 규칙대로 파생시켜 `main` jsonb에 병합한다.

## 3. 타입 & 카피 레이어 (`src/lib/concession-copy.ts`)

```ts
export interface ConditionImpactRow {
  condition_code: string
  total_count: number
}

export interface ConcessionBenefit {
  condition_code: string
  tags: { code: string; count: number }[]
}

// ConcessionLadderResult에 추가
interface ConcessionLadderResult {
  // ...기존 필드
  condition_impact: ConditionImpactRow[]
  benefit: ConcessionBenefit | null
}
```

새 순수 함수 `buildStatsComparisonProps(main: ConcessionLadderResult)`:
- `rows`: `condition_impact`를 `total_count` 내림차순 정렬 + `CONDITION_LABEL`로 라벨 부착 + `highlighted` 플래그(코드가 `give.a.relieved_condition` 또는 `give.b.relieved_condition`과 일치하고 `relieved_all`이 아닐 때만 true)
- `benefit`: `main.benefit`을 그대로 라벨만 붙여 반환(또는 null)
- 반환 형태는 `StatsComparisonCard` props와 1:1로 맞춘다 — `result-map-sheet.tsx`가 이 함수 결과를 그대로 `ResultConcessionPanel`에 넘긴다

## 4. 영향 범위

- `supabase/migrations/20260725010000_concession_condition_impact.sql` (신규)
- `src/lib/concession-copy.ts`: 타입 추가, `buildStatsComparisonProps` 추가
- `src/components/result-concession-panel.tsx`: `OtherCouplesCard` 삭제, `OpenedAreasCard` → `StatsComparisonCard`(실제 props 기반), 페이저+점 인디케이터 구조로 교체
- `src/components/result-map-sheet.tsx`: `buildStatsComparisonProps(concession.main)` 호출해 새 prop을 `ResultConcessionPanel`에 전달

`apply_concession` RPC, CTA 동작, 카드 1(추천안) 내부, `get_matches`(정상 매칭 경로)는 변경하지 않는다.
