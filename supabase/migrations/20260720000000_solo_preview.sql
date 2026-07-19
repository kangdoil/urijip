-- =============================================================
-- "먼저 둘러보기": B가 아직 온보딩을 마치지 않은 상태에서도 A가 자신의
-- 조건(필수/선호/예산/통근)만으로 매칭된 구역을 미리 볼 수 있게 한다.
-- 기존 get_matches/_session_candidates는 A·B 둘 다 completed_at을
-- 요구해서(20260714000000_area_coords_in_matches.sql:31-34) 이 시나리오에
-- 못 쓴다 — B 데이터 없이 A 기준으로만 계산하는 별도 RPC를 둔다.
-- =============================================================
create or replace function public.get_solo_preview(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  a_musts text[];
  result jsonb;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';

  if a_p.id is null or a_p.completed_at is null then
    raise exception '아직 본인 조건 입력을 마치지 않았어요';
  end if;

  select coalesce(array_agg(condition_code), '{}') into a_musts
    from public.participant_conditions where participant_id = a_p.id and tier = 'must';

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
    where not exists (
      select 1 from unnest(a_musts) m
      where not coalesce((c.satisfied ->> m)::boolean, false)
    )
  )
  select jsonb_build_object(
    'must_conditions', to_jsonb(a_musts),
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
        (select count(*) from public.participant_conditions pc
         where pc.tier = 'nice' and pc.participant_id = a_p.id
           and coalesce((p.satisfied ->> pc.condition_code)::boolean, false)) desc,
        p.a_minutes asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

grant execute on function public.get_solo_preview(uuid) to authenticated;
