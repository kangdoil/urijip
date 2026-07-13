# 우리집 · 작업 로드맵

PRD(`docs/PRD-우리집.md` v0.8) 기준 개발 로드맵. 단계를 마칠 때마다 체크 표시를 갱신한다.
완료 기준은 각 항목이 실제로 동작하는 것을 확인한 시점으로 한다 (코드만 작성한 상태는 미완료로 둔다).

## 0. 프로젝트 기반 공사

- [x] Next.js(App Router) + TypeScript + Tailwind + shadcn/ui + Zustand 셋업
- [x] Supabase 클라이언트 연결 (익명 인증 부트스트랩 포함)
- [x] schema.sql을 CLAUDE.md '스키마 주의' 기준으로 반영 후 마이그레이션 적용
      (situation 컬럼 삭제, 필수 제한 트리거 3→2, result_shares 테이블 — 이미 v0.2로 반영돼 있었음을 확인)
- [x] 초대 미리보기 · 세션 참여 현황 조회용 RPC 신설 (`get_invite_preview`, `get_session_presence`)
- [x] A 세션 생성용 `create_session` RPC 신설 (RLS 정책상 세션 생성 직후 응답을 못 돌려받는 구조적 문제를 발견해 수정)
- [x] areas 시드: 성남·하남·과천·의왕·용인(수지·기흥)·광주 행정동 코드/좌표 (119건, `scripts/seed-areas.ts`)
- [x] areas 1차 확장: 수원(영통·권선)·화성(동탄) 33건 추가 (총 152건). SBIZ 상가정보 API 반경조회 응답에서 행정동코드·좌표를 뽑아 시드 — 동탄구는 법정동명이 달라 실거래가 매칭이 시군구 평균으로 대체됨 (PRD §5-1 참고)
- [x] 세션 생성 → 초대 링크(`/j/[code]`, 동적 OG 태그) → `join_session` RPC 참여 최소 플로우
      (API 레벨 종단간 검증 완료 — 실제 브라우저 시크릿창 확인은 사용자 확인 대기)

## 1. 온보딩 플로우 (PRD §6 — 6화면)

- [x] ① 거점·통근 상한 입력 화면 (`/s/[id]/onboard/anchor` — 카카오 로컬 키워드 검색 연동 완료.
      `/api/kakao/search` 프록시 통해 실시간 검색 → 선택 시 anchor_lat/lng 저장. 실 API로 검증함)
- [x] ② 예산 상한 입력 화면 (`/s/[id]/onboard/budget` — mockup 없어 디자인 토큰 기반 자체 구성. 상대와의 충돌 표시는 결과/조율 화면(Phase 2)에서 처리)
- [x] ③ 조건 분류 화면 (`/s/[id]/onboard/conditions` — 평형·년식·인프라 카드 소팅, 필수 슬롯 2개, DB 트리거 제한 실동작 확인)
- [ ] ④ 초대/대기 화면 상세 (카카오톡 공유, Realtime으로 B 완료 반영) — 임시 UI는 기반 공사 단계에서 구현됨
- [x] ⑤ 결과 화면 (`/s/[id]/result` — 구역 카드, 예산 충돌 표시, 0건 시 폴백 UI)
- [x] ⑥ 조율 화면 (`/s/[id]/adjust` — 충돌별 완화 제안, 예산 상향 제안, 상대 제안 동의/거절.
      mockup의 "슬라이더로 실시간 미리보기"는 단순화해 클릭 한 번으로 제안 생성하는 방식으로 구현)

## 2. 매칭 엔진 (PRD §4)

- [x] 1차 필터 — 상한(통근·예산) + 필수 교집합 (`get_matches` RPC)
- [x] 2차 랭킹 — 선호(nice) 가중합 정렬 (`get_matches` 내 order by)
- [x] 충돌 리포트 — "A는 필수, B는 무관"류 조건 명시 + 완화 시 후보 증가량 수치 (`get_conflict_report` RPC)
- [x] 제안-동의 루프 (`decide_proposal` RPC + `/s/[id]/adjust` 화면, proposals 테이블 실연동)
- [x] 폴백: 필수 교집합 0건 시 "A만/B만 반영한 후보" 병렬 제시 (`get_fallback_matches` RPC)

검증 메모: area_stats·commute_cache는 아직 실 데이터가 없어(로드맵 §3·§4 미착수),
합성 테스트 데이터로 RPC 정확성만 검증했다 (1건 매칭 시나리오·0건 폴백 시나리오 모두
API로 직접 호출해 확인, 테스트 데이터는 정리함). area_stats에 평형 판정용
`size_59_ok` 컬럼을 추가했다 (기존 스키마엔 없었음 — 인프라 boolean과 동일 패턴).

## 3. 통근시간 계산 (PRD §5, §9)

- [x] ~~ODsay API 프록시용 Next.js API Route~~ → 카카오모빌리티로 교체 (아래 참고)
- [x] `commute_cache` 우선 조회 후 미스 시에만 API 호출 (`ensureCommuteForOrigin`)
- [x] 100m 격자(origin_key) 캐시 키 설계 적용
- [x] ~~ODsay 요청 제한 대응~~ — 순차 처리 + 요청 간 400ms 딜레이 + 429 재시도(백오프) 구현.
      실측: 119개 구역 전체 계산에 약 1분 50초 (ODsay 사용 시점 기준)
- [x] ~~700m 이내 근접지 처리~~ — ODsay code -98 도보 대체 로직 구현했으나, 배열 응답
      형태를 단일 객체로 잘못 가정해 실제로는 한 번도 매칭되지 않던 버그 발견·수정
      (`commute.ts`). 카카오 전환 후엔 5m 이내 code 104를 1분으로 대체하는 동등한 로직 적용
- [x] **온보딩 블로킹 문제 발견·수정**: `/onboard/anchor`가 배치 전체 완료를 `await`로
      기다렸다가 다음 화면으로 넘어가던 구조라, 152개 구역 기준 실측 최대 141분간 화면이
      멈춘 것처럼 보였음. Next.js `after()`로 응답을 즉시 반환하고 서버에서 계속 계산하도록
      변경 — 클라이언트 탭을 닫아도(모바일 백그라운드 포함) 서버 쪽은 끝까지 진행됨.
      `participants.commute_batch_done_at`으로 완료 시각을 기록하고 결과/조율 화면이
      이를 폴링해 "매칭 0건"과 "아직 계산 중"을 구분하도록 함 (`use-commute-status.ts`)
- [x] **ODsay → 카카오모빌리티 전환**: ODsay API 키가 IP 또는 URI(Service URI) 등록
      방식이라 실행 환경(로컬/샌드박스/Vercel)마다 인증이 막힘(`ApiKeyAuthFailed`)을
      실측으로 확인 — Vercel처럼 아웃바운드 IP가 고정되지 않는 배포 환경과 구조적으로
      안 맞아 카카오모빌리티 자동차 길찾기 API로 교체. 카카오는 대중교통 REST API가
      없어 **통근시간 조건이 대중교통 기준 → 자동차 기준으로 바뀜** (PRD §5·§8 갱신).
      일일 무료 호출 10,000건으로 여유 있어 딜레이를 150ms로 단축
- [x] 온보딩 ①거점 화면에서 anchor 저장 직후 배치 호출 연결
- [x] 카카오 기준 실 API로 전 구역(152개) 검증 완료 — 실제 온보딩 플로우로 E2E 확인,
      148/152 정상 캐싱, 결과 화면까지 정상 도달

## 4. 구역 데이터 배치 (PRD §5, area_stats)

- [x] 국토부 실거래가 API 연동 — 평형(size_59_ok)·예산(avg_price_krw) 통계
- [x] 년식(build_year_avg) — 건축물대장 API 대신 실거래가 API의 buildYear로 통합 처리 (지번 단위 개별 조회인 건축물대장보다 구역 집계에 효율적, PRD §5-1에 근거 명시)
- [x] 상가정보 + 심평원 + 도시공원 API 연동 — 인프라 3항목(mart/hospital/park)
- [x] area_stats 배치 갱신 스크립트 — `scripts/refresh-{park,mart,hospital,trade}-stats.ts`, 실 API로 119개 전 구역 채움 완료

## 5. 결과 공유

- [x] `result_shares` 생성 플로우 + `get_shared_result` 공개 열람 페이지 (`/share/[slug]`, 동적 OG 이미지 포함)
- [ ] 결과 요약 카드에 매칭률·통근시간 추가 (`get_shared_result`가 현재 구역명·시세·년식만 반환 — PRD는 통근시간도 요구하나 공유 시점 스냅샷 저장이 필요해 후속 작업으로 미룸)
- [ ] 카카오톡/인스타그램 공유 연동 (지금은 링크 복사만)
- [ ] 민감정보(예산) 포함 토글 UI (`include_budget` 컬럼은 이미 있음, 기본 false)

## 6. 피드백 수집 (PRD §8)

- [x] 결과 화면 하단 배너 — 👍/👎 1탭 반응 (`FeedbackBanner`, `/result`·`/decided`에 부착)
- [x] 👎 선택 시 서술형 입력 2단계 (선택 사항, 건너뛰기 가능)
- [x] 트리거 조건: 세션 확정(`resolved`, proposal_accepted 대체) 시 즉시, 아니면 4초 체류 후 노출.
      세션당(참여자당) 1회 — `feedback` 테이블 unique 제약이 최종 방어선, 브라우저 세션 스토리지로 재노출도 막음.
      Mixpanel 이벤트(`result_viewed_b` 등)가 아직 없어 정확한 트리거 대신 근사치로 구현 — Mixpanel 연동 후 정교화 필요

## 7. 계측 (PRD §7)

- [ ] Mixpanel 연동
- [ ] 퍼널 이벤트 트래킹: `session_created → invite_sent → invite_opened → b_started → b_completed → result_viewed_a → result_viewed_b → result_shared → proposal_created → proposal_accepted`
- [ ] North Star / KPI①~③ / 가드레일①~② 대시보드 또는 쿼리

## 8. 배포

- [ ] Vercel 프로젝트 연결 및 환경변수 설정
- [ ] 프로덕션 Supabase 마이그레이션 파이프라인 정리
