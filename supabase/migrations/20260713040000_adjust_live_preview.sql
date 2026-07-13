-- =============================================================
-- get_adjust_data: 조율 화면(⑥) 라이브 프리뷰용 데이터.
--
-- 기존에는 조건 하나 건드릴 때마다 서버에 제안을 만들고 상대 동의를 기다려야
-- 탐색이 가능했다 (화면 전환이 잦아 UX가 나쁘다는 피드백). 이제는 후보 목록과
-- 두 사람의 현재 조건·예산을 한 번에 내려주고, 조건/예산을 이리저리 움직여보는
-- 시뮬레이션은 클라이언트에서 즉시 계산한다 (서버 왕복 없음). 실제로 반영되는
-- 것은 "제안하기"를 눌러 내 쪽 변경분만 proposals에 올릴 때뿐이다 — 상대 동의
-- 전에는 아무것도 바뀌지 않는다는 PRD §4 원칙은 그대로 유지된다.
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
      'budget_max_krw', a_p.budget_max_krw,
      'conditions', coalesce((
        select jsonb_object_agg(condition_code, tier)
        from public.participant_conditions where participant_id = a_p.id
      ), '{}'::jsonb)
    ),
    'b', jsonb_build_object(
      'budget_max_krw', b_p.budget_max_krw,
      'conditions', coalesce((
        select jsonb_object_agg(condition_code, tier)
        from public.participant_conditions where participant_id = b_p.id
      ), '{}'::jsonb)
    )
  ) into result;

  return result;
end $$;
