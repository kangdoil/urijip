-- =============================================================
-- 매칭 엔진 (로드맵 Phase 2)
--
-- 스키마 보완: area_stats에 평형 조건 판정 컬럼이 없었다.
-- mart_ok/hospital_ok/park_ok(인프라)와 같은 패턴으로 size_59_ok를 추가한다.
-- 판정 기준은 PRD §5: "전용면적 구간 (예: 59㎡ 이상)" — 국토부 실거래가 배치가
-- 이 값을 채운다 (로드맵 Phase 4, 아직 미구현. 지금은 컬럼만 추가).
-- =============================================================
alter table public.area_stats add column if not exists size_59_ok boolean;
comment on column public.area_stats.size_59_ok is
  '전용 59㎡ 이상 매물이 실거래가 데이터상 존재하는가 (평형 조건 판정용)';

-- =============================================================
-- get_matches: PRD §4 매칭 파이프라인
--   1차 필터 — 상한(통근 개별 적용 + 예산 낮은 쪽) + 필수 교집합
--   2차 랭킹 — 선호 충족 수로 정렬
--   충돌 리포트 — "A는 필수, B는 무관"류 조건과 예산 상한 차이를 명시
--   폴백 — 1차 결과 0건이면 "A 필수만 반영" / "B 필수만 반영" 후보를 별도 제시
--
-- 통근시간은 commute_cache(origin_key, area_code, mode)에서만 조회한다
-- (CLAUDE.md 절대 규칙 — API 호출 전 캐시 우선). 캐시가 없는 조합은
-- 후보에서 제외된다 (아직 계산되지 않았을 뿐 "탈락"은 아님을 UI에서 구분해야 함,
-- 로드맵 Phase 3에서 ODsay 연동 후 채워짐).
-- =============================================================
create or replace function public.get_matches(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  a_musts text[];
  b_musts text[];
  all_musts text[];
  low_budget bigint;
  budget_conflict boolean;
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

  select coalesce(array_agg(condition_code), '{}') into a_musts
    from public.participant_conditions where participant_id = a_p.id and tier = 'must';
  select coalesce(array_agg(condition_code), '{}') into b_musts
    from public.participant_conditions where participant_id = b_p.id and tier = 'must';
  select array(select distinct unnest(a_musts || b_musts)) into all_musts;

  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);
  budget_conflict := a_p.budget_max_krw is distinct from b_p.budget_max_krw;

  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  candidate as (
    select
      ar.code, ar.name, ar.sigungu,
      st.avg_price_krw, st.built_year_avg,
      st.mart_ok, st.hospital_ok, st.park_ok, st.size_59_ok,
      ca.minutes as a_minutes, cb.minutes as b_minutes,
      -- 조건 코드 -> area_stats 판정값 매핑 (분류형 3개 고정)
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
    where ca.minutes <= a_p.commute_max_min
      and cb.minutes <= b_p.commute_max_min
      and (a_p.budget_max_krw is null or st.avg_price_krw <= low_budget)
  ),
  passed as (
    select c.*
    from candidate c
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
      'conflict', budget_conflict
    ),
    'candidate_count', (select count(*) from candidate),
    'match_count', (select count(*) from passed),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'sigungu', p.sigungu,
        'avg_price_krw', p.avg_price_krw,
        'a_minutes', p.a_minutes, 'b_minutes', p.b_minutes,
        'satisfied', p.satisfied
      ) order by
        -- 2차 랭킹: 선호(nice) 충족 수 내림차순, 동률이면 A+B 통근시간 합 오름차순
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

-- =============================================================
-- get_fallback_matches: 필수 교집합 0건일 때 폴백.
-- "A의 필수만 반영한 후보"와 "B의 필수만 반영한 후보"를 나란히 반환한다.
-- (PRD §8 폴백 요구사항 — 빈 결과는 세션 폐기로 직결되므로 v1 필수 기능)
-- =============================================================
create or replace function public.get_fallback_matches(sid uuid)
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

  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  candidate as (
    select
      ar.code, ar.name, ar.sigungu, st.avg_price_krw,
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
    where ca.minutes <= a_p.commute_max_min
      and cb.minutes <= b_p.commute_max_min
      and (a_p.budget_max_krw is null or st.avg_price_krw <= low_budget)
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
      from candidate c, a_musts
      where not exists (
        select 1 from unnest(a_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb),
    'b_only', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'sigungu', c.sigungu))
      from candidate c, b_musts
      where not exists (
        select 1 from unnest(b_musts.codes) m
        where not coalesce((c.satisfied ->> m)::boolean, false)
      )
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;
