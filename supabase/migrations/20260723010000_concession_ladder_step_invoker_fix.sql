-- =============================================================
-- 보안 수정: _concession_ladder_step이 security definer로 선언되어 있어
-- 부모 함수(get_concession_matches)의 is_session_member(sid) 가드 없이
-- 누구나(익명 인증 포함) RPC로 직접 호출하면 RLS를 완전히 우회해
-- participants/area_stats/commute_cache의 비공개 데이터(상대방 통근시간,
-- 좌표, 예산 등)를 읽을 수 있는 취약점이 있었다. CLAUDE.md의 핵심 원칙
-- ("상대 입력 완료 전 조건 비공개는 RLS가 강제한다")를 위반한다.
--
-- 수정: security definer 키워드만 제거해 형제 헬퍼(_priority_hard_ok,
-- _priority_score)와 동일하게 암묵적 security invoker로 되돌린다.
--   - get_concession_matches(여전히 security definer)에서 호출될 때는
--     호출부의 실행 컨텍스트를 그대로 물려받으므로 RLS 우회 동작은
--     기존과 동일하게 유지된다(정상 경로 영향 없음).
--   - 비참여자가 직접 호출하면 이제 호출자 본인 권한으로 실행되어
--     participants_select 정책(user_id = auth.uid() OR
--     (is_session_member(session_id) AND session_is_ready(session_id)))이
--     적용되고, 결과적으로 a_p/b_p가 비어 total_count=0의 안전한
--     빈 결과만 돌려준다.
--
-- 함수 본문은 20260723000000_concession_ladder.sql의 배포본에서
-- security definer 키워드 한 곳만 제외하고 그대로 복사했다.
-- =============================================================
create or replace function public._concession_ladder_step(
  sid uuid,
  a_target text,        -- 'commute' | 'budget' | null(양보 불필요)
  b_target text,
  widen_min int,
  widen_budget bigint,
  relieve_a2 boolean,
  relieve_b2 boolean
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
  eligible as (
    select b.* from base b
    where public._priority_hard_ok(a_p.id, b.satisfied, relieve_a2)
      and public._priority_hard_ok(b_p.id, b.satisfied, relieve_b2)
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
