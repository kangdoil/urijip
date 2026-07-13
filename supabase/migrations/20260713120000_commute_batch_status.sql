-- =============================================================
-- 온보딩 거점 화면(①)이 통근시간 배치(ODsay, 구역 수만큼 순차 호출) 완료를
-- 기다렸다가 다음 화면으로 넘어가던 구조를 고친다 — 152개 구역 기준 실측
-- 평균 38분·최악 141분까지 걸려 온보딩이 사실상 멈춘 것처럼 보였다.
--
-- 이제 클라이언트는 배치를 백그라운드로 흘려보내고 바로 다음 단계로 넘어간다.
-- 결과/조율 화면은 commute_batch_done_at을 보고 "아직 계산 중"과 "필수 조건
-- 불충족으로 매칭 0건"을 구분해서 보여준다 (전자를 후자로 오인하면 사용자가
-- 서비스가 고장났다고 오해하고 이탈할 위험이 큼).
-- =============================================================
alter table public.participants add column if not exists commute_batch_done_at timestamptz;
comment on column public.participants.commute_batch_done_at is
  '이 참여자 거점 기준 통근시간 배치(전 구역)가 한 번이라도 끝난 시각. null이면
   아직 계산 중이거나 시도된 적 없음 — 매칭 결과 0건과 구분하는 용도.';

create or replace function public.get_commute_status(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  return jsonb_build_object(
    'a_ready', a_p.commute_batch_done_at is not null,
    'b_ready', b_p.commute_batch_done_at is not null
  );
end $$;
