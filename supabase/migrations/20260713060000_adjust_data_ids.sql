-- get_adjust_data에 참여자 id를 포함시킨다 — 클라이언트가 pending proposal의
-- proposer_id를 A/B 중 누구인지 판별해서, 제안자 쪽 조건을 "제안된 값으로 잠금"
-- 표시하려면 필요하다.
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
      'conditions', coalesce((
        select jsonb_object_agg(condition_code, tier)
        from public.participant_conditions where participant_id = a_p.id
      ), '{}'::jsonb)
    ),
    'b', jsonb_build_object(
      'id', b_p.id,
      'budget_max_krw', b_p.budget_max_krw,
      'conditions', coalesce((
        select jsonb_object_agg(condition_code, tier)
        from public.participant_conditions where participant_id = b_p.id
      ), '{}'::jsonb)
    )
  ) into result;

  return result;
end $$;
