-- =============================================================
-- 20260725030000에서 확인된 이슈 정리: "2순위 해제" 단계(구 step=2)가
-- get_matches의 새 baseline(min_priority=1)과 완전히 같은 쿼리가 돼버려
-- 절대 새 후보를 못 만드는 죽은 rung이었다. 이번엔 그 단계를 삭제하고
-- 사다리를 재번호한다.
--
--   구 0(기본 필터)        → 1(그대로)
--   구 1(출퇴근 소폭 +5)   → 그대로 1  ... 아래 표 참고
--   구 2(2순위 해제)       → 삭제
--   구 3(출퇴근 대폭 +15)  → 2
--   구 4(예산 폭 +0.8/1.6억) → 3 (두 크기 모두 3 — 기존에도 4로 같이 묶여 있었다)
--   구 5(전체 해제 안전망) → 4
--
-- relieve_all이 더 이상 "2순위만 푸는 중간 단계"와 구분할 필요가 없어져서
-- (그 중간 단계 자체가 없어졌으므로) min_priority는 이제
-- relieve_all=true면 0, 아니면 항상 1 — 더 이상 별도 relieve 플래그가 필요
-- 없다. give.relieved_condition을 계산하던 분기(step_relieved/next_relieved,
-- a_relieved_code/b_relieved_code 조회)도 함께 지운다 — 그 분기가 유일하게
-- 참조하던 "2순위 해제" 단계 자체가 없어졌으니 이제 도달 불가능한 코드였다.
-- relieved_condition 필드는 스키마 호환을 위해 남기되 값은 항상 null이다.
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

  -- ===== 사다리 단계 정의(누적식, 6개로 축소). relieve_all만 순위 하드필터를
  -- 완전히 푼다 — 그 외엔 전부 get_matches와 같은 min_priority=1. =====
  steps := jsonb_build_array(
    jsonb_build_object('step', 0, 'commute_widen', 0,  'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 1, 'commute_widen', 5,  'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 2, 'commute_widen', 15, 'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 80000000,  'relieve_all', false),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve_all', false),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve_all', true)
  );
  step_count := jsonb_array_length(steps);

  main := null;
  extra := null;

  for i in 0..step_count - 1 loop
    step := steps -> i;
    step_min_priority := case when coalesce((step ->> 'relieve_all')::boolean, false) then 0 else 1 end;
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
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', step_result -> 'areas',
        'total_count', step_result -> 'total_count'
      );

      -- benefit(특정 조건 하나를 완화했을 때의 특징)은 그 조건을 짚어주는
      -- 사다리 단계가 더 이상 없어 항상 null — condition_impact(조건별 완화
      -- 임팩트, 어느 단계가 이겼든 무관하게 계산 가능)만 그대로 계산한다.
      stats_result := public._concession_condition_stats(
        sid, a_target, b_target,
        (step ->> 'commute_widen')::int,
        (step ->> 'budget_widen')::bigint,
        null
      );

      main := main || jsonb_build_object(
        'condition_impact', stats_result -> 'condition_impact',
        'benefit', stats_result -> 'benefit'
      );

      if (step_result ->> 'total_count')::bigint < 3 and i + 1 < step_count then
        next_step := steps -> (i + 1);
        next_min_priority := case when coalesce((next_step ->> 'relieve_all')::boolean, false) then 0 else 1 end;
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
              'relieved_condition', null,
              'relieved_all', next_min_priority = 0
            ),
            'b', jsonb_build_object(
              'commute_widen_min', case when b_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when b_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', null,
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
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
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
