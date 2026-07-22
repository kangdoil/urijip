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
