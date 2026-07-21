-- =============================================================
-- 조건 입력을 "필수/선호/무관 분류"에서 "3개 조건 순위 매기기"로 전환한다.
--
-- 배경: 콜드 스테이션(후보 0곳) 원인의 44%가 "두 사람의 필수 합집합이 3개
-- (=area_size/build_year/infra 전부)"였다 — 인당 필수 최대 2개라는 제약이
-- 오히려 사람마다 다른 2개를 고르게 만들어 합집합이 커지는 역설이 있었다.
-- 순위 매기기는 이 3개 조건을 더 이상 하드 필터로 쓰지 않고 정렬 가중치로만
-- 반영해서, 이 카테고리의 콜드 스테이션 원인 자체를 구조적으로 없앤다
-- (통근/예산은 여전히 하드 상한 — 대화에서 순위 UX 범위를 이 3개로 한정).
--
-- tier(must/nice/skip 독립 분류)를 priority(1~3, 참여자당 순열)로 바꾼다.
-- 기존 tier 데이터는 같은 tier가 중복될 수 있어 순열로 깔끔히 못 옮긴다 —
-- 아직 출시 전 테스트 세션들이라 초기화하고 온보딩에서 다시 순위를 매기게 한다.
-- =============================================================

drop trigger if exists trg_must_limit on public.participant_conditions;
drop function if exists public.enforce_must_limit();
-- 프론트 어디서도 호출하지 않는 죽은 함수였고(grep 확인), tier를 참조해 그대로
-- 둘 수 없다 — get_fallback_matches를 지웠을 때와 같은 이유로 함께 정리한다.
drop function if exists public.get_conflict_report(uuid);

truncate table public.participant_conditions;
alter table public.participant_conditions drop column tier;
alter table public.participant_conditions add column priority int not null check (priority between 1 and 3);
-- deferrable + initially deferred: 순위를 맞바꿀 때(예: 1위<->2위) 한 트랜잭션
-- 안에서 잠깐 두 행이 같은 priority를 갖는 중간 상태를 거치므로, 커밋 시점에만
-- 유일성을 검사해야 한다.
alter table public.participant_conditions
  add constraint participant_conditions_priority_unique
  unique (participant_id, priority) deferrable initially deferred;

comment on column public.participant_conditions.priority is
  '참여자별 1~3위 순위(1=가장 중요). 더 이상 하드 필터가 아니라 결과 정렬 가중치로만 쓰인다.';

-- =============================================================
-- 헬퍼: 한 참여자의 순위 가중치 합 — weight(priority) = 4 - priority
-- (1위=3점, 2위=2점, 3위=1점). get_matches/get_concession_matches/
-- get_solo_preview가 공통으로 쓴다.
-- =============================================================
create or replace function public._priority_score(pid uuid, satisfied jsonb)
returns int language sql stable as $$
  select coalesce(sum(4 - pc.priority), 0)::int
  from public.participant_conditions pc
  where pc.participant_id = pid
    and coalesce((satisfied ->> pc.condition_code)::boolean, false);
$$;

-- =============================================================
-- get_matches: 통근·예산만 하드 상한, 3개 조건(평형/년식/인프라)은
-- 두 사람의 순위 가중치 합으로 정렬한다(더 이상 탈락 없음).
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
    'match_count', (select count(*) from cand),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu,
        'avg_price_krw', c.avg_price_krw,
        'a_minutes', c.a_minutes, 'b_minutes', c.b_minutes,
        'lat', c.lat, 'lng', c.lng,
        'satisfied', c.satisfied
      ) order by
        public._priority_score(a_p.id, c.satisfied) + public._priority_score(b_p.id, c.satisfied) desc,
        (c.a_minutes + c.b_minutes) asc
      )
      from cand c
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- =============================================================
-- get_concession_matches: 콜드 스테이션(후보 0곳) 전용 "서로 양보(AB)" 추천.
-- 3개 조건이 더 이상 하드 필터가 아니므로, 콜드 스테이션은 이제 통근·예산
-- 상한 때문에만 발생한다 — must_relief/combo 3단계가 통째로 사라진다
-- (풀 수 있는 "필수조건"이 더 이상 존재하지 않음).
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

  a_target text; -- 'commute' | 'budget' | null(양보 불필요)
  b_target text;

  bottleneck_role text;
  bottleneck_field text;
  bottleneck_fail_count bigint;

  widen_min int;
  widen_budget bigint;
  widen_level text;
  areas_json jsonb;
  total_count bigint;

  give jsonb;
  result jsonb;

  DEFAULT_COMMUTE_WIDEN constant int := 15;
  MAX_COMMUTE_WIDEN constant int := 30;
  DEFAULT_BUDGET_WIDEN constant bigint := 80000000;
  MAX_BUDGET_WIDEN constant bigint := 160000000;
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

  -- ===== 1) 원래 상한 기준 위반 카운트 — 사람별 양보 대상(통근/예산) 선택에 쓴다 =====
  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select
      ar.code, st.avg_price_krw, ca.minutes as a_minutes, cb.minutes as b_minutes
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

  -- ===== 2) 병목 판별 — 통근/예산 4개 중 최대(순위 조건은 하드 필터가 아니라 병목 후보에서 빠진다) =====
  select role, field, fail_count into bottleneck_role, bottleneck_field, bottleneck_fail_count
  from (
    values ('A', 'commute', a_commute_fail), ('A', 'budget', a_budget_fail),
           ('B', 'commute', b_commute_fail), ('B', 'budget', b_budget_fail)
  ) as candidates(role, field, fail_count)
  order by fail_count desc
  limit 1;

  -- ===== 3) Case1(기본 양보폭) → 0곳이면 Case2(상한 양보폭) =====
  widen_min := DEFAULT_COMMUTE_WIDEN;
  widen_budget := DEFAULT_BUDGET_WIDEN;
  widen_level := 'default';

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
  scored as (
    select
      b.*,
      public._priority_score(a_p.id, b.satisfied) + public._priority_score(b_p.id, b.satisfied) as priority_score,
      (b.a_minutes > a_p.commute_max_min)::int
        + (a_p.budget_max_krw is not null and b.avg_price_krw > a_p.budget_max_krw)::int as a_violations,
      (b.b_minutes > b_p.commute_max_min)::int
        + (b_p.budget_max_krw is not null and b.avg_price_krw > b_p.budget_max_krw)::int as b_violations
    from base b
  )
  select
    coalesce(jsonb_agg(x.obj order by x.rnk) filter (where x.rnk <= 10), '[]'::jsonb),
    count(*)
  into areas_json, total_count
  from (
    select
      jsonb_build_object(
        'code', s.code, 'name', s.name, 'sigungu', s.sigungu, 'lat', s.lat, 'lng', s.lng,
        'avg_price_krw', s.avg_price_krw, 'a_minutes', s.a_minutes, 'b_minutes', s.b_minutes,
        'satisfied', s.satisfied, 'a_violations', s.a_violations, 'b_violations', s.b_violations
      ) as obj,
      row_number() over (order by s.priority_score desc, (s.a_minutes + s.b_minutes) asc) as rnk
    from scored s
  ) x;

  -- Case1이 0곳이면 상한 양보폭으로 동일 쿼리를 재실행한다.
  if jsonb_array_length(areas_json) = 0 then
    widen_min := MAX_COMMUTE_WIDEN;
    widen_budget := MAX_BUDGET_WIDEN;
    widen_level := 'max';

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
    scored as (
      select
        b.*,
        public._priority_score(a_p.id, b.satisfied) + public._priority_score(b_p.id, b.satisfied) as priority_score,
        (b.a_minutes > a_p.commute_max_min)::int
          + (a_p.budget_max_krw is not null and b.avg_price_krw > a_p.budget_max_krw)::int as a_violations,
        (b.b_minutes > b_p.commute_max_min)::int
          + (b_p.budget_max_krw is not null and b.avg_price_krw > b_p.budget_max_krw)::int as b_violations
      from base b
    )
    select
      coalesce(jsonb_agg(x.obj order by x.rnk) filter (where x.rnk <= 10), '[]'::jsonb),
      count(*)
    into areas_json, total_count
    from (
      select
        jsonb_build_object(
          'code', s.code, 'name', s.name, 'sigungu', s.sigungu, 'lat', s.lat, 'lng', s.lng,
          'avg_price_krw', s.avg_price_krw, 'a_minutes', s.a_minutes, 'b_minutes', s.b_minutes,
          'satisfied', s.satisfied, 'a_violations', s.a_violations, 'b_violations', s.b_violations
        ) as obj,
        row_number() over (order by s.priority_score desc, (s.a_minutes + s.b_minutes) asc) as rnk
      from scored s
    ) x;

    if jsonb_array_length(areas_json) = 0 then
      widen_level := 'none';
    end if;
  end if;

  give := jsonb_build_object(
    'widen_level', widen_level,
    'a', case when a_target is null or widen_level = 'none' then null
      else jsonb_build_object('field', a_target, 'amount', case when a_target = 'commute' then widen_min else widen_budget end)
      end,
    'b', case when b_target is null or widen_level = 'none' then null
      else jsonb_build_object('field', b_target, 'amount', case when b_target = 'commute' then widen_min else widen_budget end)
      end
  );

  result := jsonb_build_object(
    'widen_level', widen_level,
    'give', give,
    'bottleneck', jsonb_build_object('role', bottleneck_role, 'field', bottleneck_field, 'fail_count', bottleneck_fail_count),
    'areas', areas_json,
    'total_count', coalesce(total_count, 0)
  );

  return result;
end $$;

-- =============================================================
-- get_solo_preview: A 조건만으로 미리보기(3)와 동일하게 순위 가중치 정렬로 전환.
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
  )
  select jsonb_build_object(
    'priorities', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
                   from public.participant_conditions where participant_id = a_p.id),
    'budget_krw', a_p.budget_max_krw,
    'candidate_count', (select count(*) from cand),
    'match_count', (select count(*) from cand),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu,
        'avg_price_krw', c.avg_price_krw,
        'a_minutes', c.a_minutes,
        'lat', c.lat, 'lng', c.lng,
        'satisfied', c.satisfied
      ) order by
        public._priority_score(a_p.id, c.satisfied) desc,
        c.a_minutes asc
      )
      from cand c
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

grant execute on function public.get_solo_preview(uuid) to authenticated;

-- =============================================================
-- get_adjust_data: conditions(코드->tier) 대신 priorities(코드->순위)를 내려준다.
-- =============================================================
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
      from public._session_candidates(sid) c
    ), '[]'::jsonb),
    'a', jsonb_build_object(
      'id', a_p.id,
      'budget_max_krw', a_p.budget_max_krw,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = a_p.id
      ), '{}'::jsonb)
    ),
    'b', jsonb_build_object(
      'id', b_p.id,
      'budget_max_krw', b_p.budget_max_krw,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = b_p.id
      ), '{}'::jsonb)
    )
  ) into result;

  return result;
end $$;

-- =============================================================
-- decide_proposal: payload의 조건 값이 이제 tier 문자열이 아니라 priority 정수.
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
        insert into public.participant_conditions (participant_id, condition_code, priority)
        values (prop.proposer_id, key, (val #>> '{}')::int)
        on conflict (participant_id, condition_code) do update set priority = excluded.priority;
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
