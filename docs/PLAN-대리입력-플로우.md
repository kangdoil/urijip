# A 대리입력 플로우 전환 계획 (B 없이 바로 결과 보기)

## Context

현재 플로우는 A가 세션 생성 → 온보딩 3단계(거점/예산/조건) → B 초대 → B도 3단계 완료 → 그제야 결과 열람. B가 실제로 접속·완료해야만 하는 구조라 B 접속률이 낮으면 A도 아무것도 못 보고 이탈한다.

새 플로우 (사용자 확정):
1. **대리 입력이 기본**: A가 본인 3단계 → 이어서 B 조건 3단계를 대신 입력하고 바로 결과 열람. 기존 "초대 후 대기" 화면은 기본 경로에서 제거.
2. **전부 스킵 가능**: B 거점(직장)도 스킵 가능 — 스킵 시 B 통근 조건은 매칭에서 제외하고 결과에 "B 통근 미반영" 표시. B 예산 스킵 시 A 예산만 적용. B 조건은 기존 tier='skip'(무관)으로 자연 처리.
3. **초대는 결과 후**: 결과 화면에서 "B에게 공유해 직접 확인받기" CTA (기존 초대 링크 재사용).
4. **B 합류 시 프리필**: B가 링크로 들어오면 A가 대신 입력한 값이 채워진 상태로 보고 수정만 하면 됨. 수정 시 결과 자동 재계산(get_matches는 호출 시 계산).

## 핵심 설계 결정

| 결정 | 내용 | 근거 |
|---|---|---|
| B 행 표현 | `participants.user_id`를 nullable로, A가 **프록시 행(user_id=null)** 생성. B 합류 시 join_session이 그 행을 claim(user_id 세팅) | unique(session_id,user_id)는 NULL을 distinct 취급해 무충돌, unique(session_id,role)이 중복 방지. `session_is_ready`·매칭 함수가 거의 무수정으로 통과 |
| A의 B행 쓰기 | 행 **생성만 RPC**(`create_partner_stub`, SECURITY DEFINER), update/조건 쓰기는 **RLS 완화**("user_id is null인 행은 세션 멤버가 읽고 쓸 수 있다") | 온보딩 3페이지가 점진적 update/upsert라, 저장 필터만 바꾸면 기존 코드 전부 재사용 |
| B 거점 스킵 매칭 | `_session_candidates`의 B 통근 조인을 LEFT JOIN + `(b anchor null OR cb.minutes<=상한)` 분기 | 공유 헬퍼 한 곳만 고치면 get_matches/get_fallback_matches에 전파 |
| 온보딩 UI 재사용 | 기존 3페이지에 `?for=partner`(대리 입력) / `?review=1`(B 검토) 쿼리 파라미터 모드 | 라우트 복제 없이 최소 diff |

## 1단계: DB 마이그레이션 (단독 배포 안전 — 구 프론트는 프록시를 만들지 않으므로 동작 불변)

새 파일 `supabase/migrations/20260719000000_proxy_partner_input.sql` + `docs/schema.sql` 동기화.

1. `alter table participants alter column user_id drop not null;`
2. **RLS 교체** (원칙: user_id null 행 = A의 대리 데이터 = 세션 멤버 공개. B claim 순간부터 기존 비공개 규칙 자동 복원) — 원본: [init_schema.sql:196-221](../supabase/migrations/20260713000000_init_schema.sql#L196-L221)
   - `participants_select` / `participants_update` using에 `or (user_id is null and is_session_member(session_id))` 추가
   - `participants_update`에 `with check (user_id = auth.uid() or user_id is null)` 신설 — A가 프록시 행의 user_id를 임의 세팅(하이재킹)하는 것 차단. claim은 오직 join_session(SECURITY DEFINER) 경유
   - `pcond_select` / `pcond_write` exists 절에 같은 취지의 `or (p.user_id is null and is_session_member(p.session_id))` 추가
3. **RPC 신설** `create_partner_stub(sid uuid, name text default null) returns uuid` (SECURITY DEFINER): 멤버 검증 → B 행 있으면 그 id 반환(멱등) → 없으면 user_id null로 insert
4. **`join_session` 교체** (반환 uuid 유지 — 구 클라이언트 호환): 멤버면 return → **B 프록시 행(user_id is null) 있으면 claim**(user_id=auth.uid(), display_name coalesce) → 정원 검사 → 기존 insert(구 세션 호환). 원본: [init_schema.sql:300-321](../supabase/migrations/20260713000000_init_schema.sql#L300-L321)
5. **`_session_candidates` 교체** (반환 타입 동일 → create or replace 가능) — 원본: [20260714000000_area_coords_in_matches.sql:13-56](../supabase/migrations/20260714000000_area_coords_in_matches.sql#L13-L56)
   - completed_at 게이트는 유지(프록시 행 completed_at으로 통과)
   - B 통근: `left join commute_cache cb on b_p.anchor_lat is not null and ...` + `where ... and (b_p.anchor_lat is null or (cb.minutes is not null and cb.minutes <= b_p.commute_max_min))` → b_minutes가 null로 나감
6. **`get_matches` 교체** (2곳): 정렬키 `p.b_minutes` → `coalesce(p.b_minutes, 0)` (null 정렬 버그 방지), budget `conflict` → 양쪽 모두 not null일 때만 `<>` 비교 (B 예산 스킵을 "충돌"로 오표시 방지). `least(a, null)`은 null 무시라 **B 예산 스킵 시 A 예산 적용은 이미 자연 동작** — 수정 불필요. B 조건 스킵도 musts 배열이 비어 자연 처리.
7. **`get_commute_status` 교체**: `b_ready = (commute_batch_done_at is not null or anchor_lat is null)` — 원본: [20260713120000_commute_batch_status.sql](../supabase/migrations/20260713120000_commute_batch_status.sql)

## 2단계: API 라우트

[src/app/api/odsay/batch-commute/route.ts](../src/app/api/odsay/batch-commute/route.ts): body에 optional `participantId` 추가. 있으면 완료 기록을 `.eq('id', participantId).eq('session_id', sessionId)`로 update — 사용자 세션의 supabase client라 1단계에서 완화한 RLS가 권한을 강제(별도 검사 불필요). 없으면 기존 경로.

## 3단계: 프론트 — A 대리 입력 플로우

1. [src/lib/get-my-participant.ts](../src/lib/get-my-participant.ts): select에 `user_id` 추가 + **`getPartnerStub(supabase, sessionId)`** 헬퍼 신설 (`role='B' and user_id is null` maybeSingle — claim된 행은 안 잡혀 A의 오편집 원천 차단)
2. **신규 인터스티셜** `src/app/s/[id]/onboard/partner-intro/page.tsx`: "배우자 조건을 아는 만큼 입력해주세요, 잘 모르면 건너뛰어도 돼요" + 배우자 닉네임(선택) → `create_partner_stub` RPC → `anchor?for=partner`. B가 이미 claim된 세션이면 result로 리다이렉트.
3. **온보딩 3페이지 `for=partner` 모드** ([anchor](../src/app/s/[id]/onboard/anchor/page.tsx) / budget / [conditions](../src/app/s/[id]/onboard/conditions/page.tsx)):
   - 타겟: partner 모드면 `getPartnerStub`, 아니면 `getMyParticipant`. 저장 필터를 `.eq('id', target.id)`로 통일(자기 모드도 동일 동작)
   - completed_at 리다이렉트·이전단계 가드(anchor 없으면 budget 진입 불가 등)는 partner 모드에서 스킵 허용에 맞게 해제
   - **anchor**: "잘 모름 · 건너뛰기" 버튼(저장 없이 다음으로), 저장 시 batch-commute body에 `participantId: target.id`
   - **budget**: "잘 모름 · 건너뛰기"
   - **conditions**: 기존 '무관'=skip이 항목별 스킵 역할, "잘 모름" 보조 버튼(=skip 선택 후 자동 진행). 마지막에 target.id에 completed_at 기록
   - **라우팅(플로우의 심장)**: self 모드 완료 → `/s/{id}` 대기화면 대신 → `partner-intro`. partner 모드 완료 → `/s/{id}/result`
   - Mixpanel: partner 모드에서는 `input_completed`를 발화하지 않는다(B가 입력한 것처럼 퍼널이 오염됨 — 대리입력용 이벤트 추가 여부는 metrics-events.md 승격 규칙에 따라 별도 논의)
4. **결과 화면** [src/app/s/[id]/result/page.tsx](../src/app/s/[id]/result/page.tsx) + 카드:
   - participants 조회에 `user_id, anchor_label` 추가 → `partnerClaimed`, `partnerAnchorSkipped` 파생
   - `MatchArea.b_minutes: number | null` 타입 변경, [result-area-card.tsx](../src/components/result-area-card.tsx)·result-map-sheet·buildExportText에서 null이면 B 통근 표기 숨김
   - 미claim 시: "상대 조건은 OO님이 대신 입력했어요" 배너 + **초대 CTA** — [/s/[id]/page.tsx](../src/app/s/[id]/page.tsx)의 copy/share 로직을 `src/components/invite-share-button.tsx`로 추출해 재사용(`invite_sent` 트래킹 유지). anchor 스킵 시 "B 통근 미반영" 칩, 예산 null 시 "B 예산 미반영" 칩. "상대 확정" 배지는 미claim 시 숨김
   - **조율하기 버튼**: 미claim이면 제안-동의 루프가 성립 불가(동의할 상대 없음) → `anchor?for=partner`(대리 입력 직접 수정)로 연결
5. **구 대기 화면** `/s/[id]/page.tsx`: 라우트 유지(구 세션 호환). `session_is_ready`면 result로 리다이렉트. 미참여·프록시 없음(구 세션)이면 기존 UI에 "배우자 조건 대신 입력하기" 버튼 추가 → partner-intro.

## 4단계: 프론트 — B 합류(claim) 검토 플로우

1. [src/components/join-form.tsx](../src/components/join-form.tsx): join_session 후 `getMyParticipant` — `completed_at != null`(claim된 프록시)이면 `anchor?review=1`, 아니면 기존 신규 온보딩.
2. **온보딩 3페이지 `review=1` 모드**: completed_at 리다이렉트 스킵, 프리필 값 보며 순회. **completed_at은 유지**(수정 중에도 A의 결과 열람이 안 끊김). 카피 "A님이 대신 입력한 값이에요 — 확인하고 수정해주세요". anchor에서 거점을 **실제 변경 저장할 때만** `commute_batch_done_at: null`도 함께 update → 결과 화면이 "계산 중" 표시 후 자동 재계산. 마지막 → result.

## 하위 호환·엣지케이스

- 진짜 B가 있는 기존 세션: claim 분기 미발동(user_id null 행 없음), 배너 안 뜸, LEFT JOIN은 anchor 있으면 기존과 동일 결과 — 회귀 없음
- DB만 먼저 배포: 구 프론트는 프록시를 못 만들어 신규 경로 미발동 — 안전
- 3단계 배포 후 4단계 전: claim한 B는 기존 리다이렉트를 타고 결과 화면 도달(검토는 못 하지만 안 깨짐)
- A가 거점 스킵 → B가 나중에 입력: batch-commute 본인 경로 + b_ready 게이팅이 커버
- proposals/confirmed_at: 미claim 시 조율 버튼을 대리 수정으로 돌려 회피, "상대 확정" 배지 숨김

## 검증

**SQL 단계** (마이그레이션 적용 후 Supabase SQL Editor):
- A만으로 프록시 풀입력 → `session_is_ready`=true, `get_matches` 정상 / B anchor null → b_minutes null·conflict=false·applied=A예산, `get_commute_status`.b_ready=true / 비멤버의 create_partner_stub·프록시 직접 update·user_id 세팅 → 전부 거부 / join claim 멱등·구세션 insert 경로

**2브라우저 수동** (일반=A, 시크릿=B):
1. A 풀코스: 생성→본인3단계→partner-intro→B 3단계 입력→**결과 즉시 도달**, "대신 입력" 배너+초대 CTA, b_minutes 표시
2. 스킵 코스: B 거점·예산 스킵, 조건 무관 → "B 통근 미반영"/"B 예산 미반영" 칩, A 조건만으로 매칭(후보 수 ≥ 1번)
3. B claim: 초대 링크→프리필 확인→거점 수정→"계산 중"→재계산 결과. A 창에서 배너 사라짐
4. 구 플로우 회귀: 프록시 없는 세션에서 B 신규 join→기존 3단계→정상 결과
5. 보안: 비멤버가 타 세션 온보딩 URL 직접 접근 → `/` 튕김

**배포 순서**: 1(DB) → 2(API) → 3(A 플로우) → 4(B 검토). 각 중간 상태 모두 동작 가능.
