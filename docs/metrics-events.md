# 우리집 · 지표 체계 & 이벤트 택소노미

| 항목 | 내용 |
|---|---|
| 문서 버전 | v1.2 (MVP 최소화) |
| 기준 문서 | PRD-우리집.md v0.8 |
| 트래킹 도구 | Mixpanel |
| 분석 단위 | 세션(session_id) 기준. 모든 이벤트에 session_id, role(A/B) 공통 프로퍼티 부착 |

---

## 0. MVP 이벤트 선정 기준

이벤트는 다음 세 조건을 모두 만족할 때만 넣는다.

1. **지표 직결** — NSM·H1·H2·가드레일 계산에 직접 쓰인다.
2. **DB 대체 불가** — 제외·제안·확정처럼 `area_exclusions`, `proposals`, `confirmations` 테이블에 이미 기록되는 상태 변화는 Mixpanel에 중복 발화하지 않는다. 진단이 필요하면 Supabase를 직접 쿼리한다.
3. **결정 연결** — 이 데이터로 바꿀 결정이 지금 존재한다.

---

## 1. 지표 트리

### 북극성 지표 (NSM)

**저장 버튼 클릭률** — 공동 결과 도달 세션 중 확정 클릭(1인 이상)이 발생한 세션 비율.
비율 지표는 규모를 담지 못하므로 **주간 확정 세션 수(볼륨)**와 **주간 공동 결과 도달 세션 수**를 반드시 병행 모니터링한다 — 클릭률이 유지돼도 분모가 줄면 서비스는 죽고 있는 것이다.

### H1 (가치 가설)

| 층위 | 지표 | 정의 | 소스 |
|---|---|---|---|
| 핵심 (행동) | 공동 후보 저장률 | 공동 결과 도달 세션 중 7일 내 양측 모두 저장 (확정) 클릭 (`result_saved`가 role=A·B 모두 발화) | `result_saved` |
| 핵심 (선언) | 결정 자기보고 분포 | 피드백 배너 응답: 정해졌어요 / 아직 고민 중 / 여기엔 없어요 | `feedback_submitted` |
| 지표 품질 | 행동-선언 불일치율 | 양측 확정인데 "여기엔 없어요" / 미확정인데 "정해졌어요" 비율. 분기별 점검 | 위 두 이벤트 교차 |
| 가드레일 | 필수 교집합 0건 비율 | `result_viewed`의 `candidate_count=0` 비율 (별도 이벤트 불필요) | `result_viewed` |

### H2 (전파 가설)

| 층위 | 지표 | 정의 | 소스 |
|---|---|---|---|
| KPI① | 초대 발송률 | A 입력 완료 중 초대 발송 비율. 낮으면 B 퍼널 이전에 A의 확신 부족이 문제 | `input_completed(A)` → `invite_sent` |
| KPI② | B 초대 수락률 | 초대 링크 열람 → B 입력 시작 | `invite_opened` → `b_started` |
| KPI③ | B 입력 완료율 | B 입력 시작 → 입력 완료 | `b_started` → `input_completed(B)` |
| 가드레일 | A 온보딩 이탈률 | 세션 생성 → A 입력 완료 실패 비율. 단계별 상세는 페이지뷰로 대체 | `session_created` → `input_completed(A)` |

---

## 2. MVP 이벤트 (9개)

공통 프로퍼티(전 이벤트): `session_id`, `role`(A/B/미참여), `device`

| # | 이벤트 | 페이지 | 트리거 | 프로퍼티 | 쓰이는 곳 |
|---|---|---|---|---|---|
| 1 | `session_created` | 랜딩 | 세션 생성 완료 | `source`: organic / share_link | 퍼널 시작, 획득 루프 |
| 2 | `invite_sent` | 초대/대기 | 카카오 공유 또는 링크 복사 | `channel`: kakao / copy | H2 KPI① |
| 3 | `invite_opened` | /j/[code] | 초대 페이지 로드 | — | H2 KPI② |
| 4 | `b_started` | /j/[code] | join_session 성공 | — | H2 KPI②③ |
| 5 | `input_completed` | 온보딩 종료 | 조건 분류 완료 (completed_at 기록) | `role`, `duration_sec` | H2 KPI①③, 가드레일 |
| 6 | `result_viewed` | 결과 | 결과 로드 완료 | `role`, `is_first_view`, `candidate_count`, `had_conflict` | NSM 분모, 가드레일(0건) |
| 7 | `result_saved` | 결과 | 저장하기 클릭 (확정) | `role`, `is_joint_complete`(서버 응답으로 채움) | NSM, H1 핵심 |
| 8 | `result_retry` | 결과 | 조율하기 클릭 (확정) | | NSM, H1 kpi |
| 8 | `feedback_submitted` | 결과 | 피드백 배너 응답 | `answer`: decided / thinking / not_here, `trigger` | H1 선언 |

## 3. 보류 이벤트 (v2 후보 — 지금은 구현하지 않음)

- `onboarding_step_completed` — 단계별 이탈 상세. MVP는 페이지뷰 + `input_completed` 유무로 갈음
- `adjust_changed`, `proposal_*` — 조율 진단 매트릭스용. `proposals` 테이블 쿼리로 대체
- `area_excluded` / `area_restored` / `confirm_revoked` — `area_exclusions`·`confirmations` 테이블로 대체
- `must_limit_hit` — 필수 제한 완화 판단용. 필요해지면 추가
- `invite_reminder_sent`, `absence_summary_shown`, `artifact_downloaded(txt)`, `shared_view_opened` — 결정 연결이 아직 없음

승격 규칙: 보류 이벤트는 "이 데이터로 무엇을 결정할 것인가"에 답이 생겼을 때 개별 추가한다. 한꺼번에 되살리지 않는다.

---

## 4. 운영 원칙

- 핵심 퍼널: `session_created → invite_sent → invite_opened → b_started → input_completed(B) → result_viewed(A·B) → result_saved(role별)`. 공동 확정은 한 세션에서 role=A·B 모두 발화했는지로 분석 단계에서 도출한다.
- `result_saved`의 `is_joint_complete`는 서버 응답(confirmations 2행 성립 여부)으로 채운다 — 클라이언트 자체 판단 시 동시 클릭 경합 오류.
- 위 9개 외 이벤트를 구현 중 임의로 추가하지 않는다.
- 개인정보: 거점 좌표·주소는 프로퍼티에 절대 넣지 않는다. 구역 코드(area_code)까지만 허용.
