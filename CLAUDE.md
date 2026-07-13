# 우리집 — 프로젝트 규칙

신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾는 서비스.
제품 정의는 docs/PRD-우리집.md, DB는 docs/schema.sql이 단일 기준(source of truth).

## 스택 (변경 금지)
Next.js App Router + TypeScript, Supabase(Anonymous Auth/Realtime/RLS),
Zustand, Tailwind + shadcn/ui, Mixpanel, Vercel 배포.

## 절대 규칙
- 외부 API 키(ODsay, 국토부, 카카오)는 클라이언트에 노출 금지.
  반드시 Next.js API Route를 프록시로 경유한다.
  예외: 카카오 JS 키(NEXT_PUBLIC_KAKAO_JS_KEY, 지도 SDK 전용)는 도메인 제한으로
  보호되는 공개 키라 클라이언트 노출이 정상이다. 서버 전용 REST 키(KAKAO_REST_API_KEY)와
  혼동하지 말 것 — 지도가 아닌 다른 카카오 API는 여전히 REST 키 + 서버 프록시를 거친다.
- 지역(시군구, 행정동) 하드코딩 금지. 지역 정보는 areas 테이블에서만 온다.
- "상대 입력 완료 전 조건 비공개"는 RLS가 강제한다.
  프론트에서 이 정책을 우회하는 쿼리를 만들지 않는다.
- 통근시간 API 호출 전 반드시 commute_cache를 먼저 조회한다.
- 필수 조건 제한(인당 2개)은 DB 트리거가 최종 방어선이다.
  UI 검증은 UX용이지 보안용이 아니다.

## 스키마 주의
schema.sql은 v0.1 기준이라 PRD v0.3과 차이가 있다. 적용 전 다음을 반영할 것:
sessions.situation 컬럼 삭제, conditions 시드를 5개 조건
(commute/budget/area_size/build_year/infra)으로 교체, 필수 제한 트리거 3→2,
result_shares 테이블 추가.

## UI
mockups/ 폴더의 HTML이 화면 의도의 기준. 컬러 시스템: A=보라, B=청록.