# 우리집 · 지표 체계 & 이벤트 택소노미

| 항목 | 내용 |
|---|---|
| 문서 버전 | v1.1 |
| 기준 문서 | PRD-우리집.md v0.8 |
| 트래킹 도구 | Mixpanel |
| 분석 단위 | 세션(session_id) 기준. 모든 이벤트에 session_id, role(A/B) 공통 프로퍼티 부착 |

---

## 1. 지표 트리

### 북극성 지표 (NSM)

**확정 버튼 클릭률** — 공동 결과 도달 세션 중 확정 클릭(1인 이상)이 발생한 세션 비율.
서비스가 약속한 가치(공동 후보 확정)에 가장 가까운 행동을 정점에 둔다. 단, 비율 지표는 규모를 담지 못하므로 **주간 확정 세션 수(볼륨)**와 **주간 공동 결과 도달 세션 수(구 NSM)**를 반드시 병행 모니터링한다 — 클릭률이 유지돼도 분모가 줄면 서비스는 죽고 있는 것이다.

### H1 (가치 가설) — 구조화된 조건 입력과 트레이드오프 정보는 두 사람이 공동 후보 구역을 확정하게 만든다

| 층위 | 지표 | 정의 | 소스 이벤트 |
|---|---|---|---|
| 핵심 (행동) | 공동 후보 확정률 | 공동 결과 도달 세션 중 7일 내 양측 모두 확정 클릭한 세션 비율 (`result_confirmed`가 role=A, role=B로 모두 발화). `result_shared`는 보조 신호 | `result_confirmed`, `result_shared` |
| 핵심 (선언) | 결정 자기보고 분포 | 피드백 배너 응답: 정해졌어요 / 아직 고민 중 / 여기엔 없어요 | `feedback_submitted` |
| 지표 품질 | 행동-선언 불일치율 | 양측 확정 세션 중 "여기엔 없어요" 응답 비율, 미확정 세션 중 "정해졌어요" 응답 비율. 분기별 점검 — 높으면 확정 신호 정의 또는 확정 UX를 수정 | 위 두 이벤트 교차 |
| 진단 | 조율 진입률 × 제안 수락률 | 매트릭스 해석: 진입高×수락高=건강한 협상 / 진입高×수락低=조건 설계 마찰 / 진입低×확정高=첫 결과 충분 / 진입低×확정低=가치 전달 실패 | `adjust_changed`, `proposal_created`, `proposal_accepted` |
| 진단 | 제외 기능 사용률 / 복구율 | 결과 도달 세션 중 제외 1건 이상 비율. 복구율이 비정상적으로 높으면 오조작(제외 버튼 위치 문제) 신호 | `area_excluded`, `area_restored` |
| 가드레일 | 필수 교집합 0건 비율 | 완결 세션 중 후보 0곳 비율. 상승 시 조건 설계·필수 제한 재검토 | `zero_result_shown` |

### H2 (전파 가설) — A 입력 완료 후 초대 구조가 B의 참여·완료를 만들며, B 완료율이 서비스 성립의 병목이다

| 층위 | 지표 | 정의 | 소스 이벤트 |
|---|---|---|---|
| KPI① | 초대 발송률 | A 입력 완료 세션 중 초대 발송(링크 복사 포함) 비율. 여기가 낮으면 B 퍼널 이전에 A의 확신 부족이 문제 | `a_completed` → `invite_sent` |
| KPI② | B 초대 수락률 | 초대 링크 열람 → B 입력 시작 | `invite_opened` → `b_started` |
| KPI③ | B 입력 완료율 | B 입력 시작 → 조건 분류 완료 | `b_started` → `b_completed` |
| 진단 | B 단계별 이탈 분포 | 거점/예산/조건 중 어디서 이탈하는지 | `onboarding_step_completed` (role=B) |
| 가드레일 | A 온보딩 이탈률 | 거점 입력 진입 → 초대 화면 도달 실패 비율 | `onboarding_step_completed` (role=A) |

### 보조 (획득 루프 관찰 — 아직 가설 아님, 데이터 확인 후 H3로 승격 검토)

| 지표 | 정의 | 소스 이벤트 |
|---|---|---|
| 결과 공유율 | 결과 도달 세션 중 공유 카드 생성 비율 | `result_shared` |
| 공유 경유 신규 세션 | 공개 카드 열람 → 신규 세션 생성 전환 | `shared_view_opened` → `session_created(source=share_link)` |
| 산출물 다운로드 형식 분포 | PNG vs 텍스트 선택 비율 (확정 산출물의 실제 용도 파악) | `artifact_downloaded` |

---

## 2. 페이지별 이벤트 설계

공통 프로퍼티(전 이벤트): `session_id`, `role`(A/B/미참여), `device`(mobile/desktop)

### ① 랜딩 / 세션 생성
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `session_created` | 세션 생성 완료 | `source`: organic / share_link / invite_reminder |

### ② 초대 참여 페이지 (/j/[code], B 전용)
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `invite_opened` | 페이지 로드 | `is_expired`(만석/무효 코드 여부) |
| `b_started` | join_session RPC 성공 | — |

### ③ 온보딩 — 거점·통근 / 예산 / 조건 분류 (3화면 공통)
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `onboarding_step_completed` | 각 단계 "다음" 성공 | `step`: anchor / budget / conditions |
| `must_limit_hit` | 필수 3번째 지정 시도 차단 | `condition_code` (필수 2개 제한이 실제로 얼마나 부딪히는지 — 제한 완화 판단 재료) |
| `a_completed` / `b_completed` | 조건 분류 완료 (completed_at 기록) | `duration_sec`(시작→완료 소요) |

### ④ 초대/대기 화면 (A 전용)
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `invite_sent` | 카카오톡 공유 또는 링크 복사 | `channel`: kakao / copy |
| `invite_reminder_sent` | 확정 대기 중 리마인드 발송 | `context`: waiting_b / waiting_confirm |

### ⑤ 결과 + 조율 화면 (통합, 핵심 페이지)
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `result_viewed` | 결과 로드 완료 | `is_first_view`, `candidate_count`, `had_conflict` |
| `zero_result_shown` | 교집합 0건 폴백 노출 | `fallback_variant`: a_only / b_only |
| `absence_summary_shown` | 재방문 시 부재중 변경 요약 배너 노출 | `change_count` |
| `adjust_changed` | 조율 컨트롤 조작 (조건 토글/슬라이더) | `condition_code`, `direction`: relax / tighten |
| `proposal_created` | 기준 변경 제안 | `changed_conditions[]` |
| `proposal_accepted` / `proposal_rejected` | 상대의 결정 | `hours_to_decide` |
| `area_excluded` | 구역 제외 | `area_code`, `rank_position`(리스트 몇 번째였는지) |
| `area_restored` | 제외 복구 | `area_code`, `restored_by_excluder`(본인 복구 여부 — 오조작 판별) |
| `result_confirmed` | 확정 버튼 클릭 (이미지 자동 저장 포함) | `role`, `candidate_count_at_confirm`, `is_joint_complete`(이 클릭으로 공동 확정 성립 여부), `image_render_ms`(자동 저장 이미지 생성 소요) |
| `confirm_revoked` | 확정 후 리스트 변경으로 확정 자동 해제 | `revoked_role`, `cause`: exclude / restore / proposal |
| `artifact_downloaded` | 텍스트(.txt) 별도 내려받기 | `format`: txt |
| `result_shared` | 공유 카드 생성 | `include_budget` |
| `feedback_submitted` | 피드백 배너 응답 | `answer`: decided / thinking / not_here, `has_text`, `trigger`: viewed_b / proposal_accepted |

### ⑥ 공유 카드 공개 뷰 (/s/[slug], 비참여자 포함)
| 이벤트 | 트리거 | 프로퍼티 |
|---|---|---|
| `shared_view_opened` | 공개 카드 로드 | `is_session_member` |
| `shared_view_cta_clicked` | "우리도 해보기" CTA 클릭 | — |

---

## 3. 운영 원칙

- 퍼널 정의: `session_created → invite_sent → invite_opened → b_started → b_completed → result_viewed(A·B 각각) → result_confirmed(role별)`. 이 축이 NSM과 H1 핵심 지표를 만드는 뼈대이며, 나머지 이벤트는 진단·품질용이다. 공동 확정은 별도 이벤트가 아니라 `result_confirmed`가 한 세션에서 role=A, role=B 모두 발화했는지로 분석 단계에서 도출한다.
- 이벤트 추가는 "이 데이터로 어떤 결정을 바꿀 것인가"에 답할 수 있을 때만 한다. 위 목록에 없는 이벤트를 구현 중 임의로 추가하지 않는다.
- `result_confirmed`는 확정 버튼 클릭 시 클라이언트에서 발화하되, `is_joint_complete` 프로퍼티 값은 서버 응답(confirmations 2행 성립 여부)을 받아 채운다 — 클라이언트가 자체 판단하면 동시 클릭 경합 시 오류.
- 개인정보: 거점 좌표·주소는 이벤트 프로퍼티에 절대 넣지 않는다. 구역 코드(area_code)까지만 허용.
