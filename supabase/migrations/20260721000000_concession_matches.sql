-- =============================================================
-- get_concession_matches: "콜드 스테이션"(필수 교집합 0건) 전용, "서로 양보(AB)"
-- 단일 추천안을 계산한다. 결과 화면 ResultConcessionPanel의 hoods/giveDetail/
-- tipBody를 채우는 RPC — get_fallback_matches(A만/B만 병렬 리스트)를 대체한다.
--
-- 설계 결정(대화로 확정):
--   1) "6개 조건"은 사람당 통근·예산 2개 + 그 사람이 고른 필수조건(0~2개)을
--      개별 플래그로 센다 — 필수조건을 묶지 않아야 병목을 "인프라"처럼 구체
--      필드로 짚을 수 있다. 필수조건을 0~2개 고르는 사람도 있어 총 플래그
--      수는 사람마다 4~6개로 달라질 수 있다(보통 둘 다 2개씩 고르면 6+6=12
--      아니라 사람당 4개, 총 8개 — "6개"는 필수조건을 1개씩만 고른 경우의
--      예시로 이해했다).
--   2) 위반수(sortScore용)는 항상 "원래 상한" 기준으로 계산한다. 후보 풀
--      진입 자격(eligibility)만 "넓힌 상한" 기준을 쓴다 — 그래야 같은 풀
--      안에서도 원래 조건에 더 가까운(덜 양보해도 되는) 동네가 위로 온다.
--   3) 양보는 사람당 "통근 또는 예산 중 하나"만 넓힌다(전부 넓히지 않음).
--      대상은 그 사람의 원래 상한 기준으로 더 많은 동네를 막는 쪽 — 둘 다
--      막는 동네가 0곳이면(원래 상한으로 이미 전부 통과) 그 사람은 양보가
--      필요 없다는 뜻이라 넓히지 않는다. 필수조건은 카테고리형이라 애초에
--      넓힐 수 없다(기존 get_fallback_matches도 동일 전제).
--   4) 기본 양보폭 통근 +15분/예산 +0.8억으로 0곳이면, 상한 양보폭
--      통근 +30분/예산 +1.6억으로 동일 로직을 재실행한다(별도 로직 아님).
--   5) 병목(bottleneck)은 사람별 위반수 계산과 별개로, 전체 8개(또는 그 이하)
--      플래그 중 "원래 상한 기준으로 가장 많은 동네를 탈락시킨 것" 하나를
--      고른다 — 조율 화면에서 그 필드를 하이라이트하는 데 쓴다.
--   6) 상한 양보폭까지도 0곳이고 병목이 필수조건이면, 마지막으로 "상한
--      양보폭 + 병목 필수조건 1개 완화"를 한 번 더 시도한다(별도 조합
--      탐색 아님 — 병목 하나만 추가로 풀어보는 3단계). 실제 세션 데이터로
--      검증: 예산·통근만 넓혀서는 0곳이던 케이스가 병목 필수조건까지 같이
--      풀면 열리는 경우가 있었다. 그래도 0곳이면 조율 화면엔 추천 카드
--      없이 진단 메시지만 남는다(모든 케이스를 커버하진 못함).
-- =============================================================
create or replace function public.get_concession_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  a_musts text[];
  b_musts text[];
  all_musts text[];
  a_must_count int;
  b_must_count int;

  a_commute_fail bigint;
  a_budget_fail bigint;
  b_commute_fail bigint;
  b_budget_fail bigint;

  a_target text; -- 'commute' | 'budget' | null(양보 불필요)
  b_target text;

  bottleneck_role text;
  bottleneck_field text;
  bottleneck_fail_count bigint;

  widen_min int;
  widen_budget bigint;
  widen_level text;
  areas_json jsonb;
  total_count bigint;

  combo_musts text[];
  must_relief jsonb;
  give jsonb;
  result jsonb;

  DEFAULT_COMMUTE_WIDEN constant int := 15;
  MAX_COMMUTE_WIDEN constant int := 30;
  DEFAULT_BUDGET_WIDEN constant bigint := 80000000;
  MAX_BUDGET_WIDEN constant bigint := 160000000;
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

  select coalesce(array_agg(condition_code), '{}') into a_musts
    from public.participant_conditions where participant_id = a_p.id and tier = 'must';
  select coalesce(array_agg(condition_code), '{}') into b_musts
    from public.participant_conditions where participant_id = b_p.id and tier = 'must';
  select array(select distinct unnest(a_musts || b_musts)) into all_musts;
  a_must_count := coalesce(array_length(a_musts, 1), 0);
  b_must_count := coalesce(array_length(b_musts, 1), 0);

  -- ===== 1) 원래 상한 기준 위반 카운트 — 사람별 양보 대상 선택에 쓴다 =====
  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select
      ar.code, st.avg_price_krw, ca.minutes as a_minutes, cb.minutes as b_minutes
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

  -- ===== 2) 병목 판별 — 통근/예산 4개 + 각자 고른 필수조건 개별 실패 카운트 중 최대 =====
  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select
      ar.code,
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
  ),
  candidates as (
    select 'A' as role, 'commute' as field, a_commute_fail as fail_count
    union all
    select 'A', 'budget', a_budget_fail
    union all
    select 'B', 'commute', b_commute_fail
    union all
    select 'B', 'budget', b_budget_fail
    union all
    select 'A', m.condition_code,
      (select count(*) from base b where not coalesce((b.satisfied ->> m.condition_code)::boolean, false))
    from unnest(a_musts) as m(condition_code)
    union all
    select 'B', m.condition_code,
      (select count(*) from base b where not coalesce((b.satisfied ->> m.condition_code)::boolean, false))
    from unnest(b_musts) as m(condition_code)
  )
  select role, field, fail_count into bottleneck_role, bottleneck_field, bottleneck_fail_count
  from candidates
  order by fail_count desc
  limit 1;

  -- ===== 3) Case1(기본 양보폭) → 0곳이면 Case2(상한 양보폭) =====
  widen_min := DEFAULT_COMMUTE_WIDEN;
  widen_budget := DEFAULT_BUDGET_WIDEN;
  widen_level := 'default';

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
    where not exists (
      select 1 from unnest(all_musts) m
      where not coalesce((b.satisfied ->> m)::boolean, false)
    )
  ),
  scored as (
    select
      e.*,
      (e.a_minutes > a_p.commute_max_min)::int
        + (a_p.budget_max_krw is not null and e.avg_price_krw > a_p.budget_max_krw)::int
        + (select count(*) from unnest(a_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as a_violations,
      (e.b_minutes > b_p.commute_max_min)::int
        + (b_p.budget_max_krw is not null and e.avg_price_krw > b_p.budget_max_krw)::int
        + (select count(*) from unnest(b_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as b_violations
    from eligible e
  ),
  ranked as (
    select *,
      ((2 + a_must_count) + (2 + b_must_count) - (a_violations + b_violations)) * 10
        - abs(a_violations - b_violations) as sort_score
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

  -- Case1이 0곳이면 상한 양보폭으로 동일 쿼리를 재실행한다.
  if jsonb_array_length(areas_json) = 0 then
    widen_min := MAX_COMMUTE_WIDEN;
    widen_budget := MAX_BUDGET_WIDEN;
    widen_level := 'max';

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
      where not exists (
        select 1 from unnest(all_musts) m
        where not coalesce((b.satisfied ->> m)::boolean, false)
      )
    ),
    scored as (
      select
        e.*,
        (e.a_minutes > a_p.commute_max_min)::int
          + (a_p.budget_max_krw is not null and e.avg_price_krw > a_p.budget_max_krw)::int
          + (select count(*) from unnest(a_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as a_violations,
        (e.b_minutes > b_p.commute_max_min)::int
          + (b_p.budget_max_krw is not null and e.avg_price_krw > b_p.budget_max_krw)::int
          + (select count(*) from unnest(b_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as b_violations
      from eligible e
    ),
    ranked as (
      select *,
        ((2 + a_must_count) + (2 + b_must_count) - (a_violations + b_violations)) * 10
          - abs(a_violations - b_violations) as sort_score
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

    if jsonb_array_length(areas_json) = 0 then
      widen_level := 'none';
    end if;
  end if;

  -- ===== 4) 상한 양보폭까지도 0곳이고 병목이 필수조건이면, 그 필수조건
  -- 하나만 더 완화해서 마지막으로 재시도한다. bottleneck_role이 실제로
  -- 고른 필수조건에서만 빼야 한다 — 상대도 같은 조건을 필수로 걸었으면
  -- 그 사람 몫은 그대로 남아 combo_musts에도 남는다(한쪽만 낮춘 것으로는
  -- 안 풀리는 게 맞는 동작).
  if widen_level = 'none'
     and bottleneck_field = any(array['area_size', 'build_year', 'infra'])
     and ((bottleneck_role = 'A' and bottleneck_field = any(a_musts))
       or (bottleneck_role = 'B' and bottleneck_field = any(b_musts)))
  then
    combo_musts := array(
      select distinct unnest(
        (case when bottleneck_role = 'A' then array_remove(a_musts, bottleneck_field) else a_musts end)
        || (case when bottleneck_role = 'B' then array_remove(b_musts, bottleneck_field) else b_musts end)
      )
    );

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
        -- widen_min/widen_budget은 3)에서 이미 상한(MAX) 값으로 설정돼 있다.
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
      where not exists (
        select 1 from unnest(combo_musts) m
        where not coalesce((b.satisfied ->> m)::boolean, false)
      )
    ),
    scored as (
      select
        e.*,
        (e.a_minutes > a_p.commute_max_min)::int
          + (a_p.budget_max_krw is not null and e.avg_price_krw > a_p.budget_max_krw)::int
          + (select count(*) from unnest(a_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as a_violations,
        (e.b_minutes > b_p.commute_max_min)::int
          + (b_p.budget_max_krw is not null and e.avg_price_krw > b_p.budget_max_krw)::int
          + (select count(*) from unnest(b_musts) m where not coalesce((e.satisfied ->> m)::boolean, false)) as b_violations
      from eligible e
    ),
    ranked as (
      select *,
        ((2 + a_must_count) + (2 + b_must_count) - (a_violations + b_violations)) * 10
          - abs(a_violations - b_violations) as sort_score
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

    if jsonb_array_length(areas_json) > 0 then
      widen_level := 'combo';
      must_relief := jsonb_build_object('role', bottleneck_role, 'field', bottleneck_field);
    end if;
  end if;

  give := jsonb_build_object(
    'widen_level', widen_level,
    'a', case when a_target is null or widen_level = 'none' then null
      else jsonb_build_object('field', a_target, 'amount', case when a_target = 'commute' then widen_min else widen_budget end)
      end,
    'b', case when b_target is null or widen_level = 'none' then null
      else jsonb_build_object('field', b_target, 'amount', case when b_target = 'commute' then widen_min else widen_budget end)
      end
  );

  result := jsonb_build_object(
    'widen_level', widen_level,
    'give', give,
    'must_relief', must_relief,
    'bottleneck', jsonb_build_object('role', bottleneck_role, 'field', bottleneck_field, 'fail_count', bottleneck_fail_count),
    'areas', areas_json,
    -- areas는 지도 카드용으로 상위 10개만 담는다 — "N곳이 열려요" 같은 실제
    -- 개수 문구는 반드시 total_count를 쓴다(캡에 걸려 실제보다 작게 보이는
    -- 걸 방지).
    'total_count', coalesce(total_count, 0)
  );

  return result;
end $$;
