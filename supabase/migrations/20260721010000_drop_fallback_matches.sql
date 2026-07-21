-- =============================================================
-- get_fallback_matches(A만/B만 병렬 리스트)는 get_concession_matches(서로
-- 양보 AB 단일안)로 대체되어 프론트에서 더 이상 호출하지 않는다. 삭제한다.
-- =============================================================
drop function if exists public.get_fallback_matches(uuid);
