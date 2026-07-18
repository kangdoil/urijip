# 받은 조율(제안) 응답 이벤트 추가 — 설계 문서

| 항목 | 내용 |
|---|---|
| 작성일 | 2026-07-18 |
| 관련 문서 | docs/metrics-events.md (v1.3 → v1.4), docs/schema.sql `public.proposals` |
| 배경 | "받은 조율" 화면에서 상대 제안을 승인/거절했는지, 아니면 아무 액션 없이 이탈했는지를 알고 싶다는 요청 |

## 1. 배경 및 문제

`proposals` 테이블(`status`: pending/accepted/rejected, `decided_at`)에 승인/거절은 이미 기록되지만, **"아무 액션도 하지 않고 화면을 떠난 경우"는 DB에도 Mixpanel에도 전혀 남지 않는다.** `status`가 `pending`으로 남아 있는 상태는 "아직 안 봤다"와 "봤는데 결정 안 하고 나갔다"를 구분하지 못한다.

`docs/metrics-events.md` §0의 "DB 대체 불가" 원칙에 따르면 원래 승인/거절은 Mixpanel에 중복 발화하지 않는 것이 기본 방침이다(§3에 `proposal_*`가 보류 이벤트로 명시되어 있음). 이번 요청은 승인/거절/이탈 세 결과를 **하나의 Mixpanel 퍼널로 함께 보고 싶다**는 명시적 요구이므로, 이 원칙에 대한 예외로 승인·거절도 함께 발화한다. (사용자 확인 완료)

## 2. 이벤트 정의

```ts
proposal_response: { outcome: 'accepted' | 'rejected' | 'abandoned' }
```

- 발화 화면: `/s/[id]/adjust/page.tsx`의 "받은 조율" 뷰 (`pending && iAmDeciding`)에서만
- 공통 프로퍼티: `session_id`, `role` — **role은 항상 결정하는 쪽(수신자)의 role**
- 발화 시점 3가지
  1. **accepted** — `decide(true)` 성공 직후 (결과 화면 이동 전)
  2. **rejected** — `decide(false)` 성공 직후 (`DecisionResultSheet` 노출 전)
  3. **abandoned** — 위 두 결정 없이 화면을 벗어날 때 (앱 내 라우팅 이동 또는 탭 닫기/새로고침)

## 3. 승인/거절 트래킹 위치

`decide(accept)` 함수(`adjust/page.tsx`) 안, RPC(`decide_proposal`) 성공 직후:

```ts
if (accept) {
  outcomeReportedRef.current = true
  track('proposal_response', { session_id: sessionId, role: me.role }, { outcome: 'accepted' })
  router.push(`/s/${sessionId}/result?notice=accepted`)
} else {
  outcomeReportedRef.current = true
  track('proposal_response', { session_id: sessionId, role: me.role }, { outcome: 'rejected' })
  setDecisionSheet('rejected')
}
```

## 4. 이탈 감지 메커니즘

이탈 경로가 두 가지라 각각 다르게 잡는다.

1. **앱 내 이동**(뒤로가기, 알림 스낵바 클릭 등) — Next.js 클라이언트 라우팅으로 컴포넌트가 정상 unmount됨 → `useEffect` cleanup에서 감지
2. **탭 닫기/새로고침/브라우저 종료** — React cleanup이 신뢰성 있게 실행되지 않음 → `pagehide` 이벤트로 감지하고, 이 시점엔 일반 XHR 대신 `transport: 'sendBeacon'` 옵션으로 전송해야 페이지가 사라지기 전에 요청이 끊기지 않는다 (mixpanel-browser의 `RequestOptions.transport` 지원 확인됨)

중복 발화 방지를 위해 `outcomeReportedRef` 하나로 승인/거절/이탈 발화 여부를 공유 관리한다.

```ts
const outcomeReportedRef = useRef(false)

useEffect(() => {
  if (!pending || !iAmDeciding) return
  outcomeReportedRef.current = false

  const reportAbandon = (transport?: 'sendBeacon') => {
    if (outcomeReportedRef.current) return
    outcomeReportedRef.current = true
    track(
      'proposal_response',
      { session_id: sessionId, role: me!.role },
      { outcome: 'abandoned' },
      transport ? { transport } : undefined
    )
  }

  const onPageHide = () => reportAbandon('sendBeacon')
  window.addEventListener('pagehide', onPageHide)

  return () => {
    window.removeEventListener('pagehide', onPageHide)
    reportAbandon()
  }
}, [pending?.id, iAmDeciding, sessionId, me])
```

`lib/mixpanel.ts`의 `track()` 함수는 현재 전송 옵션 파라미터가 없으므로, 4번째 인자로 `RequestOptions`(또는 `{ transport?: 'sendBeacon' }`)를 받아 `mixpanel.track()`에 그대로 전달하도록 시그니처를 확장한다.

### 한계 (문서화만 하고 수용)

같은 미결정 제안을 여러 번 들어왔다 나가면(예: 알림 보고 들어왔다가 나중에 결정하려고 나갔다가 다시 들어와서 결정) `abandoned`가 여러 번 잡히고 마지막에 `accepted`/`rejected`도 잡힌다. 세션 단위가 아니라 **노출(entry) 단위 집계**가 된다.

## 5. 문서 업데이트 (`docs/metrics-events.md`)

- 문서 버전 v1.3 → v1.4, 변경 이력 한 줄 추가 ("조율 응답 이벤트 승격")
- §2 표에 11번째 이벤트로 `proposal_response` 추가 (페이지: 조율, 트리거: 승인/거절 클릭 또는 화면 이탈, 프로퍼티: `role`, `outcome`, 쓰이는 곳: 진단 지표 — 조율 응답 분포)
- §0 "DB 대체 불가" 원칙 옆에 예외 각주 추가: accepted/rejected는 `proposals.status`로도 확인 가능하지만, `abandoned`는 DB에 전혀 남지 않아 세 결과를 하나의 퍼널로 함께 보기 위해 승인/거절도 같이 발화한다는 근거 명시
- §3 보류 목록에서 `proposal_*` 항목 제거(승격되었으므로)

## 6. 변경 파일 요약

- `src/lib/mixpanel.ts` — `EventMap`에 `proposal_response` 추가, `track()`에 전송 옵션 파라미터 추가
- `src/app/s/[id]/adjust/page.tsx` — `decide()`에 승인/거절 트래킹 추가, 이탈 감지 `useEffect` 신설
- `docs/metrics-events.md` — 11번째 이벤트 반영, 버전/이력/§0/§3 갱신

## 7. 테스트 범위

자동화 테스트 프레임워크가 프로젝트에 없으므로(순수 Next.js 앱, 별도 테스트 스위트 미확인 — 구현 단계에서 재확인), 수동 검증으로 갈음한다:
- 승인 클릭 → `accepted` 1회 발화, 이후 unmount 시 `abandoned` 미발화 확인
- 거절 클릭 → `rejected` 1회 발화, 시트 노출 후 결과 화면 이동 시 추가 발화 없음 확인
- 아무 결정 없이 "뒤로가기"로 이동 → `abandoned` 1회 발화 확인
- 아무 결정 없이 탭 닫기 → 네트워크 탭에서 `sendBeacon` 방식 요청 발생 확인 (Mixpanel 프로젝트 라이브 뷰로 최종 확인)
