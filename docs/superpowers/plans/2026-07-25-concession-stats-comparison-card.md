# 조율 패널 통계 비교 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콜드 스테이션(구역 0곳) 조율 패널의 목업 카드 2장(`OtherCouplesCard`, `OpenedAreasCard`)을 정리해 실제 데이터 기반 "통계 비교 카드" 1장 + 스와이프 페이저로 교체한다.

**Architecture:** `get_concession_matches` RPC가 사다리 승리 단계를 찾은 직후, 새 SQL 헬퍼(`_priority_hard_ok_except`, `_concession_condition_stats`)로 "조건 하나만 완화하면 몇 곳이 열리는지"와 "추천 조건을 완화했을 때 새로 열리는 곳들의 다른 특징"을 계산해 `main.condition_impact`/`main.benefit`으로 응답에 포함시킨다. 프론트는 `concession-copy.ts`의 순수 함수로 이 값을 카드 props로 변환하고, `ResultConcessionPanel`은 3카드 가로 스크롤을 2카드 스와이프 페이저(점 인디케이터)로 바꾼다.

**Tech Stack:** Next.js App Router + TypeScript, Supabase(Postgres RPC, PL/pgSQL), Tailwind. 이 저장소엔 Jest/Vitest 등 테스트 러너가 없다 — 기존 관례(`scripts/*.ts`를 tsx로 직접 실행)를 따라 DB 로직은 임시 fixture 스크립트로, UI는 dev 서버 + 브라우저로 검증한다.

## Global Constraints

- 외부 API 키 클라이언트 노출 금지 — 이 작업은 해당 없음(순수 Supabase RPC/프론트 컴포넌트).
- 지역(시군구/행정동) 하드코딩 금지 — 이 작업에서 지역명을 코드에 적지 않는다.
- "상대 입력 완료 전 조건 비공개"는 RLS가 강제 — 새 SQL 헬퍼도 기존 관례대로 `security definer` 없이 만들어 `get_concession_matches`(정의자 권한) 안에서만 호출한다(직접 호출 시 RLS는 여전히 각 테이블 정책을 따른다).
- `OtherCouplesCard`가 쓰던 가짜 사회적 증거 문구는 절대 재사용하지 않는다.
- `benefit`의 예산 여유 판정 임계값(90%)은 `docs/superpowers/specs/2026-07-22-concession-benefit-cards-design.md`에서 이미 검증된 값을 그대로 재사용한다.
- 카드 1(추천안 팁 카드), 상단 헤더("총 N곳"), CTA 버튼, `apply_concession` RPC는 변경하지 않는다.

---

## File Structure

- **Modify:** `supabase/migrations/` — 새 마이그레이션 파일 추가(기존 파일은 수정하지 않음, 마이그레이션은 append-only)
- **Modify:** `src/lib/concession-copy.ts` — 타입 확장 + `buildStatsComparisonProps` 순수 함수 추가
- **Modify:** `src/components/result-concession-panel.tsx` — `OtherCouplesCard` 삭제, `OpenedAreasCard` → `StatsComparisonCard`(실 데이터), 스와이프 페이저 구조로 교체
- **Modify:** `src/components/result-map-sheet.tsx` — `buildStatsComparisonProps` 호출 + prop 전달

---

### Task 1: DB — 조건별 완화 임팩트 계산 RPC 추가

**Files:**
- Create: `supabase/migrations/20260725010000_concession_condition_impact.sql`
- Create (temporary, deleted at end of task): `scripts/tmp-verify-concession-stats.ts`

**Interfaces:**
- Consumes: 기존 `public.participants`, `public.participant_conditions`, `public.areas`, `public.area_stats`, `public.commute_cache` 테이블(스키마는 아래 SQL 참고). 기존 `get_concession_matches`의 사다리 루프 변수(`step`, `a_target`, `b_target`, `a_relieved_code`, `b_relieved_code`, `step_min_priority`) — `supabase/migrations/20260725000000_concession_priority_safety_net.sql`에 이미 정의돼 있다(코드 재작성만, 로직은 그대로).
- Produces: `public._priority_hard_ok_except(pid uuid, satisfied jsonb, excluded_code text) returns boolean`. `public._concession_condition_stats(sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint, relieved_code text) returns jsonb` — `{ "condition_impact": [{ "condition_code": text, "total_count": bigint }], "benefit": { "condition_code": text, "tags": [{ "code": text, "count": bigint }] } | null }`. `public.get_concession_matches(sid uuid)` 응답의 `main`에 `condition_impact`(배열, 실패 시 `[]`)와 `benefit`(객체 또는 `null`) 필드가 추가된다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260725010000_concession_condition_impact.sql` 전체 내용:

```sql
-- =============================================================
-- 통계 비교 카드(docs/superpowers/specs/2026-07-25-concession-stats-comparison-card-design.md).
-- get_concession_matches가 찾은 승리 단계(main) 기준으로, "조건 하나만 더
-- 완화하면 몇 곳이 열리는지"(condition_impact)와 "추천 조건을 완화했을 때
-- 새로 열리는 곳들의 다른 특징"(benefit)을 계산해 main에 붙인다.
-- =============================================================

-- =============================================================
-- _priority_hard_ok_except: 기존 _priority_hard_ok는 우선순위 슬롯(1·2순위)
-- 단위로 완화한다. 이번엔 "특정 조건 코드 하나만" 완화해야 하므로 별도
-- 함수로 추가한다(기존 _priority_hard_ok는 건드리지 않음 — 사다리 로직 그대로).
-- =============================================================
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

-- =============================================================
-- _concession_condition_stats: main이 정해진 뒤, 그 승리 단계의
-- a_target/b_target/widen 값을 그대로 받아 조건별 완화 임팩트를 계산한다.
-- relieved_code가 non-null이면(= A·B가 완화한 조건이 정확히 하나로
-- 겹칠 때만 호출부에서 넘김) 그 조건의 "얻는 것" 특징 태그도 계산한다.
-- =============================================================
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

  -- A·B 중 누구든 1·2순위로 고른 조건만 후보(최대 3개: area_size/build_year/infra)
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
          'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
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

  -- ===== benefit: relieved_code가 있을 때만, 그 조건을 뺀 나머지 2개 구조
  -- 조건 + 예산 여유를 같은 eligible set(위 루프에서 relieved_code로 이미
  -- 계산한 것과 동일한 집합) 기준으로 집계한다. =====
  if relieved_code is not null then
    area_tag_1 := (array['area_size', 'build_year', 'infra']::text[] except array[relieved_code])[1];
    area_tag_2 := (array['area_size', 'build_year', 'infra']::text[] except array[relieved_code])[2];
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
          'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
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

-- =============================================================
-- get_concession_matches: 승리 단계(main)가 확정된 직후 위 함수를 호출해
-- condition_impact/benefit을 main에 병합한다. 그 외 로직은
-- 20260725000000_concession_priority_safety_net.sql과 완전히 동일하다.
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
  step_min_priority int;
  step_result jsonb;
  next_step jsonb;
  next_min_priority int;
  next_result jsonb;

  main jsonb;
  extra jsonb;
  main_codes text[];
  extra_areas jsonb;
  extra_total bigint;

  relieved_code_for_stats text;
  stats_result jsonb;

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

  steps := jsonb_build_array(
    jsonb_build_object('step', 0, 'commute_widen', 0,  'budget_widen', 0,         'relieve', false, 'relieve_all', false),
    jsonb_build_object('step', 1, 'commute_widen', 5,  'budget_widen', 0,         'relieve', false, 'relieve_all', false),
    jsonb_build_object('step', 2, 'commute_widen', 5,  'budget_widen', 0,         'relieve', true,  'relieve_all', false),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 0,         'relieve', true,  'relieve_all', false),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 80000000,  'relieve', true,  'relieve_all', false),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve', true,  'relieve_all', false),
    jsonb_build_object('step', 5, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve', true,  'relieve_all', true)
  );
  step_count := jsonb_array_length(steps);

  main := null;
  extra := null;

  for i in 0..step_count - 1 loop
    step := steps -> i;
    step_min_priority := case
      when coalesce((step ->> 'relieve_all')::boolean, false) then 0
      when (step ->> 'relieve')::boolean then 1
      else 2
    end;
    step_result := public._concession_ladder_step(
      sid, a_target, b_target,
      (step ->> 'commute_widen')::int,
      (step ->> 'budget_widen')::bigint,
      step_min_priority,
      step_min_priority
    );

    if (step_result ->> 'total_count')::bigint >= 1 then
      main := jsonb_build_object(
        'ladder_step', (step ->> 'step')::int,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_min_priority = 1 then a_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_min_priority = 1 then b_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', step_result -> 'areas',
        'total_count', step_result -> 'total_count'
      );

      -- ===== 통계 비교 카드: A·B가 완화한 조건이 정확히 하나로 겹칠 때만
      -- benefit용 relieved_code를 넘긴다(둘이 서로 다른 조건을 완화했으면
      -- "OO을 양보하면"이 가리킬 대상이 모호해지므로 null — benefit 생략). =====
      relieved_code_for_stats := case
        when step_min_priority = 1 and a_relieved_code is not null and b_relieved_code is not null and a_relieved_code = b_relieved_code then a_relieved_code
        when step_min_priority = 1 and a_relieved_code is not null and b_relieved_code is null then a_relieved_code
        when step_min_priority = 1 and a_relieved_code is null and b_relieved_code is not null then b_relieved_code
        else null
      end;

      stats_result := public._concession_condition_stats(
        sid, a_target, b_target,
        (step ->> 'commute_widen')::int,
        (step ->> 'budget_widen')::bigint,
        relieved_code_for_stats
      );

      main := main || jsonb_build_object(
        'condition_impact', stats_result -> 'condition_impact',
        'benefit', stats_result -> 'benefit'
      );

      if (step_result ->> 'total_count')::bigint < 3 and i + 1 < step_count then
        next_step := steps -> (i + 1);
        next_min_priority := case
          when coalesce((next_step ->> 'relieve_all')::boolean, false) then 0
          when (next_step ->> 'relieve')::boolean then 1
          else 2
        end;
        next_result := public._concession_ladder_step(
          sid, a_target, b_target,
          (next_step ->> 'commute_widen')::int,
          (next_step ->> 'budget_widen')::bigint,
          next_min_priority,
          next_min_priority
        );

        select coalesce(array_agg(a ->> 'code'), '{}') into main_codes
        from jsonb_array_elements(main -> 'areas') a;

        select coalesce(jsonb_agg(a), '[]'::jsonb) into extra_areas
        from jsonb_array_elements(next_result -> 'areas') a
        where not (a ->> 'code' = any(main_codes));

        extra_total := (next_result ->> 'total_count')::bigint - (main ->> 'total_count')::bigint;

        extra := jsonb_build_object(
          'ladder_step', (next_step ->> 'step')::int,
          'give', jsonb_build_object(
            'a', jsonb_build_object(
              'commute_widen_min', case when a_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when a_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', case when next_min_priority = 1 then a_relieved_code else null end,
              'relieved_all', next_min_priority = 0
            ),
            'b', jsonb_build_object(
              'commute_widen_min', case when b_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when b_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', case when next_min_priority = 1 then b_relieved_code else null end,
              'relieved_all', next_min_priority = 0
            )
          ),
          'areas', extra_areas,
          'total_count', extra_total
        );
      end if;

      exit;
    end if;

    if i = step_count - 1 then
      main := jsonb_build_object(
        'ladder_step', null,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_min_priority = 1 then a_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_min_priority = 1 then b_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', '[]'::jsonb,
        'total_count', 0,
        'condition_impact', '[]'::jsonb,
        'benefit', null
      );
    end if;
  end loop;

  result := jsonb_build_object('main', main, 'extra', extra);
  return result;
end $$;
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `supabase db reset`
Expected: 모든 마이그레이션이 에러 없이 적용됨(마지막 줄에 `Finished supabase db reset` 계열 메시지). 에러가 나면 SQL 문법(특히 `foreach ... in array`, `except` 배열 연산자)을 다시 확인한다.

- [ ] **Step 3: fixture 검증 스크립트 작성**

`scripts/tmp-verify-concession-stats.ts` (임시 — 이 태스크 마지막에 삭제):

```ts
/**
 * _concession_condition_stats 검증용 임시 스크립트. 손으로 계산한 기대값과
 * 비교한다. 실행 후 fixture를 정리하고 이 파일 자체도 삭제한다.
 * 실행: npx tsx scripts/tmp-verify-concession-stats.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  console.log(`OK ${label}`)
}

async function main() {
  const { data: userA, error: userAErr } = await supabase.auth.admin.createUser({
    email: `verify-a-${Date.now()}@example.com`,
    password: 'verify-password-1234',
    email_confirm: true,
  })
  if (userAErr) throw userAErr
  const { data: userB, error: userBErr } = await supabase.auth.admin.createUser({
    email: `verify-b-${Date.now()}@example.com`,
    password: 'verify-password-1234',
    email_confirm: true,
  })
  if (userBErr) throw userBErr

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .insert({})
    .select('id')
    .single()
  if (sessionErr) throw sessionErr
  const sid = session.id as string

  const { data: participants, error: pErr } = await supabase
    .from('participants')
    .insert([
      {
        session_id: sid, user_id: userA.user.id, role: 'A',
        anchor_lat: 37.401, anchor_lng: 127.101, transport_mode: 'car',
        commute_max_min: 30, budget_max_krw: 500000000, completed_at: new Date().toISOString(),
      },
      {
        session_id: sid, user_id: userB.user.id, role: 'B',
        anchor_lat: 37.501, anchor_lng: 127.201, transport_mode: 'car',
        commute_max_min: 30, budget_max_krw: 500000000, completed_at: new Date().toISOString(),
      },
    ])
    .select('id, role')
  if (pErr) throw pErr
  const aId = participants.find((p) => p.role === 'A')!.id
  const bId = participants.find((p) => p.role === 'B')!.id

  const { error: condErr } = await supabase.from('participant_conditions').insert([
    { participant_id: aId, condition_code: 'area_size', priority: 1 },
    { participant_id: aId, condition_code: 'build_year', priority: 2 },
    { participant_id: bId, condition_code: 'infra', priority: 1 },
    { participant_id: bId, condition_code: 'build_year', priority: 2 },
  ])
  if (condErr) throw condErr

  // area_size / build_year / infra 조합을 다양하게 섞은 7개 구역 —
  // 각 조건을 하나씩 제외했을 때 딱 한 곳씩만 새로 열리도록 설계했다.
  const areas = [
    { code: 'VERIFY01', area_size: true, build_year: false, infra: false },
    { code: 'VERIFY02', area_size: false, build_year: true, infra: false },
    { code: 'VERIFY03', area_size: false, build_year: false, infra: true },
    { code: 'VERIFY04', area_size: true, build_year: true, infra: false },
    { code: 'VERIFY05', area_size: false, build_year: false, infra: false },
    { code: 'VERIFY06', area_size: false, build_year: true, infra: true },
    { code: 'VERIFY07', area_size: true, build_year: false, infra: true },
  ]

  const { error: areaErr } = await supabase.from('areas').insert(
    areas.map((a) => ({ code: a.code, name: a.code, sigungu: '검증용', lat: 37.45, lng: 127.15 }))
  )
  if (areaErr) throw areaErr

  const { error: statErr } = await supabase.from('area_stats').insert(
    areas.map((a) => ({
      area_code: a.code,
      avg_price_krw: 300000000,
      built_year_avg: a.build_year ? new Date().getFullYear() : 2000,
      mart_ok: a.infra,
      hospital_ok: a.infra,
      park_ok: a.infra,
      size_59_ok: a.area_size,
    }))
  )
  if (statErr) throw statErr

  const commuteRows = areas.flatMap((a) => [
    { origin_key: '37.401,127.101', area_code: a.code, mode: 'car', minutes: 10 },
    { origin_key: '37.501,127.201', area_code: a.code, mode: 'car', minutes: 10 },
  ])
  const { error: commuteErr } = await supabase.from('commute_cache').insert(commuteRows)
  if (commuteErr) throw commuteErr

  const { data: stats, error: rpcErr } = await supabase.rpc('_concession_condition_stats', {
    sid,
    a_target: null,
    b_target: null,
    widen_min: 0,
    widen_budget: 0,
    relieved_code: 'build_year',
  })
  if (rpcErr) throw rpcErr

  const impact = (stats.condition_impact as { condition_code: string; total_count: number }[])
    .sort((a, b) => a.condition_code.localeCompare(b.condition_code))
  assertEqual(
    impact,
    [
      { condition_code: 'area_size', total_count: 1 },
      { condition_code: 'build_year', total_count: 1 },
      { condition_code: 'infra', total_count: 1 },
    ],
    'condition_impact'
  )

  const benefit = stats.benefit as { condition_code: string; tags: { code: string; count: number }[] }
  const sortedTags = [...benefit.tags].sort((a, b) => a.code.localeCompare(b.code))
  assertEqual(benefit.condition_code, 'build_year', 'benefit.condition_code')
  assertEqual(
    sortedTags,
    [
      { code: 'area_size', count: 1 },
      { code: 'budget', count: 1 },
      { code: 'infra', count: 1 },
    ],
    'benefit.tags'
  )

  // ===== 정리 =====
  await supabase.from('sessions').delete().eq('id', sid)
  await supabase.from('areas').delete().in('code', areas.map((a) => a.code))
  await supabase.auth.admin.deleteUser(userA.user.id)
  await supabase.auth.admin.deleteUser(userB.user.id)

  console.log('모든 검증 통과')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: 스크립트 실행**

Run: `npx tsx scripts/tmp-verify-concession-stats.ts`
Expected: `OK condition_impact`, `OK benefit.condition_code`, `OK benefit.tags`, `모든 검증 통과` 출력. 실패하면 에러 메시지의 `expected`/`got`을 비교해 SQL 로직을 수정하고 `supabase db reset` 후 재실행한다.

- [ ] **Step 5: 임시 스크립트 삭제 및 커밋**

```bash
rm scripts/tmp-verify-concession-stats.ts
git add supabase/migrations/20260725010000_concession_condition_impact.sql
git commit -m "$(cat <<'EOF'
추가: 조율 통계 비교 카드용 조건별 완화 임팩트 RPC

get_concession_matches가 찾은 승리 단계 기준으로 조건 하나만 더 완화하면
몇 곳이 열리는지(condition_impact)와 추천 조건 완화 시 새로 열리는 곳들의
다른 특징(benefit)을 계산해 main에 포함시킨다.
EOF
)"
```

---

### Task 2: 타입 & 카피 레이어 — `buildStatsComparisonProps`

**Files:**
- Modify: `src/lib/concession-copy.ts`

**Interfaces:**
- Consumes: Task 1이 만든 `main.condition_impact: { condition_code: string; total_count: number }[]`, `main.benefit: { condition_code: string; tags: { code: string; count: number }[] } | null` (RPC 응답 그대로 파싱한 것). 기존 `CONDITION_LABEL`(`src/lib/condition-labels.ts`, `{ area_size: '평형', build_year: '년식', infra: '인프라' }`).
- Produces: `StatsComparisonRow { code: string; label: string; count: number; highlighted: boolean }`, `StatsComparisonBenefit { title: string; tags: string[] }`, `StatsComparisonProps { rows: StatsComparisonRow[]; benefit: StatsComparisonBenefit | null }`, `buildStatsComparisonProps(main: ConcessionLadderResult): StatsComparisonProps` — Task 4가 이 함수를 호출한다.

- [ ] **Step 1: 타입 확장**

`src/lib/concession-copy.ts:27-39`(현재 `ConcessionLadderResult`/`ConcessionMatchResult` 정의)를 아래로 교체:

```ts
export interface ConditionImpactRow {
  condition_code: string
  total_count: number
}

export interface ConcessionBenefitTag {
  code: string
  count: number
}

export interface ConcessionBenefit {
  condition_code: string
  tags: ConcessionBenefitTag[]
}

export interface ConcessionLadderResult {
  ladder_step: 0 | 1 | 2 | 3 | 4 | 5 | null
  give: { a: ConcessionGiveSide; b: ConcessionGiveSide }
  areas: ConcessionArea[]
  total_count: number
  // get_concession_matches가 승리 단계 기준으로 계산한 조건별 완화 임팩트.
  // 실패(ladder_step=null)나 A·B가 서로 다른 조건을 완화한 경우엔 각각
  // []/null — 프론트는 이 값을 그대로 신뢰하고 재계산하지 않는다.
  condition_impact: ConditionImpactRow[]
  benefit: ConcessionBenefit | null
}

// get_concession_matches 응답 — main은 항상 존재(실패해도 ladder_step=null로
// areas=[]인 상태로 옴), extra는 main이 3곳 미만일 때만 채워진다.
export interface ConcessionMatchResult {
  main: ConcessionLadderResult
  extra: ConcessionLadderResult | null
}
```

- [ ] **Step 2: `buildStatsComparisonProps` 추가**

파일 끝(102행, `buildConcessionCopy` 함수 뒤)에 추가:

```ts
export interface StatsComparisonRow {
  code: string
  label: string
  count: number
  highlighted: boolean
}

export interface StatsComparisonBenefit {
  title: string
  tags: string[]
}

export interface StatsComparisonProps {
  rows: StatsComparisonRow[]
  benefit: StatsComparisonBenefit | null
}

// 한국어 명사에 을/를 조사를 붙인다 — "년식을", "인프라를"처럼 받침 유무로
// 갈라진다(유니코드 한글 음절 오프셋: (code - 0xAC00) % 28 === 0이면 받침 없음).
function withEulReul(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0
  return `${word}${hasBatchim ? '을' : '를'}`
}

// StatsComparisonCard(조건별 완화 시 열리는 구역 수 막대차트) props로 변환.
// 행은 열리는 구역 수 내림차순 — 시스템이 자동 선택한 조건(highlighted)이
// 꼭 1등은 아니다(다른 조건이 더 많이 열릴 수도 있다는 걸 보여주는 게 의도).
export function buildStatsComparisonProps(main: ConcessionLadderResult): StatsComparisonProps {
  const relievedCodes = new Set(
    [main.give.a.relieved_condition, main.give.b.relieved_condition].filter(
      (c): c is string => c != null
    )
  )

  const rows = [...main.condition_impact]
    .sort((a, b) => b.total_count - a.total_count)
    .map((row) => ({
      code: row.condition_code,
      label: CONDITION_LABEL[row.condition_code] ?? row.condition_code,
      count: row.total_count,
      highlighted: relievedCodes.has(row.condition_code),
    }))

  const benefit = main.benefit
    ? {
        title: `${withEulReul(CONDITION_LABEL[main.benefit.condition_code] ?? main.benefit.condition_code)} 양보하면 이런 곳이 열려요`,
        tags: main.benefit.tags.map((tag) =>
          tag.code === 'budget'
            ? `예산 여유 ${tag.count}곳`
            : `${CONDITION_LABEL[tag.code] ?? tag.code} 우수 ${tag.count}곳`
        ),
      }
    : null

  return { rows, benefit }
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. `src/lib/concession-copy.ts` 관련 에러가 있으면 위 코드의 타입을 다시 확인한다.

- [ ] **Step 4: 동작 확인(임시 스크립트)**

`scripts/tmp-verify-stats-props.ts` 작성:

```ts
import { buildStatsComparisonProps, type ConcessionLadderResult } from '../src/lib/concession-copy'

const main: ConcessionLadderResult = {
  ladder_step: 2,
  give: {
    a: { commute_widen_min: 0, budget_widen_krw: 0, relieved_condition: 'build_year', relieved_all: false },
    b: { commute_widen_min: 0, budget_widen_krw: 0, relieved_condition: null, relieved_all: false },
  },
  areas: [],
  total_count: 4,
  condition_impact: [
    { condition_code: 'build_year', total_count: 4 },
    { condition_code: 'infra', total_count: 7 },
    { condition_code: 'area_size', total_count: 2 },
  ],
  benefit: {
    condition_code: 'build_year',
    tags: [
      { code: 'infra', count: 6 },
      { code: 'budget', count: 5 },
    ],
  },
}

const props = buildStatsComparisonProps(main)
console.log(JSON.stringify(props, null, 2))

if (props.rows[0].code !== 'infra' || props.rows[0].count !== 7) {
  throw new Error('FAIL: infra가 카운트 내림차순 1등이어야 함')
}
if (!props.rows.find((r) => r.code === 'build_year')?.highlighted) {
  throw new Error('FAIL: build_year는 give.a.relieved_condition과 일치해 highlighted=true여야 함')
}
if (props.rows.find((r) => r.code === 'infra')?.highlighted) {
  throw new Error('FAIL: infra는 어느 쪽도 relieved_condition이 아니므로 highlighted=false여야 함')
}
if (props.benefit?.title !== '년식을 양보하면 이런 곳이 열려요') {
  throw new Error(`FAIL: benefit.title 조사 처리 오류 — ${props.benefit?.title}`)
}
if (JSON.stringify(props.benefit?.tags) !== JSON.stringify(['인프라 우수 6곳', '예산 여유 5곳'])) {
  throw new Error(`FAIL: benefit.tags 매핑 오류 — ${JSON.stringify(props.benefit?.tags)}`)
}
console.log('모든 검증 통과')
```

Run: `npx tsx scripts/tmp-verify-stats-props.ts`
Expected: JSON 출력 뒤 `모든 검증 통과`.

- [ ] **Step 5: 임시 스크립트 삭제 및 커밋**

```bash
rm scripts/tmp-verify-stats-props.ts
git add src/lib/concession-copy.ts
git commit -m "$(cat <<'EOF'
추가: 통계 비교 카드 props 변환 함수(buildStatsComparisonProps)

condition_impact/benefit을 카운트 내림차순 정렬 + 라벨/조사 처리된
StatsComparisonCard props로 변환하는 순수 함수를 추가한다.
EOF
)"
```

---

### Task 3: UI — `ResultConcessionPanel` 스와이프 페이저 + `StatsComparisonCard`

**Files:**
- Modify: `src/components/result-concession-panel.tsx`

**Interfaces:**
- Consumes: Task 2의 `StatsComparisonProps`, `StatsComparisonRow`, `StatsComparisonBenefit` (from `@/lib/concession-copy`).
- Produces: `ResultConcessionPanelProps`에 `stats: StatsComparisonProps` 필드 추가(Task 4가 이 prop을 채워 넣는다). 기존 `totalCount`/`tipTitle`/`tipBody`/`giveChips`/`applying`/`onApply`는 그대로 유지.

- [ ] **Step 1: `OtherCouplesCard`와 목업 상수 삭제**

`src/components/result-concession-panel.tsx`의 파일 최상단부터 `OpenedAreasCard` 함수 시작 직전까지(`'use client'` ~ `OtherCouplesCard` 함수 전체 ~ `MOCK_CHART_ROWS`/`MOCK_CHART_MAX`/`MOCK_BENEFIT_TAGS` 상수)를 아래 내용으로 통째로 교체한다 — `OtherCouplesCard` 함수와 세 mock 상수는 완전히 삭제되고, `import`·`ConcessionGiveChip`·`ResultConcessionPanelProps`·`ROLE_LETTER_SRC`는 아래처럼 유지·확장된다:

```tsx
'use client'

import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StatsComparisonProps } from '@/lib/concession-copy'

export interface ConcessionGiveChip {
  role: 'A' | 'B'
  text: string
}

interface ResultConcessionPanelProps {
  totalCount: number
  tipTitle: string
  tipBody: string
  giveChips: ConcessionGiveChip[]
  stats: StatsComparisonProps
  applying: boolean
  onApply: () => void
}

const ROLE_LETTER_SRC: Record<'A' | 'B', string> = {
  A: '/asset/priority-letter-a.png',
  B: '/asset/priority-letter-b.png',
}
```

- [ ] **Step 2: `OpenedAreasCard` → `StatsComparisonCard`(실 데이터)로 교체**

옛 `OpenedAreasCard` 함수를 삭제하고 아래 컴포넌트로 교체(같은 자리):

```tsx
function StatsComparisonCard({ rows, benefit }: StatsComparisonProps) {
  const maxCount = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="flex h-full w-full shrink-0 flex-col gap-4 rounded-2xl bg-white px-5 py-6 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
          <Lightbulb className="size-5 text-pink-500" />
          함께 양보로 열리는 동네예요
        </span>
        <p className="text-body-s leading-[1.4] text-neutral-500">
          두 분 조건에서 무엇을 내려놓느냐에 따라
          <br />
          찾을 수 있는 동네가 달라져요.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.code} className="flex items-center gap-2">
            <span className="w-[70px] shrink-0 text-caption-l font-medium text-neutral-900">
              {row.label}
              {row.highlighted && (
                <span className="ml-1 rounded bg-pink-50 px-1 py-px text-[9px] font-bold text-pink-700">
                  제안
                </span>
              )}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <span
                className={cn('block h-full rounded-full', row.highlighted ? 'bg-pink-500' : 'bg-neutral-300')}
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-[28px] shrink-0 text-right text-caption-l font-semibold text-neutral-900">
              {row.count}곳
            </span>
          </div>
        ))}
      </div>

      {benefit && (
        <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
          <p className="text-caption-l font-semibold text-neutral-900">{benefit.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {benefit.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-teal/10 px-3 py-1.5 text-caption-m font-medium text-neutral-900"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 본문을 스와이프 페이저로 교체**

현재 `ResultConcessionPanel` 본문(구 158-225행 부근 — 가로 스크롤 wrapper와 카드 리스트)을 아래로 교체:

```tsx
export function ResultConcessionPanel({
  totalCount,
  tipTitle,
  tipBody,
  giveChips,
  stats,
  applying,
  onApply,
}: ResultConcessionPanelProps) {
  const [tipLine1, tipLine2] = tipBody.split('\n')
  const [page, setPage] = useState(0)
  const hasStatsCard = stats.rows.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col items-center gap-0.5 p-4 text-center">
        <p className="text-body-m font-semibold text-neutral-900">함께 조금씩 양보하면 갈 수 있는 동네</p>
        <p className="text-title-sb font-bold text-neutral-900">
          총 <span className="font-montserrat text-mont-title-l text-pink-500">{totalCount}</span>곳
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-5 pb-2">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          <div className="h-full w-full shrink-0">
            <div className="flex h-full flex-col gap-8 rounded-2xl bg-white px-5 py-6 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
                  <Lightbulb className="size-5 text-pink-500" />
                  {tipTitle}
                </span>
                <p className="text-body-s leading-[1.4] text-neutral-500">
                  {tipLine1}
                  {tipLine2 && (
                    <>
                      <br />
                      {tipLine2}
                    </>
                  )}
                </p>
              </div>

              {giveChips.length > 0 && (
                <div className="flex flex-col gap-4">
                  {giveChips.map((chip) => (
                    <span
                      key={chip.role}
                      className={cn(
                        'flex w-full items-center gap-1 rounded-xl px-5 py-2',
                        chip.role === 'A' ? 'bg-pink-200/50' : 'bg-[#c6fffe]'
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ROLE_LETTER_SRC[chip.role]} alt={chip.role} className="size-8 shrink-0" />
                      <span className="text-base font-semibold tracking-[-0.504px] text-neutral-900">
                        {chip.text}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {hasStatsCard && (
            <div className="h-full w-full shrink-0">
              <StatsComparisonCard rows={stats.rows} benefit={stats.benefit} />
            </div>
          )}
        </div>
      </div>

      {hasStatsCard && (
        <div className="flex shrink-0 justify-center gap-1.5 pb-1">
          {[0, 1].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i + 1}번째 카드로 이동`}
              onClick={() => setPage(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                page === i ? 'w-4 bg-pink-500' : 'w-1.5 bg-neutral-200'
              )}
            />
          ))}
        </div>
      )}

      <div className="shrink-0 px-4 pt-3 pb-6">
        <button
          onClick={onApply}
          disabled={applying}
          className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white disabled:opacity-50"
        >
          {applying ? '적용하는 중...' : '이 조건으로 바꾸고 동네 보러 가기'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(다음 태스크에서 `result-map-sheet.tsx`가 `stats` prop을 넘기기 전까진 그 파일에서 "Property 'stats' is missing" 에러가 나는 게 정상 — 이 태스크에서 확인할 건 `result-concession-panel.tsx` 자체에 새 에러가 없다는 것).

- [ ] **Step 5: 커밋**

```bash
git add src/components/result-concession-panel.tsx
git commit -m "$(cat <<'EOF'
변경: 조율 패널을 3카드 가로스크롤 → 2카드 스와이프 페이저로 교체

가짜 사회적 증거였던 OtherCouplesCard를 제거하고, OpenedAreasCard를 실
데이터 기반 StatsComparisonCard로 바꾼다. 점 인디케이터로 페이지 전환.
EOF
)"
```

---

### Task 4: 데이터 연결 — `result-map-sheet.tsx`

**Files:**
- Modify: `src/components/result-map-sheet.tsx`

**Interfaces:**
- Consumes: Task 2의 `buildStatsComparisonProps(main: ConcessionLadderResult): StatsComparisonProps` (from `@/lib/concession-copy`). Task 3의 `ResultConcessionPanelProps.stats: StatsComparisonProps`.
- Produces: 없음(리프 노드 — 이 컴포넌트를 소비하는 곳 없음).

- [ ] **Step 1: import 추가 및 `stats` 계산**

`src/components/result-map-sheet.tsx:19`의 import를 교체:

```ts
import { buildConcessionCopy, buildStatsComparisonProps, type ConcessionMatchResult } from '@/lib/concession-copy'
```

`src/components/result-map-sheet.tsx:498` 근처(`const concessionCopy = concession ? buildConcessionCopy(concession) : null`) 바로 아래에 추가:

```ts
const concessionStats = concession
  ? buildStatsComparisonProps(concession.main)
  : { rows: [], benefit: null }
```

- [ ] **Step 2: `ResultConcessionPanel`에 `stats` prop 전달**

`src/components/result-map-sheet.tsx:705-712`의 `<ResultConcessionPanel ... />` 호출을 교체:

```tsx
<ResultConcessionPanel
  totalCount={concession?.main.total_count ?? 0}
  tipTitle={concessionCopy?.tipTitle ?? '이렇게 조율해봤어요'}
  tipBody={concessionCopy?.tipBody ?? ''}
  giveChips={concessionCopy?.giveChips ?? []}
  stats={concessionStats}
  applying={applyingConcession}
  onApply={onApplyConcession}
/>
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(경고는 기존과 동일한 수준이면 무방, 새 타입/참조 에러가 없어야 함).

- [ ] **Step 5: 커밋**

```bash
git add src/components/result-map-sheet.tsx
git commit -m "$(cat <<'EOF'
연결: 조율 패널에 실제 통계 비교 카드 데이터 전달

buildStatsComparisonProps(concession.main)으로 계산한 값을
ResultConcessionPanel의 stats prop으로 넘긴다.
EOF
)"
```

---

### Task 5: End-to-End 검증

**Files:** 없음(코드 변경 없음, 실행 확인만)

**Interfaces:**
- Consumes: Task 1~4 전체.
- Produces: 없음.

- [ ] **Step 1: 로컬 Supabase + dev 서버 기동**

Run: `supabase status` (꺼져 있으면 `supabase start`), 이어서 `npm run dev`
Expected: 로컬 Supabase가 떠 있고(`supabase status`가 API URL을 출력), Next dev 서버가 `http://localhost:3000`에서 응답.

- [ ] **Step 2: 콜드 스테이션 세션 만들기**

두 브라우저 컨텍스트(또는 시크릿 창)로 같은 초대 링크에 A/B로 각각 들어가, 통근·예산은 서로 겹치지 않게, 우선순위 조건(년식/인프라/평형)은 Task 1 fixture처럼 겹치는 걸 하나 이상 포함해 온보딩을 완료한다 — 목표는 `get_matches` 결과 0곳(콜드 스테이션)을 만드는 것.

- [ ] **Step 3: 결과 화면에서 패널 확인 (Playwright MCP)**

`mcp__plugin_playwright_playwright__browser_navigate`로 결과 화면에 진입 후 `mcp__plugin_playwright_playwright__browser_snapshot`으로 확인:
- 카드 1(추천안)이 그대로 보이는지
- 점 인디케이터가 2개 보이는지, 두 번째 점을 눌렀을 때 카드 2(`StatsComparisonCard`)로 페이지가 넘어가는지
- 막대차트 행에 실제 숫자(0이 아닌 값 포함)가 표시되는지, `제안` 태그가 붙은 행이 있는지
- 하단 "OO을 양보하면 이런 곳이 열려요" 박스가 조사(을/를)까지 자연스러운지
- `OtherCouplesCard`("다른 커플들은...") 문구가 화면 어디에도 없는지
- CTA 버튼("이 조건으로 바꾸고 동네 보러 가기")이 페이지 전환과 무관하게 항상 보이는지

Expected: 위 항목 전부 통과. 실패 항목이 있으면 해당 태스크로 돌아가 수정 후 재확인한다.

- [ ] **Step 4: 콘솔 에러 확인**

Run: `mcp__plugin_playwright_playwright__browser_console_messages`
Expected: `get_concession_matches` 관련 에러나 React 경고가 없음.

---

## 실행 순서 요약

Task 1(DB) → Task 2(타입/카피) → Task 3(UI 컴포넌트) → Task 4(데이터 연결) → Task 5(E2E 검증). Task 1~2는 서로 독립적으로 만들 수 있지만 Task 3은 Task 2의 타입을, Task 4는 Task 2·3을 소비하므로 이 순서를 지킨다.
