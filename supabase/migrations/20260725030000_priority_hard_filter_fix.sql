-- =============================================================
-- 버그 수정: 콜드 스테이션 회복 v2 스펙(docs/cold-station-recovery-spec-v2.md) §2는
--   1순위 = 하드 필터 / 2순위 = 소프트 필터(정렬 가중치) / 3순위 = 정렬 가중치만
-- 인데, 03ed24f(20260722010000_priority_hard_filter.sql)가 _priority_hard_ok의
-- 완화 안 된 기본 상태를 "priority <= 2"로 잘못 구현해 1·2순위를 모두 하드
-- 필터링했다. A·B 각자 최대 2개(합치면 최대 4개)의 AND 조건이 다시 강제되면서
-- get_matches의 추천 동네가 과도하게 줄어드는 리포트로 발견됐다.
--
-- _priority_hard_ok는 20260725000000에서 이미 boolean(2순위만 완화)에서
-- int min_priority(2=아무것도 안 풂/1=2순위 해제/0=전부 해제)로 일반화돼 있어
-- 시그니처는 그대로 두고 "인자를 안 넘겼을 때의 기본값"과 get_matches/
-- get_solo_preview의 호출 방식만 고친다.
-- =============================================================
create or replace function public._priority_hard_ok(
  pid uuid, satisfied jsonb, min_priority int default 1
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority <= min_priority
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;

-- =============================================================
-- get_matches: 순위 하드필터를 1순위만으로 명시 호출(기본값에 암묵적으로
-- 의존하던 것이 이번 버그의 원인이었다 — 앞으로는 호출부에서 항상 명시한다).
-- 그 외 로직(예산/통근 하드필터, _priority_score 가중치 정렬)은 그대로다.
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
    where public._priority_hard_ok(a_p.id, c.satisfied, 1)
      and public._priority_hard_ok(b_p.id, c.satisfied, 1)
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
-- get_solo_preview: A 혼자 기준도 동일하게 1순위만 하드필터.
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

-- =============================================================
-- get_concession_matches: 사다리의 "관대함(min_priority)" 계산을 새 baseline과
-- 맞춘다. 기존엔 relieve=false(0·1단계)일 때 min_priority=2(1·2순위 모두 하드),
-- relieve=true(2단계~)일 때 1로 내려갔는데, get_matches의 기본 하드필터가
-- 이제 항상 1이라 0·1단계가 get_matches보다 더 엄격해져 있었다(항상 0곳 →
-- 사다리 진입 즉시 죽는 단, "출퇴근 소폭" 구제가 실질적으로 발동 못 함).
-- 0·1단계도 baseline과 같은 min_priority=1로 맞춘다.
--
-- 부작용: 이제 relieve 여부와 무관하게 min_priority는 relieve_all이 아닌 한
-- 항상 1이 된다 — 즉 "2순위 해제"(2단계)가 필터 강도 면에서 1단계와 완전히
-- 똑같은 조회가 된다(둘 다 commute_widen=5, min_priority=1). 그래서
-- give.relieved_condition/relieved_all 판정은 (더 이상 유효하지 않은)
-- min_priority 숫자 비교 대신, 사다리 정의에 박혀 있는 원래 relieve/relieve_all
-- 플래그를 직접 봐서 계산하도록 같이 고쳤다 — 안 그러면 0·1단계가 이겨도
-- "2순위 내려놓음" 태그가 잘못 뜨고 apply_concession이 실제로 필요하지 않은
-- 순위 스왑(priority 2↔3)까지 영구 반영해버린다.
--
-- TODO(제품 판단 필요, 이번 마이그레이션에서 임의로 처리하지 않음): 2단계는
-- 이제 1단계와 조회 조건이 완전히 같아 절대 새 후보를 못 만든다(항상
-- 1단계와 total_count가 동일) — 사다리에서 "2순위 해제"가 사실상 도달
-- 불가능한 죽은 단이 됐다. 이 상태가 "3곳 미만이면 다음 단계를 opt-in
-- extra로 보여준다"(스펙 §7) 로직과 만나면, 1단계가 이겼을 때 extra 섹션이
-- 항상 +0곳으로 보이는 부작용도 있다. 옵션: (a) 2단계를 지우고 사다리를
-- 재번호, (b) 2단계의 commute_widen을 1단계와 다른 값으로 조정해 실질적
-- 차이를 만듦, (c) relieve 플래그의 의미 자체를 "정렬 가중치 완화 표시"로
-- 바꿔 필터와 분리. 세 옵션 다 UI 카피(스펙 §4)·Mixpanel
-- recovery_ladder_step 분포·apply_concession의 순위 스왑 트리거와 맞물려
-- 있어 이번 버그 수정 범위를 벗어난다고 판단해 손대지 않았다.
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
  step_relieved boolean;
  step_result jsonb;
  next_step jsonb;
  next_min_priority int;
  next_relieved boolean;
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
    -- relieve_all만 순위 하드필터를 완전히 푼다(0). 그 외엔 get_matches
    -- baseline과 같은 1 — relieve 플래그는 더 이상 min_priority를 바꾸지
    -- 않는다(위 마이그레이션 설명 참고). give 표기는 아래 step_relieved로
    -- 별도 계산한다.
    step_min_priority := case
      when coalesce((step ->> 'relieve_all')::boolean, false) then 0
      else 1
    end;
    step_relieved := (step ->> 'relieve')::boolean
      and not coalesce((step ->> 'relieve_all')::boolean, false);
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
            'relieved_condition', case when step_relieved then a_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_relieved then b_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', step_result -> 'areas',
        'total_count', step_result -> 'total_count'
      );

      relieved_code_for_stats := case
        when step_relieved and a_relieved_code is not null and b_relieved_code is not null and a_relieved_code = b_relieved_code then a_relieved_code
        when step_relieved and a_relieved_code is not null and b_relieved_code is null then a_relieved_code
        when step_relieved and a_relieved_code is null and b_relieved_code is not null then b_relieved_code
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
          else 1
        end;
        next_relieved := (next_step ->> 'relieve')::boolean
          and not coalesce((next_step ->> 'relieve_all')::boolean, false);
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
              'relieved_condition', case when next_relieved then a_relieved_code else null end,
              'relieved_all', next_min_priority = 0
            ),
            'b', jsonb_build_object(
              'commute_widen_min', case when b_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when b_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', case when next_relieved then b_relieved_code else null end,
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
            'relieved_condition', case when step_relieved then a_relieved_code else null end,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', case when step_relieved then b_relieved_code else null end,
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
