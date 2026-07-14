-- =============================================================
-- 세션 대기실(초대장보냄/상대방참여함/상대방입력완료함) 새 UI가 상대방 이름과
-- 완료 여부(체크 배지)를 ready 이전에도 보여줘야 한다. 이름·완료여부는
-- "조건"이 아니라 참여 상태 표시용이라 공개해도 되지만, participants 테이블
-- 자체의 RLS(participants_select)는 상대 행 전체를 ready 이후로 막아둔다
-- (조건/예산까지 같이 있는 행이라 그대로 열어줄 수 없음).
-- 그래서 get_session_presence RPC(SECURITY DEFINER)에 display_name과
-- completed_at만 얹어서 내려준다 — 조건/예산 컬럼은 여전히 노출하지 않는다.
-- =============================================================
create or replace function public.get_session_presence(sid uuid)
returns jsonb language plpgsql security definer stable as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  return (
    select jsonb_build_object(
      'participant_count', count(*),
      'roles', coalesce(jsonb_agg(role order by role), '[]'::jsonb),
      'participants', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', role,
            'display_name', display_name,
            'completed_at', completed_at
          )
          order by role
        ),
        '[]'::jsonb
      )
    )
    from public.participants
    where session_id = sid
  );
end $$;
grant execute on function public.get_session_presence(uuid) to authenticated;
