# 우리집 — 프로젝트 규칙

신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾는 서비스.
제품 정의는 docs/PRD-우리집_v2.md, DB는 docs/schema.sql이 단일 기준(source of truth).

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
- 평형/년식/인프라 3개 조건은 "필수/선호" 분류가 아니라 참여자별 1~3순위
  랭킹이다 (participant_conditions.priority). 1순위 조건만 하드필터로
  작동하며, 이는 DB 트리거가 아니라 get_matches/get_solo_preview RPC
  내부의 _priority_hard_ok 함수가 강제한다 (security definer라 클라이언트가
  우회 불가). "필수 인당 2개 제한" 같은 상한 개념은 없다 — 신규 코드에서
  이 개념을 되살리지 않는다.
  UI 검증은 UX용이지 보안용이 아니다.

## 스키마 주의
schema.sql은 supabase/migrations/ 전체를 재생(replay)해 뽑은 실제 최종
상태와 대조 검증된 v0.4다 (2026-07-27 갱신). 이후 마이그레이션을 추가할
때 schema.sql은 자동으로 따라가지 않으니, source of truth로 계속 쓰려면
새 마이그레이션을 반영할 때마다 이 파일도 함께 갱신한다.

## UI
mockups/ 폴더의 HTML이 화면 의도의 기준. 컬러 시스템: A=보라, B=청록.