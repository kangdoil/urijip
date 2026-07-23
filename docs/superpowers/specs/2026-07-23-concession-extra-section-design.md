# "조금 더 양보하면" 접기 섹션 — 설계 (콜드 스테이션 회복 v2, 서브프로젝트 3/4)

## 배경

`docs/cold-station-recovery-spec-v2.md` §7(사다리 정지 기준)의 opt-in 확장 섹션을
구현한다. 진단 배너·서로 양보 바(§4 표)는 이미 서브프로젝트 2에서 구현 완료
(`buildConcessionCopy`, `ResultConcessionPanel`의 `giveTag`)했으므로, 이번
서브프로젝트의 범위는 딱 하나 — `get_concession_matches`가 이미 계산해서
`extra` 필드로 내려주고 있지만 아직 아무 UI도 소비하지 않는 데이터를 화면에
붙이는 것이다.

## 이번 브레인스토밍에서 확정한 결정

1. **패턴 재사용**: `GroupedAreaList`(`src/components/grouped-area-list.tsx`)의
   `useState<Set>` 토글 + "N곳 더보기 ▼"/"접기 ▲" 버튼 패턴을 그대로 가져다
   쓴다(스펙 §7 "기존 접힌 보조 링크 패턴 재사용"이 가리키는 실제 코드).
2. **양보 표기는 차이만**: extra 섹션에는 `extra.give`(그 단계까지의 누적
   양보 전체)를 그대로 보여주지 않고, `main.give`와 비교해 **새로 추가된
   부분만** 표기한다(스펙 §7 "어떤 양보가 더해졌는지").
3. **컴포넌트 배치**: 별도 컴포넌트로 분리하지 않고 `ResultConcessionPanel`
   내부에 인라인으로 추가한다 — `GroupedAreaList`와 달리 그룹이 여러 개가
   아니라 토글 하나뿐이라 분리할 만큼 복잡하지 않다.
4. **계측 추가 안 함**: `src/lib/mixpanel.ts`의 `EventMap`은 "docs/metrics-events.md
   §2의 MVP 11개 이벤트만" 화이트리스트로 강제한다(목록 밖 이벤트명은 타입
   에러). 새 이벤트(예: extra 섹션 펼치기 클릭) 추가는 서브프로젝트 4
   (`recovery_ladder_step` 계측)의 스코프이므로 이번엔 건드리지 않는다.

## 데이터 흐름

### `concession-copy.ts`

`buildConcessionCopy(result: ConcessionMatchResult)`는 이미 `result.extra`에
접근 가능한 상태(파라미터가 `ConcessionMatchResult` 전체)이므로, 반환값에
`extraGiveDetail: string | null`을 추가한다:

```ts
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

`buildConcessionCopy`가 `result.extra`가 non-null이면 `giveDiffText(main.give.a, extra.give.a, 'A')`와
`giveDiffText(main.give.b, extra.give.b, 'B')`를 합쳐 `extraGiveDetail`을 만든다. `extra`가
null이면 `extraGiveDetail`도 null.

### `result-map-sheet.tsx`

`concessionHoods`를 만드는 것과 동일한 방식(동일한 `computeBenefitTags` 재사용)으로
`extraHoods: ConcessionAreaData[]`를 `concession?.extra?.areas ?? []`에서 만든다.

## 컴포넌트 설계

`ResultConcessionPanel`에 props 추가:

```ts
interface ResultConcessionPanelProps {
  // ...기존 그대로...
  extraHoods: ConcessionAreaData[]      // 비어있으면 섹션 자체를 렌더링 안 함
  extraCount: number                     // "+N곳" 표기용 (extra.total_count)
  extraGiveDetail: string                // "무엇이 더해졌는지" — 위 giveDiffText 결과
}
```

렌더링 위치: `visibleHoods.map(...)` 카드 리스트(96-105행) 바로 아래, CTA 버튼
(108행 이후) 위. `extraHoods.length === 0`이면 이 섹션 전체를 렌더링하지 않는다.

```tsx
{extraHoods.length > 0 && (
  <div className="mt-3">
    <button onClick={() => setExtraOpen((v) => !v)} className="w-full text-center text-caption-l font-semibold text-pink-500">
      {extraOpen ? '접기 ▲' : `조금 더 양보하면 (+${extraCount}곳) ▼`}
    </button>
    {extraOpen && (
      <div className="mt-2.5 flex flex-col gap-2.5">
        <p className="text-caption-l text-neutral-500">{extraGiveDetail}</p>
        {extraHoods.map((h) => (
          <ConcessionAreaCard key={h.code} area={h} onSelect={onSelectHood ? () => onSelectHood(h) : undefined} />
        ))}
      </div>
    )}
  </div>
)}
```

토글 상태는 `useState<boolean>`(단일 섹션이라 `GroupedAreaList`의 `Set` 대신
단순 boolean으로 충분 — 그룹이 여러 개가 아니므로).

## 영향받지 않는 것

- SQL(`get_concession_matches`, `_concession_ladder_step`) — `extra` 필드는 이미
  서브2에서 완성돼 있음, 변경 없음
- `GroupedAreaList` 자체 — 패턴만 참고, 코드 재사용(import)은 하지 않음(용도가
  다름 — 시군구 그룹핑이 아니라 단일 리스트라 그대로 쓰면 오히려 안 맞음)
- Mixpanel 이벤트 — 위 결정 4번대로 이번엔 손대지 않음
- `adjust/page.tsx`의 `budgetRecommendation` — extra와 무관, 서브2에서 이미 처리 완료
