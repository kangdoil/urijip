-- =============================================================
-- 신축(build_year) 조건 판정 방식 개선 1/2: 컬럼만 추가한다(로직은 아직
-- 안 바꿈). docs/superpowers/specs/2026-07-25-build-year-ratio-threshold-design.md
-- 참고 — 배포 순서상 이 마이그레이션 → refresh-trade-stats.ts 백필 →
-- 로직 전환 마이그레이션(20260725060000) 순서를 반드시 지켜야 한다.
-- 순서를 바꾸면 build_year_ok가 전부 null인 상태에서 로직만 바뀌어 신축
-- 조건이 일시적으로 전원 탈락하는 역효과가 생긴다.
-- =============================================================
alter table public.area_stats add column build_year_ok boolean;

comment on column public.area_stats.build_year_ok is
  '최근 6개월 실거래 중 10년 이내 준공 비중이 30% 이상이면 true. built_year_avg(평균, 공유 결과 페이지 표시용)와 달리 매칭 판정 전용 — refresh-trade-stats.ts가 채운다.';
