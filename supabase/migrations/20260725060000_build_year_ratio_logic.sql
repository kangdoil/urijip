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
  a_target text,        -- 'commute' | 'budget' | null(양보 불필요)
  b_target text,
  widen_min int,
  widen_budget bigint,
  min_priority_a int,    -- 2=아무것도 안 풂, 1=2순위 해제, 0=전부 해제
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
