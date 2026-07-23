# "조금 더 양보하면" 접기 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_concession_matches`가 이미 계산해 내려주는 `extra`(3곳 미만일 때 다음 단계를 opt-in으로 미리 계산한 결과)를 결과 화면에 "조금 더 양보하면 (+N곳)" 접기 섹션으로 노출한다.

**Architecture:** `concession-copy.ts`가 `main`과 `extra`의 `give`를 비교해 "새로 추가된 양보"만 추출하는 `giveDiffText` 헬퍼를 추가하고, `buildConcessionCopy`가 그 결과를 `extraGiveDetail`로 반환한다. `result-map-sheet.tsx`는 `concessionHoods`와 동일한 방식으로 `extraHoods`를 만든다. `ResultConcessionPanel`은 `GroupedAreaList`의 토글 패턴(`useState` + "N곳 더보기 ▼"/"접기 ▲")을 인라인으로 차용해 이 데이터를 렌더링한다.

**Tech Stack:** Next.js App Router, TypeScript, React(client component), Tailwind.

## Global Constraints

- 설계 스펙: `docs/superpowers/specs/2026-07-23-concession-extra-section-design.md` — 데이터 흐름·컴포넌트 설계 그대로.
- **양보 표기는 차이만**: `extra.give`(누적 전체)를 그대로 보여주지 않고 `main.give`와 비교한 diff만 표기.
- **계측 추가 안 함**: `src/lib/mixpanel.ts`의 `EventMap`은 손대지 않는다. 이벤트 설계는 전체 콜드 스테이션 회복 v2(서브1~4) 완료 후 사용자가 별도로 다시 논의하기로 확정됨 — 이번 작업 범위에 Mixpanel 관련 파일 수정을 포함하지 않는다.
- `GroupedAreaList` 자체는 import/재사용하지 않는다(용도가 다름 — 시군구 그룹핑이 아닌 단일 리스트). 패턴(useState 토글 + 버튼 텍스트 스타일)만 참고해 인라인으로 새로 작성.
- **이 저장소엔 자동화 테스트 러너가 없다.** 이번 작업은 SQL 변경이 없는 순수 프론트 변경이라 `npx tsc --noEmit` + `npm run lint` + 개발 서버에서 실세션으로 시각 확인으로 검증한다(원격 배포 불필요, 이전 서브1/2보다 리스크 낮음).
- Repo 컨벤션: 한국어 커밋 메시지

---

## 파일 구조

- **Modify** `src/lib/concession-copy.ts` — `giveDiffText` 헬퍼 추가, `buildConcessionCopy` 반환값에 `extraGiveDetail` 추가.
- **Modify** `src/components/result-concession-panel.tsx` — `'use client'` 추가, `extraHoods`/`extraCount`/`extraGiveDetail` props 추가, 토글 섹션 렌더링.
- **Modify** `src/components/result-map-sheet.tsx` — `extraHoods` 빌드 로직 추가, `ResultConcessionPanel` 호출부에 새 props 3개 전달.

---

### Task 1: `concession-copy.ts` — `giveDiffText` + `extraGiveDetail`

**Files:**
- Modify: `src/lib/concession-copy.ts`

**Interfaces:**
- Produces: `buildConcessionCopy(result: ConcessionMatchResult)`의 반환 타입에 `extraGiveDetail: string`이 추가됨(`extra`가 null이면 빈 문자열). Task 3이 이 값을 그대로 `ResultConcessionPanel`의 `extraGiveDetail` prop에 전달한다.

- [ ] **Step 1: `giveDiffText` 헬퍼 추가**

`src/lib/concession-copy.ts`의 기존 `giveText` 함수(37-45행) 바로 아래에 추가:

```ts
// extra 섹션 전용 — extra.give(그 단계까지의 누적 양보 전체)를 그대로 보여주지
// 않고, main.give와 비교해 "새로 추가된" 부분만 뽑는다(스펙 §7 "어떤 양보가
// 더해졌는지"). relieved_condition은 main에 없다가 extra에 새로 생긴 경우만
// "내려놓음"으로 표기(대부분 이미 2단계에서 해제된 상태라 흔치 않은 케이스).
function giveDiffText(mainSide: ConcessionGiveSide, extraSide: ConcessionGiveSide, role: 'A' | 'B'): string | null {
  const parts: string[] = []
  if (extraSide.relieved_condition && !mainSide.relieved_condition) {
    parts.push(`${role} ${CONDITION_LABEL[extraSide.relieved_condition] ?? extraSide.relieved_condition} 내려놓음`)
  }
  const commuteDiff = extraSide.commute_widen_min - mainSide.commute_widen_min
  if (commuteDiff > 0) parts.push(`${role} +${commuteDiff}분`)
  const budgetDiff = extraSide.budget_widen_krw - mainSide.budget_widen_krw
  if (budgetDiff > 0) parts.push(`${role} +${formatEok(budgetDiff)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
```

- [ ] **Step 2: `buildConcessionCopy`가 `extraGiveDetail`도 반환하도록 수정**

67-93행의 `buildConcessionCopy` 함수를 다음으로 바꾼다:

```ts
export function buildConcessionCopy(result: ConcessionMatchResult) {
  const { main, extra } = result

  const extraGiveDetail = extra
    ? [giveDiffText(main.give.a, extra.give.a, 'A'), giveDiffText(main.give.b, extra.give.b, 'B')]
        .filter((v): v is string => v != null)
        .join(' · ')
    : ''

  if (main.ladder_step == null) {
    return {
      message: '폭을 많이 넓혀도 맞는 동네를 찾기 어려웠어요.',
      giveDetail: '',
      giveTag: null,
      tipTitle: '이렇게 조정해보세요',
      tipBody: '조건이나 우선순위를 조정하면 맞는 동네가 나올 수 있어요.',
      extraGiveDetail,
    }
  }

  const giveParts = [giveText(main.give.a, 'A'), giveText(main.give.b, 'B')].filter(
    (v): v is string => v != null
  )
  const giveDetail =
    giveParts.length > 0 ? giveParts.join(' · ') : '조건을 조율하면 새로 열리는 동네를 여기서 보여드려요'

  return {
    message: STEP_MESSAGE[main.ladder_step],
    giveDetail,
    giveTag: STEP_TAG[main.ladder_step],
    tipTitle: '이렇게 조정해보세요',
    tipBody: '',
    extraGiveDetail,
  }
}
```

(`main.ladder_step == null`인 실패 케이스에서도 `extra`는 항상 null이므로 — 스펙상 사다리 전부 실패 시 extra 없음 — `extraGiveDetail`은 빈 문자열이 되지만, 일관성을 위해 두 분기 모두 필드를 반환하도록 넣는다.)

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `result-map-sheet.tsx`/`result-concession-panel.tsx`에서 아직 새 prop을 안 넘겨서 나는 에러는 없음(이 파일은 반환 타입에 필드가 "추가"되는 것이라 기존 소비자가 깨지지 않음 — TypeScript 구조적 타이핑상 여분 필드는 에러 아님). 이 파일 자체는 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/lib/concession-copy.ts
git commit -m "추가: 조금 더 양보하면 섹션의 양보 차이 계산(giveDiffText/extraGiveDetail)"
```

---

### Task 2: `ResultConcessionPanel` — 접기 섹션 렌더링

**Files:**
- Modify: `src/components/result-concession-panel.tsx`

**Interfaces:**
- Consumes: `extraGiveDetail`(Task 1의 `buildConcessionCopy` 반환값)
- Produces: `ResultConcessionPanelProps`에 `extraHoods: ConcessionAreaData[]`, `extraCount: number`, `extraGiveDetail: string` 추가 — Task 3이 이 3개 prop을 채워 넘긴다.

- [ ] **Step 1: `'use client'` 지시어 추가**

파일 맨 위(1행)에 추가:

```ts
'use client'

```

(빈 줄 하나 두고 기존 `import { ArrowRight, Lightbulb } from 'lucide-react'`가 이어지도록.) `useState`를 쓰려면 클라이언트 컴포넌트여야 한다 — 형제 컴포넌트 `grouped-area-list.tsx`도 동일 패턴으로 시작한다.

- [ ] **Step 2: `useState` import 추가**

```ts
import { useState } from 'react'
```

`'use client'` 다음, `import { ArrowRight, Lightbulb } from 'lucide-react'` 바로 위에 추가.

- [ ] **Step 3: props 인터페이스에 3개 필드 추가**

`ResultConcessionPanelProps`(9-31행)의 `hoods: ConcessionAreaData[]` 줄 바로 다음에 추가:

```ts
  // 사다리 다음 단계를 미리 계산해둔 opt-in 후보(메인과 겹치는 동네는 이미
  // 제외된 차집합) — 비어 있으면 "조금 더 양보하면" 섹션 자체를 렌더링 안 함.
  extraHoods: ConcessionAreaData[]
  // "+N곳" 표기용 실제 개수(extraHoods는 카드용 상위 몇 개만 담겨 있을 수 있음).
  extraCount: number
  // extra 섹션 펼쳤을 때 보여줄 안내 문구 — main 대비 "새로 추가된" 양보만.
  extraGiveDetail: string
```

- [ ] **Step 4: 함수 파라미터 구조분해에 3개 필드 추가 + 토글 상태 추가**

40-51행의 함수 시그니처를 다음으로 바꾼다:

```tsx
export function ResultConcessionPanel({
  message,
  giveDetail,
  giveTag,
  hoods,
  totalCount,
  tipTitle,
  tipBody,
  onAdjust,
  onSelectHood,
  onViewMap,
  extraHoods,
  extraCount,
  extraGiveDetail,
}: ResultConcessionPanelProps) {
  const isZero = totalCount === 0
  const visibleHoods = hoods.slice(0, MAX_VISIBLE_HOODS)
  const [extraOpen, setExtraOpen] = useState(false)
```

- [ ] **Step 5: 카드 리스트 아래에 접기 섹션 추가**

100-108행의 `visibleHoods.map(...)` 블록을 감싸는 `<div className="flex flex-col gap-2.5">...</div>`를 다음으로 바꾼다(안쪽 map은 그대로 두고 바로 뒤에 접기 섹션을 형제로 추가):

```tsx
          <div className="flex flex-col gap-2.5">
            {visibleHoods.map((h) => (
              <ConcessionAreaCard
                key={h.code}
                area={h}
                onSelect={onSelectHood ? () => onSelectHood(h) : undefined}
              />
            ))}

            {extraHoods.length > 0 && (
              <div className="mt-1">
                <button
                  onClick={() => setExtraOpen((v) => !v)}
                  className="w-full py-1 text-center text-caption-l font-semibold text-pink-500"
                >
                  {extraOpen ? '접기 ▲' : `조금 더 양보하면 (+${extraCount}곳) ▼`}
                </button>
                {extraOpen && (
                  <div className="mt-2 flex flex-col gap-2.5">
                    {extraGiveDetail && (
                      <p className="px-1 text-caption-l text-neutral-500">{extraGiveDetail}</p>
                    )}
                    {extraHoods.map((h) => (
                      <ConcessionAreaCard
                        key={h.code}
                        area={h}
                        onSelect={onSelectHood ? () => onSelectHood(h) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
```

이 블록은 `isZero ? (...) : (...)` 삼항의 `else` 분기(99-109행) 안에 있다 — `isZero`일 때(0곳 팁카드 표시)는 애초에 `extraHoods`도 항상 비어있으므로(0곳 상태에선 `main.total_count===0`이고 스펙상 이 경우 사다리가 전부 실패한 것이라 `extra`도 항상 null) 자연히 안 뜬다.

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `result-map-sheet.tsx`에서 새 3개 prop 누락으로 인한 타입 에러(정상 — Task 3에서 해소). 이 파일 자체는 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add src/components/result-concession-panel.tsx
git commit -m "추가: ResultConcessionPanel에 조금 더 양보하면 접기 섹션 렌더링"
```

---

### Task 3: `result-map-sheet.tsx` — `extraHoods` 연결

**Files:**
- Modify: `src/components/result-map-sheet.tsx`

**Interfaces:**
- Consumes: `ConcessionMatchResult.extra`(이미 서브2에서 타입 존재), `computeBenefitTags`(기존), `buildConcessionCopy`의 `extraGiveDetail`(Task 1), `ResultConcessionPanelProps.extraHoods/extraCount/extraGiveDetail`(Task 2)
- Produces: 없음(최종 연결 지점)

- [ ] **Step 1: `extraHoods` 빌드 로직 추가**

`concessionHoods` 빌드 블록 바로 다음(현재 `const concessionCopy = concession ? buildConcessionCopy(concession) : null` 줄 다음)에 추가:

```tsx
  const extraHoods: ConcessionAreaData[] = (concession?.extra?.areas ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    sigungu: a.sigungu,
    lat: a.lat ?? undefined,
    lng: a.lng ?? undefined,
    benefitTags: computeBenefitTags(
      { avg_price_krw: a.avg_price_krw, satisfied: a.satisfied },
      { aBudgetMaxKrw, bBudgetMaxKrw }
    ),
  }))
```

(`aBudgetMaxKrw`/`bBudgetMaxKrw`는 이미 위에서 선언돼 있는 변수를 그대로 재사용 — 새로 선언하지 않는다.)

- [ ] **Step 2: `ResultConcessionPanel` 호출부에 3개 prop 전달**

`<ResultConcessionPanel ... />` 호출부(`giveTag={concessionCopy?.giveTag ?? null}` 다음, `hoods={concessionHoods}` 이후 어딘가)에 추가:

```tsx
                        extraHoods={extraHoods}
                        extraCount={concession?.extra?.total_count ?? 0}
                        extraGiveDetail={concessionCopy?.extraGiveDetail ?? ''}
```

정확한 위치는 기존 props 순서(`message`/`giveDetail`/`giveTag`/`hoods`/`totalCount`/`tipTitle`/`tipBody`/`onAdjust`/`onSelectHood`/`onViewMap`) 중 `hoods` 바로 다음에 넣어 Task 2의 인터페이스 필드 순서와 맞춘다.

- [ ] **Step 3: 타입 체크 + lint**

Run: `npx tsc --noEmit`
Expected: 프로젝트 전체 0 에러.

Run: `npm run lint`
Expected: 이 파일에서 새 에러 없음(기존 무관 오류는 그대로).

- [ ] **Step 4: Commit**

```bash
git add src/components/result-map-sheet.tsx
git commit -m "연결: 결과 화면에 조금 더 양보하면 섹션 데이터 흘려보내기"
```

---

### Task 4: 통합 검증 — 실세션으로 extra 섹션 화면 확인

**Files:** 없음(코드 변경 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`(다른 포트에 이미 떠 있는 인스턴스가 있으면 워크트리 전용으로 별도 포트에 새로 띄운다 — 다른 체크아웃의 서버를 잘못 보는 실수를 피하기 위해 반드시 이번 작업 트리에서 직접 띄운 서버로 확인한다).

- [ ] **Step 2: extra가 실제로 채워지는 세션 재현**

서브프로젝트 2 Task 6에서 썼던 것과 동일한 패턴(실제 `create_session`/`join_session` RPC로 세션 생성, A/B 통근·예산·순위를 의도적으로 타이트하게 설정해 사다리가 여러 단계를 거치며 `main.total_count`가 1~2(3곳 미만)가 되도록 유도)으로 세션을 만들어 `/s/{id}/result`에 접속한다.

- [ ] **Step 3: 화면 확인**

- "조금 더 양보하면 (+N곳) ▼" 버튼이 카드 리스트 아래에 뜨는지
- 클릭하면 펼쳐지면서 "접기 ▲"로 바뀌고, 안내 문구(main 대비 새로 추가된 양보만)와 추가 동네 카드들이 나타나는지
- 추가 동네 카드에도 "얻는 것" 배지가 정상 표시되는지(기존 `computeBenefitTags` 로직 그대로 재사용되므로 정상 동작해야 함)
- 다시 클릭하면 접히는지
- `main.total_count >= 3`이 되는 세션(느슨한 조건)에서는 이 섹션 자체가 안 뜨는지(`extraHoods.length === 0`)
- 콘솔 에러 없는지

- [ ] **Step 4: 테스트 세션 정리**

검증에 쓴 세션을 서비스 롤 키로 삭제.

---

## Self-Review 체크리스트 (실행 전 참고용)

- **스펙 커버리지**: giveDiffText/extraGiveDetail(Task 1) / 접기 UI(Task 2) / 데이터 연결(Task 3) / 검증(Task 4) — 설계 스펙의 전체 데이터 흐름·컴포넌트 설계 커버됨.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드 포함.
- **타입 일관성**: `extraGiveDetail`(Task 1 반환값) → `ResultConcessionPanelProps.extraGiveDetail`(Task 2) → `result-map-sheet.tsx`의 `concessionCopy?.extraGiveDetail`(Task 3) 순서로 정확히 이어짐. `extraHoods: ConcessionAreaData[]` 타입도 기존 `concessionHoods`와 동일 타입 재사용, 새 타입 정의 없음.
- **계측 제외 확인**: 어떤 태스크에도 `mixpanel.ts`/`EventMap` 변경 없음(Global Constraints에 명시된 대로 사용자가 전체 완료 후 별도로 다시 논의하기로 함).
