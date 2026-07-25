-- =============================================================
-- 조율하기(/adjust) 화면 통근 슬라이더 지원
-- (docs/superpowers/specs/2026-07-25-adjust-commute-slider-design.md).
--
-- get_adjust_data가 쓰는 _session_candidates는 통근을 하드 필터링하고
-- get_matches/get_fallback_matches/get_conflict_report와 공유되므로 그대로
-- 두고, 조율 화면 전용으로 통근 +30분 슬랙을 준 _adjust_candidates를
-- 새로 추가한다. 예산은 원래도 이 계층에서 필터링하지 않으므로 손댈 게 없다.
-- =============================================================

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
  where ca.minutes <= a_p.commute_max_min + 30
    and cb.minutes <= b_p.commute_max_min + 30;
end $$;

create or replace function public.get_adjust_data(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  result jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  select jsonb_build_object(
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu,
        'avg_price_krw', c.avg_price_krw,
        'a_minutes', c.a_minutes, 'b_minutes', c.b_minutes,
        'satisfied', c.satisfied
      ))
      from public._adjust_candidates(sid) c
    ), '[]'::jsonb),
    'a', jsonb_build_object(
      'id', a_p.id,
      'budget_max_krw', a_p.budget_max_krw,
      'commute_max_min', a_p.commute_max_min,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = a_p.id
      ), '{}'::jsonb)
    ),
    'b', jsonb_build_object(
      'id', b_p.id,
      'budget_max_krw', b_p.budget_max_krw,
      'commute_max_min', b_p.commute_max_min,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = b_p.id
      ), '{}'::jsonb)
    )
  ) into result;

  return result;
end $$;

create or replace function public.decide_proposal(pid uuid, accept boolean)
returns void language plpgsql security definer as $$
declare
  prop record;
  my_participant record;
  key text;
  val jsonb;
begin
  select * into prop from public.proposals where id = pid;
  if prop.id is null then
    raise exception '존재하지 않는 제안이에요';
  end if;
  if prop.status <> 'pending' then
    raise exception '이미 처리된 제안이에요';
  end if;
  if not public.is_session_member(prop.session_id) then
    raise exception '세션 참여자만 처리할 수 있어요';
  end if;

  select * into my_participant from public.participants
    where session_id = prop.session_id and user_id = auth.uid();

  if my_participant.id = prop.proposer_id then
    raise exception '본인 제안은 스스로 결정할 수 없어요';
  end if;

  if accept then
    for key, val in select * from jsonb_each(prop.payload)
    loop
      if key in ('area_size', 'build_year', 'infra') then
        insert into public.participant_conditions (participant_id, condition_code, priority)
        values (prop.proposer_id, key, (val #>> '{}')::int)
        on conflict (participant_id, condition_code) do update set priority = excluded.priority;
      elsif key = 'budget_max_krw' then
        update public.participants set budget_max_krw = (val #>> '{}')::bigint
        where id = prop.proposer_id;
      elsif key = 'commute_max_min' then
        update public.participants set commute_max_min = (val #>> '{}')::int
        where id = prop.proposer_id;
      end if;
    end loop;

    update public.proposals set status = 'accepted', decided_at = now() where id = pid;
  else
    update public.proposals set status = 'rejected', decided_at = now() where id = pid;
  end if;
end $$;
