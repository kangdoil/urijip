-- =============================================================
-- 결과 화면 새 UI: 각자 매물 리스트를 정리("구역 제외")하고 Save를 누르면
-- "확정"되며, 그 확정 여부를 상대 화면 상단 플로팅 배지("상대 확정/미확정")로
-- 보여준다. participants_select RLS는 session_is_ready(둘 다 온보딩 완료)
-- 이후로 상대 행 조회를 이미 허용하므로 새 RLS 없이 컬럼만 추가한다.
-- 갱신도 participants_update(user_id = auth.uid())가 이미 자기 행만 허용해
-- 별도 RPC 없이 클라이언트에서 직접 update한다.
-- =============================================================
alter table public.participants
  add column confirmed_at timestamptz,
  add column saved_area_codes text[];
