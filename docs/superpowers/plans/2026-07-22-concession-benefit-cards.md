# 서로 양보(AB) 패널 혜택 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과 화면 0곳 폴백(`ResultConcessionPanel`)의 후보 동네 카드를, 참고 스크린샷과 같은 "동네명 + 얻는 것: 태그" 미니멀 구조로 교체한다.

**Architecture:** 순수 계산 함수(`computeBenefitTags`)로 태그 로직을 분리하고, 캐러셀 전용 `ResultAreaCard`와 별개인 새 `ConcessionAreaCard` 프레젠테이션 컴포넌트를 만든다. `result-map-sheet.tsx`에서 `concession.areas` + `participants`(예산 데이터)를 조합해 `ConcessionAreaData[]`를 만들고 `ResultConcessionPanel` → `ConcessionAreaCard`로 흘려보낸다. RPC/DB 변경 없음.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind (design.md 토큰), React 함수형 컴포넌트.

## Global Constraints

- 스택 변경 금지 (Next.js/TS/Tailwind 그대로) — `CLAUDE.md`
- 지역 하드코딩 금지 — 이 작업은 이미 계산된 `concession.areas` 데이터만 다루므로 해당 없음
- 카드 스타일: `bg-white rounded-2xl p-4 shadow-[0_10px_20px_rgba(0,0,0,0.04)]`, 동네명 `text-title-sb font-semibold text-neutral-900`, 태그 라벨 `text-neutral-500`, 태그 값 `text-pink-600 font-bold` — 설계 스펙(`docs/superpowers/specs/2026-07-22-concession-benefit-cards-design.md`) §컴포넌트 설계
- 태그 판정 순서 고정: 예산 여유 → 넓은 평수 → 신축 → 인프라, 최대 2개, 전부 false면 태그 줄 숨김 — 같은 스펙 §"얻는 것" 태그 계산 로직
- **이 저장소엔 자동화 테스트 러너가 없다**(jest/vitest 미설치, `package.json`에 test 스크립트 없음). 새 테스트 프레임워크 도입은 이번 스코프 밖이다. 각 스텝의 "테스트" 단계는 `npx tsc --noEmit`(타입 체크) + `npm run lint` + 개발 서버로 직접 렌더 확인으로 대체한다.

---

## 파일 구조

- **Create** `src/lib/concession-benefit-tags.ts` — 순수 함수 `computeBenefitTags`. 지도/컴포넌트와 무관한 계산만 담당(재사용·검증이 쉬움).
- **Create** `src/components/concession-area-card.tsx` — `ConcessionAreaData` 타입 + `ConcessionAreaCard` 컴포넌트. `ResultAreaCard`(`src/components/result-area-card.tsx`)와 같은 패턴(타입을 컴포넌트 파일에 co-locate)으로 만든다.
- **Modify** `src/components/result-concession-panel.tsx` — `hoods` prop 타입과 카드 렌더링을 교체.
- **Modify** `src/components/result-map-sheet.tsx` — `concessionHoods` 빌드 로직에 예산 데이터 + `computeBenefitTags` 연결.

---

### Task 1: `computeBenefitTags` 순수 함수

**Files:**
- Create: `src/lib/concession-benefit-tags.ts`

**Interfaces:**
- Produces: `computeBenefitTags(area: { avg_price_krw: number | null; satisfied: Record<string, boolean> }, budgets: { aBudgetMaxKrw: number | null; bBudgetMaxKrw: number | null }): string[]` — Task 4에서 이 시그니처 그대로 호출한다.

- [ ] **Step 1: 함수 구현**

`src/lib/concession-benefit-tags.ts`:

```ts
// get_concession_matches가 내려주는 satisfied(area_size/build_year/infra)와
// 두 참여자의 원래 예산 상한을 조합해, 서로 양보(AB) 카드에 보여줄 "얻는 것"
// 태그를 계산한다. 표시 순서는 예산 여유 → 넓은 평수 → 신축 → 인프라로
// 고정하고 최대 2개까지만 반환한다. 4개 판정이 전부 false면 빈 배열을
// 반환하고, 호출부(ConcessionAreaCard)는 이때 "얻는 것" 줄 자체를 숨긴다.
const MAX_BENEFIT_TAGS = 2

// 원래 예산 상한(min)보다 이 비율 이상 저렴하면 "예산 여유"로 판정한다.
const BUDGET_HEADROOM_RATIO = 0.9

export function computeBenefitTags(
  area: { avg_price_krw: number | null; satisfied: Record<string, boolean> },
  budgets: { aBudgetMaxKrw: number | null; bBudgetMaxKrw: number | null }
): string[] {
  const tags: string[] = []

  const budgetCeilings = [budgets.aBudgetMaxKrw, budgets.bBudgetMaxKrw].filter(
    (v): v is number => v != null
  )
  if (budgetCeilings.length > 0 && area.avg_price_krw != null) {
    const minCeiling = Math.min(...budgetCeilings)
    if (area.avg_price_krw < minCeiling * BUDGET_HEADROOM_RATIO) {
      tags.push('예산 여유')
    }
  }

  if (area.satisfied.area_size) tags.push('넓은 평수')
  if (area.satisfied.build_year) tags.push('신축')
  if (area.satisfied.infra) tags.push('인프라 편의')

  return tags.slice(0, MAX_BENEFIT_TAGS)
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 새 파일 관련 에러 없음(기존 에러가 있었다면 그대로 유지되는지만 확인)

- [ ] **Step 3: Commit**

```bash
git add src/lib/concession-benefit-tags.ts
git commit -m "추가: 서로 양보 카드 혜택 태그 계산 함수"
```

---

### Task 2: `ConcessionAreaCard` 컴포넌트

**Files:**
- Create: `src/components/concession-area-card.tsx`

**Interfaces:**
- Consumes: 없음(순수 프레젠테이션 컴포넌트)
- Produces: `interface ConcessionAreaData { code: string; name: string; sigungu: string; lat?: number; lng?: number; benefitTags: string[] }`와 `ConcessionAreaCard({ area, onSelect }: { area: ConcessionAreaData; onSelect?: () => void })` — Task 3(`result-concession-panel.tsx`)이 이 타입과 컴포넌트를 그대로 import한다.

- [ ] **Step 1: 컴포넌트 구현**

`src/components/concession-area-card.tsx`:

```tsx
export interface ConcessionAreaData {
  code: string
  name: string
  sigungu: string
  lat?: number
  lng?: number
  // computeBenefitTags 결과 — 빈 배열이면 "얻는 것" 줄을 숨긴다.
  benefitTags: string[]
}

// 서로 양보(AB) 패널 전용 후보 카드. 결과 화면 캐러셀의 ResultAreaCard(가격
// +A/B 통근시간 + 충족배지)와 달리, 이 패널은 "무엇을 얻는지"만 보여주는
// 미니멀한 구조를 쓴다 — 참고 스크린샷 기준.
export function ConcessionAreaCard({
  area,
  onSelect,
}: {
  area: ConcessionAreaData
  onSelect?: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col rounded-2xl bg-white p-4 shadow-[0_10px_20px_rgba(0,0,0,0.04)]',
        onSelect && 'cursor-pointer'
      )}
    >
      <span className="text-title-sb font-semibold text-neutral-900">{area.name}</span>
      {area.benefitTags.length > 0 && (
        <p className="mt-1 text-body-s">
          <span className="text-neutral-500">얻는 것: </span>
          <span className="font-bold text-pink-600">{area.benefitTags.join(' · ')}</span>
        </p>
      )}
    </div>
  )
}
```

이 파일 맨 위에 `import { cn } from '@/lib/utils'`를 추가한다.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 새 파일 관련 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/concession-area-card.tsx
git commit -m "추가: 서로 양보 패널 전용 ConcessionAreaCard 컴포넌트"
```

---

### Task 3: `ResultConcessionPanel`에 새 카드 연결

**Files:**
- Modify: `src/components/result-concession-panel.tsx`

**Interfaces:**
- Consumes: `ConcessionAreaData`, `ConcessionAreaCard` (Task 2 산출물)
- Produces: `ResultConcessionPanelProps.hoods: ConcessionAreaData[]`, `onSelectHood?: (hood: ConcessionAreaData) => void` — Task 4가 이 타입에 맞춰 `concessionHoods`를 만들어 넘긴다.

- [ ] **Step 1: import 교체**

`src/components/result-concession-panel.tsx` 1-3행:

```ts
import { ArrowRight, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConcessionAreaCard, type ConcessionAreaData } from '@/components/concession-area-card'
```

(기존 `import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'` 줄을 제거한다.)

- [ ] **Step 2: props 타입 교체**

9-28행의 `ResultConcessionPanelProps` 인터페이스에서 `hoods`와 `onSelectHood`를 다음으로 바꾼다:

```ts
  hoods: ConcessionAreaData[]
```

```ts
  onSelectHood?: (hood: ConcessionAreaData) => void
```

(`totalCount`, `message`, `giveDetail`, `tipTitle`, `tipBody`, `onAdjust`, `onViewMap`은 그대로 둔다.)

- [ ] **Step 3: 카드 렌더링 교체**

96-105행(`visibleHoods.map` 블록)을 다음으로 바꾼다:

```tsx
          <div className="flex flex-col gap-2.5">
            {visibleHoods.map((h) => (
              <ConcessionAreaCard
                key={h.code}
                area={h}
                onSelect={onSelectHood ? () => onSelectHood(h) : undefined}
              />
            ))}
          </div>
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `result-map-sheet.tsx`에서 아직 `ResultAreaData`를 넘기고 있어 타입 에러가 날 수 있음 — Task 4에서 해소되므로 지금은 에러 메시지가 "Task 4에서 다룰 파일(result-map-sheet.tsx)"인지만 확인하고 넘어간다.

- [ ] **Step 5: Commit**

```bash
git add src/components/result-concession-panel.tsx
git commit -m "변경: ResultConcessionPanel이 ConcessionAreaCard를 쓰도록 교체"
```

---

### Task 4: `result-map-sheet.tsx`에서 데이터 조합

**Files:**
- Modify: `src/components/result-map-sheet.tsx`

**Interfaces:**
- Consumes: `computeBenefitTags` (Task 1), `ConcessionAreaData` (Task 2), 기존 `participants: ParticipantConditionSummary[] | null` prop, 기존 `concession: ConcessionMatchResult | null` prop
- Produces: 없음(최종 연결 지점)

- [ ] **Step 1: import 추가**

`src/components/result-map-sheet.tsx` 17행(`import { ResultConcessionPanel } ...`) 바로 아래에 추가:

```ts
import type { ConcessionAreaData } from '@/components/concession-area-card'
import { computeBenefitTags } from '@/lib/concession-benefit-tags'
```

- [ ] **Step 2: `concessionHoods` 빌드 로직 교체**

343-354행을 다음으로 바꾼다:

```tsx
  // 서로 양보(AB) 단일안 후보 — get_concession_matches가 계산해둔 순위 그대로 쓴다.
  const aBudgetMaxKrw = participants?.find((p) => p.role === 'A')?.budget_max_krw ?? null
  const bBudgetMaxKrw = participants?.find((p) => p.role === 'B')?.budget_max_krw ?? null
  const concessionHoods: ConcessionAreaData[] = (concession?.areas ?? []).map((a) => ({
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

- [ ] **Step 3: `onSelectHood` 콜백 확인**

510-524행의 `<ResultConcessionPanel ... />` 호출부는 `hood.lat`/`hood.lng`만 읽으므로 코드 변경이 필요 없다(`ConcessionAreaData`에도 동일한 필드가 있음). 그대로 둔다.

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건 (Task 3에서 남아있던 에러까지 모두 해소됨)

- [ ] **Step 5: lint**

Run: `npm run lint`
Expected: 에러 0건

- [ ] **Step 6: Commit**

```bash
git add src/components/result-map-sheet.tsx
git commit -m "연결: 서로 양보 카드에 혜택 태그 데이터 흘려보내기"
```

---

### Task 5: 개발 서버에서 시각 확인

**Files:** 없음(코드 변경 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`

- [ ] **Step 2: 0곳 폴백 화면 진입**

필수 조건 교집합이 0곳이 되는 세션으로 `/s/[id]/result`에 접속한다(둘 다 조건 입력을 마친 세션이 필요 — 로컬 시드 데이터나 기존 테스트 세션 활용). `concession`이 채워지는 분기(`result.match_count === 0`)를 확인한다.

- [ ] **Step 3: 카드 스타일 확인**

브라우저에서 다음을 확인한다:
- 후보 카드가 `동네명` + `얻는 것: 태그 · 태그` 구조로 보이는지 (스크린샷과 구조 비교)
- 태그가 없는 카드는 "얻는 것" 줄이 아예 안 보이는지
- 카드 탭 시 지도 핀으로 포커스 이동하는 기존 동작이 유지되는지
- 헤더(🤝 헤드라인/서브텍스트)·"서로 양보" 요약 줄·하단 CTA는 기존 그대로인지(이번 변경 범위 아님)

- [ ] **Step 4: 0곳인데 태그도 전부 없는 케이스 확인(선택)**

가능하면 태그가 하나도 안 붙는 후보가 섞인 세션도 확인해 카드가 동네명만 깨끗하게 보이는지 점검한다. 재현 가능한 세션이 없으면 이 스텝은 생략하고 다음 스텝으로 넘어간다.

---

## Self-Review 체크리스트 (실행 전 참고용)

- **스펙 커버리지**: 컴포넌트 설계(Task 2,3) / 태그 계산 로직(Task 1) / 데이터 연결(Task 4) / 시각 확인(Task 5) — 설계 스펙의 모든 섹션에 대응하는 태스크 있음.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드/명령어 포함.
- **타입 일관성**: `ConcessionAreaData`(Task 2에서 정의) → `ResultConcessionPanelProps.hoods`(Task 3) → `concessionHoods`(Task 4) 전 구간 동일 타입 사용 확인됨. `computeBenefitTags` 시그니처는 Task 1 정의와 Task 4 호출부가 일치.
