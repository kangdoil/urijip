-- =============================================================
-- 구역 제외/복구를 세션 공유 상태로 만든다. 한쪽이 결과 화면에서
-- 구역을 제외하면 즉시 상대방 화면에도 반영되고, 새로고침해도
-- 유지된다. 두 사람 모두 언제든 복구할 수 있다
-- (PRD: "제외한 구역... 두 사람 모두 언제든 복구 가능").
-- 이력 보존을 위해 소프트 삭제(restored_at) 방식 — 같은 구역을
-- 다시 제외하면 새 row가 생긴다.
-- =============================================================
create table public.area_exclusions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  area_code   text not null references public.areas(code),
  excluded_by uuid not null references public.participants(id),
  excluded_at timestamptz not null default now(),
  restored_by uuid references public.participants(id),
  restored_at timestamptz
);

-- "현재 제외 중" 상태는 (session_id, area_code)당 최대 1행만 허용한다.
create unique index area_exclusions_active_idx
  on public.area_exclusions (session_id, area_code)
  where restored_at is null;

alter table public.area_exclusions enable row level security;

-- area_exclusions: 세션 참여자 조회, 본인 이름으로만 제외 생성,
-- 복구는 제외한 사람이 아니어도 세션 참여자 누구나 가능.
create policy area_exclusions_select on public.area_exclusions
  for select using (public.is_session_member(session_id));
create policy area_exclusions_insert on public.area_exclusions
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = excluded_by and p.user_id = auth.uid())
  );
create policy area_exclusions_restore on public.area_exclusions
  for update using (public.is_session_member(session_id));

alter publication supabase_realtime add table public.area_exclusions;
