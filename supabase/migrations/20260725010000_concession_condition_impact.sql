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
--
-- 참고(브리프 대비 문법 조정): 브리프 원문은
--   (array['area_size','build_year','infra']::text[] except array[relieved_code])[1]
-- 형태로 배열 EXCEPT를 썼지만, PostgreSQL의 EXCEPT는 두 SELECT 결과집합을
-- 비교하는 집합 연산자이지 배열끼리의 연산자가 아니라 이 형태는 파싱되지
-- 않는다(스칼라 표현식 자리에 EXCEPT를 쓸 수 없음). 계산 결과는 동일하게
-- 유지하면서 unnest ... with ordinality로 순서를 보존한 채 제외 조건만
-- 걸러내는 형태로 바꿨다(원래 배열 순서에서 relieved_code만 빠진 나머지
-- 2개를 그대로 [1],[2]로 뽑는다는 의미는 동일).
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
