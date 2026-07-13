-- finalize_session: 상대의 제안 없이도, 지금 내 설정 그대로 세션을 바로 확정한다.
-- (제안-동의 루프는 "상대 조건을 바꾸고 싶을 때"를 위한 것이고, 이건 "나는
-- 지금 상태로 충분해, 바로 결과를 보고 싶어"를 위한 지름길이다.)
create or replace function public.finalize_session(sid uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 확정할 수 있어요';
  end if;
  if not public.session_is_ready(sid) then
    raise exception '아직 두 사람 모두 조건 입력을 마치지 않았어요';
  end if;

  update public.sessions set status = 'resolved' where id = sid;
end $$;
