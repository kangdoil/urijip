-- =============================================================
-- A용 세션 생성 RPC (이번 세션 추가 수정)
--
-- 배경: sessions_select 정책(is_session_member)은 "이 세션에 내 participant
-- 행이 있는가"로 판단한다. 그런데 A가 세션을 막 만든 시점엔 아직 자신의
-- participant 행이 없으므로, "insert into sessions ... returning *"의
-- RETURNING은 SELECT 정책 대상이라 is_session_member가 false가 되어
-- "new row violates row-level security policy" 에러로 막힌다
-- (세션 생성 자체는 성공하지만 응답을 돌려받지 못하는 방식으로 발현됨 —
-- 실제 REST 호출로 재현·확인함).
--
-- join_session이 B를 위해 security definer RPC로 이 문제를 이미 피해가고
-- 있으므로, A에게도 대칭적인 RPC를 준다: 세션 생성 + participant(A) 등록을
-- 한 트랜잭션으로 처리하고, id/invite_code를 함수 리턴값으로 직접 반환한다
-- (RLS의 테이블 SELECT 경로를 타지 않으므로 안전하다).
--
-- sessions_insert 정책은 원래 의도(auth.uid() is not null)로 되돌린다 —
-- 디버깅 중 with check(true)로 임시 완화했던 것을 복구.
-- =============================================================

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert with check (auth.uid() is not null);

drop function if exists public.debug_whoami();
drop function if exists public.debug_insert_session();

create or replace function public.create_session(name text)
returns jsonb language plpgsql security definer as $$
declare
  new_session record;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요';
  end if;

  insert into public.sessions default values
  returning id, invite_code into new_session;

  insert into public.participants (session_id, user_id, role, display_name)
  values (new_session.id, auth.uid(), 'A', name);

  return jsonb_build_object(
    'id', new_session.id,
    'invite_code', new_session.invite_code
  );
end $$;
