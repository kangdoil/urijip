-- reopen_session: 결정 완료 화면에서 "다시 조율하기"를 누르면 세션을
-- 다시 미확정 상태로 되돌려서 /adjust로 돌아갈 수 있게 한다.
create or replace function public.reopen_session(sid uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 다시 조율할 수 있어요';
  end if;

  update public.sessions set status = 'waiting' where id = sid;
end $$;
