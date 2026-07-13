-- =============================================================
-- 피드백 수집 (PRD §8)
-- "이 결과가 도움이 됐나요?" 1탭 반응(up/down) + down일 때만 서술형 코멘트.
-- 세션당(참여자당) 1회만 남기도록 unique 제약으로 강제한다 — 재노출 방지는
-- 클라이언트가 "이미 남겼는지" 조회해서 판단하고, 이 제약은 최종 방어선이다
-- (CLAUDE.md 원칙과 동일: UI 검증은 UX용, DB 제약이 보안/정합성용).
-- =============================================================
create table public.feedback (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  reaction       text not null check (reaction in ('up', 'down')),
  comment        text,
  created_at     timestamptz not null default now(),
  unique (participant_id)
);

alter table public.feedback enable row level security;

create policy feedback_insert on public.feedback
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );

create policy feedback_select on public.feedback
  for select using (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );

create policy feedback_update on public.feedback
  for update using (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );
