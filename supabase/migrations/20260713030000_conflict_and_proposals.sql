-- =============================================================
-- 충돌 리포트 + 제안-동의 루프 (로드맵 §2 나머지, ⑥ 조율 화면)
--
-- _session_candidates: get_matches/get_fallback_matches/get_conflict_report가
-- 공통으로 쓰는 "통근 상한을 만족하는 구역 + 조건 충족 여부" 계산을 한 곳에 모은다.
-- 예산 필터는 여기서 하지 않는다 — 충돌 리포트가 "더 높은 예산이면 몇 곳 늘어나는지"를
-- 시뮬레이션해야 해서, 호출하는 쪽에서 원하는 예산 기준으로 따로 필터링한다.
-- =============================================================
create or replace function public._session_candidates(sid uuid)
returns table (
  code text, name text, sigungu text,
  avg_price_krw bigint, a_minutes int, b_minutes int,
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

-- get_matches / get_fallback_matches를 헬퍼 기반으로 재정의 (동작은 동일, 예산 필터만
-- 호출부에서 명시적으로 적용하도록 정리)
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
      select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'sigungu', c.sigungu))
      from cand c, a_musts
      where not exists (
        select 1 from unnest(a_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb),
    'b_only', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'sigungu', c.sigungu))
      from cand c, b_musts
      where not exists (
        select 1 from unnest(b_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- =============================================================
-- get_conflict_report: PRD §4 "충돌 리포트"
-- "A는 필수, B는 무관"류 이산 충돌과 예산(연속) 충돌을 명시하고,
-- 각각을 완화했을 때 후보가 몇 곳 늘어나는지 수치로 제시한다.
-- 자동 절충은 하지 않는다 — 여기서는 수치만 계산해서 보여줄 뿐, 반영은
-- 제안-동의 루프(decide_proposal)를 통해서만 일어난다.
-- =============================================================
create or replace function public.get_conflict_report(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  low_budget bigint;
  high_budget bigint;
  all_musts text[];
  current_count int;
  codes text[] := array['area_size', 'build_year', 'infra'];
  code text;
  a_tier text;
  b_tier text;
  relaxed_musts text[];
  relaxed_count int;
  discrete_conflicts jsonb := '[]'::jsonb;
  budget_gain int;
  result jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  select array(select distinct unnest(
    coalesce((select array_agg(condition_code) from public.participant_conditions
              where participant_id in (a_p.id, b_p.id) and tier = 'must'), '{}')
  )) into all_musts;

  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);
  high_budget := greatest(a_p.budget_max_krw, b_p.budget_max_krw);

  select count(*) into current_count
  from public._session_candidates(sid) c
  where c.avg_price_krw <= low_budget
    and not exists (
      select 1 from unnest(all_musts) m
      where not coalesce((c.satisfied ->> m)::boolean, false)
    );

  foreach code in array codes loop
    select tier into a_tier from public.participant_conditions
      where participant_id = a_p.id and condition_code = code;
    select tier into b_tier from public.participant_conditions
      where participant_id = b_p.id and condition_code = code;

    if (a_tier = 'must') <> (b_tier = 'must') then
      relaxed_musts := array(select x from unnest(all_musts) x where x <> code);

      select count(*) into relaxed_count
      from public._session_candidates(sid) c
      where c.avg_price_krw <= low_budget
        and not exists (
          select 1 from unnest(relaxed_musts) m
          where not coalesce((c.satisfied ->> m)::boolean, false)
        );

      discrete_conflicts := discrete_conflicts || jsonb_build_object(
        'condition', code,
        'a_tier', a_tier,
        'b_tier', b_tier,
        'gain_if_relaxed', relaxed_count - current_count
      );
    end if;
  end loop;

  budget_gain := null;
  if a_p.budget_max_krw is distinct from b_p.budget_max_krw then
    select count(*) into budget_gain
    from public._session_candidates(sid) c
    where c.avg_price_krw <= high_budget
      and not exists (
        select 1 from unnest(all_musts) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      );
    budget_gain := budget_gain - current_count;
  end if;

  select jsonb_build_object(
    'current_match_count', current_count,
    'discrete_conflicts', discrete_conflicts,
    'budget_conflict', jsonb_build_object(
      'conflict', a_p.budget_max_krw is distinct from b_p.budget_max_krw,
      'low_budget_krw', low_budget,
      'high_budget_krw', high_budget,
      'gain_if_higher', budget_gain
    )
  ) into result;

  return result;
end $$;

-- =============================================================
-- decide_proposal: 제안-동의 루프의 "동의/거절" 처리.
-- 제안자 본인은 결정할 수 없다 (proposals_decide RLS와 동일한 원칙을 함수 안에서도 재확인).
-- 수락 시 payload에 담긴 변경사항을 "제안자 자신의" participant_conditions/
-- participants 행에 적용한다 — 상대가 동의해야만 제안자의 조건이 실제로 바뀐다는
-- PRD §4 "제안-동의 루프" 원칙 그대로.
-- payload 예: {"build_year": "nice", "budget_max_krw": 550000000}
-- =============================================================
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
        insert into public.participant_conditions (participant_id, condition_code, tier)
        values (prop.proposer_id, key, val #>> '{}')
        on conflict (participant_id, condition_code) do update set tier = excluded.tier;
      elsif key = 'budget_max_krw' then
        update public.participants set budget_max_krw = (val #>> '{}')::bigint
        where id = prop.proposer_id;
      end if;
    end loop;

    update public.proposals set status = 'accepted', decided_at = now() where id = pid;
  else
    update public.proposals set status = 'rejected', decided_at = now() where id = pid;
  end if;
end $$;
