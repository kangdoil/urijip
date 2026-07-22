-- =============================================================
-- 콜드 스테이션 회복 v2(docs/cold-station-recovery-spec-v2.md) 서브프로젝트 1.
-- 평수/신축/인프라 3개 조건의 순위(1~3)별 필터 강도를 차등화한다:
--   1순위 = 하드필터, 2순위 = 소프트필터(추후 완화 사다리에서 해제 대상),
--   3순위 = 정렬 가중치만(필터 없음, 기존 _priority_score 그대로).
-- relieve_priority_2 파라미터는 이번 스코프에서 쓰지 않는다(항상 기본값 false로
-- 호출) — 다음 서브프로젝트(완화 사다리)의 "2순위 해제" 단계가 true로 재호출해
-- 같은 로직을 재사용한다.
-- =============================================================
create or replace function public._priority_hard_ok(
  pid uuid, satisfied jsonb, relieve_priority_2 boolean default false
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority <= (case when relieve_priority_2 then 1 else 2 end)
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;

-- =============================================================
-- get_matches: cand(예산+통근 하드필터 통과) 뒤에 passed(순위 하드필터 통과)를
-- 다시 도입한다. candidate_count는 cand 기준 그대로, match_count/matches만
-- passed 기준으로 바뀐다. 정렬(_priority_score 합산)은 기존 그대로.
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
    where public._priority_hard_ok(a_p.id, c.satisfied)
      and public._priority_hard_ok(b_p.id, c.satisfied)
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
-- get_solo_preview: A 혼자 기준으로 동일한 순위 하드필터 적용.
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
    where public._priority_hard_ok(a_p.id, c.satisfied)
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
