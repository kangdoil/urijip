-- =============================================================
-- 결과 화면 지도+바텀시트 UI를 위해 매칭 결과에 좌표를 실어보낸다.
-- areas.lat/lng는 이미 있었지만 get_matches/get_fallback_matches 응답에
-- 노출되지 않았다 — 지도 핀을 찍으려면 필요하다. 공유 헬퍼
-- _session_candidates 한 곳만 고치면 get_matches/get_fallback_matches/
-- get_conflict_report에 다 퍼지지만, get_conflict_report는 개수만 쓰고
-- 좌표가 필요 없어 그대로 둔다.
-- =============================================================
-- RETURNS TABLE 컬럼 구성이 바뀌면 create or replace로는 안 되고
-- (반환 타입 변경은 replace 불가) drop 후 새로 만들어야 한다.
drop function if exists public._session_candidates(uuid);

create function public._session_candidates(sid uuid)
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
      'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
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

create or replace function public.get_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  a_musts text[];
  b_musts text[];
  all_musts text[];
  low_budget bigint;
  result jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  select coalesce(array_agg(condition_code), '{}') into a_musts
    from public.participant_conditions where participant_id = a_p.id and tier = 'must';
  select coalesce(array_agg(condition_code), '{}') into b_musts
    from public.participant_conditions where participant_id = b_p.id and tier = 'must';
  select array(select distinct unnest(a_musts || b_musts)) into all_musts;

  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);

  with cand as (
    select * from public._session_candidates(sid) c
    where a_p.budget_max_krw is null or c.avg_price_krw <= low_budget
  ),
  passed as (
    select c.* from cand c
    where not exists (
      select 1 from unnest(all_musts) m
      where not coalesce((c.satisfied ->> m)::boolean, false)
    )
  )
  select jsonb_build_object(
    'ready', true,
    'must_conditions', to_jsonb(all_musts),
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
        (select count(*) from public.participant_conditions pc
         where pc.tier = 'nice'
           and pc.participant_id in (a_p.id, b_p.id)
           and coalesce((p.satisfied ->> pc.condition_code)::boolean, false)) desc,
        (p.a_minutes + p.b_minutes) asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

create or replace function public.get_fallback_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  low_budget bigint;
  result jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';
  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);

  with cand as (
    select * from public._session_candidates(sid) c
    where a_p.budget_max_krw is null or c.avg_price_krw <= low_budget
  ),
  a_musts as (
    select coalesce(array_agg(condition_code), '{}') as codes
    from public.participant_conditions where participant_id = a_p.id and tier = 'must'
  ),
  b_musts as (
    select coalesce(array_agg(condition_code), '{}') as codes
    from public.participant_conditions where participant_id = b_p.id and tier = 'must'
  )
  select jsonb_build_object(
    'a_only', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu, 'lat', c.lat, 'lng', c.lng
      ))
      from cand c, a_musts
      where not exists (
        select 1 from unnest(a_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb),
    'b_only', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu, 'lat', c.lat, 'lng', c.lng
      ))
      from cand c, b_musts
      where not exists (
        select 1 from unnest(b_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;
