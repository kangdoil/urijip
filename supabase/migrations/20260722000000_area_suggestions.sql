-- =============================================================
-- 지역 확장 의견 수집 (온보딩 개선 — 대기 화면 상단 배너)
-- "경기도 외 지역도 추천해달라"는 의견을 자유 텍스트로 받는다. 운영자가
-- Supabase Studio(서비스 롤)에서 직접 조회해 지역 확장 우선순위를 판단하는
-- 용도라 클라이언트가 되읽을 필요는 없다 — insert 정책만 둔다.
-- =============================================================
create table public.area_suggestions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  message        text not null check (char_length(trim(message)) between 1 and 200),
  created_at     timestamptz not null default now()
);

alter table public.area_suggestions enable row level security;

create policy area_suggestions_insert on public.area_suggestions
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );
