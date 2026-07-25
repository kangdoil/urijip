# 조율하기(/adjust) 화면 — 통근 슬라이더 추가 설계

## 배경

`/s/[id]/adjust` 화면(`src/app/s/[id]/adjust/page.tsx`)은 예산 상한만 슬라이더로 조정할 수 있고 통근 상한은 조정할 UI가 없다. Figma(node 211-5269, "조율하기" 화면)의 "예산 상한 조정" 카드와 동일한 패턴으로 "통근 상한 조정" 카드를 추가하고, 조율하기의 모든 상태 화면에서 일관되게 보이도록 한다.

## 핵심 제약 — 예산과 통근은 후보 데이터 소스가 다르다

`get_adjust_data` RPC는 `_session_candidates(sid)`를 호출해 후보 목록을 받는다. 이 함수는 SQL에서 통근시간을 **하드 필터링**한다(`ca.minutes <= a_p.commute_max_min and cb.minutes <= b_p.commute_max_min`, `supabase/migrations/20260714000000_area_coords_in_matches.sql:54-55`). 반면 예산은 이 함수에서 전혀 필터링하지 않는다 — `get_matches`가 별도로 필터링한다. 그 결과:

- 예산 슬라이더를 올리면 **이미 받아온 후보 중** 원래 상한보다 비싼 곳이 그냥 드러난다 (클라이언트 재계산만으로 충분).
- 통근 슬라이더를 그냥 추가하면, 원래 상한 밖의 후보는 애초에 서버에서 내려오지 않았으므로 슬라이더를 움직여도 후보가 하나도 늘지 않는다 — **동작하지 않는 UI**가 된다.

`_session_candidates`는 `get_matches`/`get_fallback_matches`/`get_conflict_report`도 공유해서 쓰므로(파일 주석 확인) 이 함수 자체의 필터를 풀 수 없다. 조율 화면 전용으로 통근 슬랙을 준 새 함수가 필요하다.

## 백엔드 변경

새 마이그레이션 `supabase/migrations/20260725020000_adjust_commute_slider.sql`.

### 1. `_adjust_candidates(sid uuid)`

`_session_candidates`(`20260714000000_area_coords_in_matches.sql:13-56`)와 완전히 동일한 join/컬럼 구성이되, 통근 필터에 **고정 +30분** 슬랙을 준다:

```sql
where ca.minutes <= a_p.commute_max_min + 30
  and cb.minutes <= b_p.commute_max_min + 30
```

30분은 서버가 항상 고정으로 얹어주는 값이다(예산에 서버 쪽 상한이 없는 것과 같은 패턴 — 클라이언트가 widen 값을 보내지 않는다). `get_matches` 등이 쓰는 기존 `_session_candidates`는 전혀 수정하지 않는다.

### 2. `get_adjust_data` 확장

- 후보 조회를 `_session_candidates(sid)` → `_adjust_candidates(sid)`로 교체.
- `a`/`b` 객체에 `commute_max_min`을 추가(현재는 `budget_max_krw`/`priorities`만 내려줌).

### 3. `decide_proposal` 확장

`payload`의 키 분기(`20260721020000_priority_ranking.sql:497-508`)에 `commute_max_min` 케이스를 추가:

```sql
elsif key = 'commute_max_min' then
  update public.participants set commute_max_min = (val #>> '{}')::int
  where id = prop.proposer_id;
```

`participants.commute_max_min`은 `check (commute_max_min between 10 and 120)` 제약이 있다(`schema.sql`) — 슬라이더 max를 이 상한 안으로 반드시 caps해야 저장이 실패하지 않는다(아래 프론트 섹션).

## 프론트 변경 (`src/app/s/[id]/adjust/page.tsx`)

### 상태 & 계산

- `ParticipantAdjust` 인터페이스에 `commute_max_min: number` 추가.
- `aCommuteValue`/`bCommuteValue` state 추가(budget과 동일 패턴, 초기값은 `get_adjust_data` 응답 또는 pending proposal의 오버레이 값).
- `lowCommuteOriginal`/`highCommuteOriginal`/`commuteHasConflict` — budget과 동일하게 파생.
- `commuteSliderMax = Math.min(highCommuteOriginal + 30, 120)` — DB 체크 제약 위반을 프론트에서부터 막는다.
- 슬라이더 `step`은 5분(`step={5}`) — 사다리(`get_concession_matches`)의 통근 widen 단위(5분/15분)와 온보딩 통근 슬라이더 관례를 그대로 따른다(예산 슬라이더의 `step={10_000_000}`에 대응).
- **예산과의 차이**: 예산은 매물 가격이 지역 하나에 값 하나(공유)라 `appliedBudget = min(aBudgetValue, bBudgetValue)`처럼 "더 낮은 쪽" 단일값이 전체 필터링에 쓰인다. 통근은 후보마다 `a_minutes`/`b_minutes`가 따로 있으므로 공유 `appliedCommute` 개념이 없다 — `passing`은 각자 자기 값으로 따로 비교한다: `c.a_minutes <= aCommuteValue && c.b_minutes <= bCommuteValue`. `countMatches`도 동일하게 `aCommute`/`bCommute` 두 인자를 받도록 확장.

### 화면 (1) 편집 화면 — "통근 상한 조정" 카드

"예산 상한 조정" 카드(`page.tsx:741-804`)와 완전히 같은 구조로 카드를 하나 더 추가한다 — 카드 제목, 안내 문구, A/B 역할별 라벨 + 본인만 조작 가능한 슬라이더(상대는 `opacity-50` 읽기 전용), 구분선, 하단 캡션. `Slider`(`@/components/ui/slider`) 컴포넌트를 그대로 재사용한다.

안내 문구는 예산과 달리 "둘 중 더 낮은 쪽이 기준"이라는 공유 비교 개념이 없다(통근은 인당 값) — 다음 텍스트로 대체:

```tsx
<p className="mt-1 text-caption-l text-neutral-400">
  {commuteHasConflict ? '통근 상한이 서로 달라요 · ' : '통근 상한이 같아요 · '}
  각자 상한 안에서만 후보에 반영돼요
</p>
```

하단 캡션(구분선 아래, 예산 카드의 "각자 예산 상한을 올리면 후보를 넓혀볼 수 있어요"에 대응):

```tsx
<p className="mt-3 text-center text-caption-l leading-[1.4] text-neutral-500">
  각자 통근 상한을 올리면 후보를 넓혀볼 수 있어요
</p>
```

### 화면 (3) 결정 화면 — 읽기전용 통근 블록

지금 있는 읽기전용/비활성 "예산 상한" `Slider` 블록(`page.tsx:609-626`) 바로 옆/아래에 같은 패턴으로 통근 블록을 추가한다. 값은 제안된 `appliedCommute` 조합(제안자 쪽은 제안된 값, 상대 쪽은 현재값)을 반영 — budget 블록이 이미 이렇게 하는 방식을 그대로 따른다.

### 추천 조정 배너 확장

지금 `budgetRecommendation`(`page.tsx:288-296`)은 `concession.main.give.{role}.budget_widen_krw`만 본다. 대칭적으로 `commuteRecommendation`을 추가해 `commute_widen_min`을 본다:

```ts
const commuteRecommendation = (() => {
  if (!concession || !data || !me) return null
  if (concession.main.total_count === 0) return null
  // 통근은 인당 값이라, A/B 각자 자기 쪽 병목일 때 자기 자신에게만 보여준다
  // (예산처럼 "더 낮은 쪽"이라는 단일 비교 기준이 없다).
  const side = me.role === 'A' ? concession.main.give.a : concession.main.give.b
  if (side.commute_widen_min === 0) return null
  return { kind: 'commute' as const, role: me.role, amount: side.commute_widen_min, areaCount: concession.main.total_count }
})()

const recommendation = budgetRecommendation ?? commuteRecommendation
```

`concession.main.give`는 A/B 양쪽에 각각 `commute_widen_min`을 담고 있으므로(콜드 스테이션 사다리가 이미 계산해둔 값) 추가 백엔드 변경이 필요 없다 — `get_concession_matches`는 이미 이 세션 전체에서 호출된다. `applyRecommendation()`도 `recommendation.kind`로 분기해 `setBudget`/`setCommuteValue` 중 맞는 쪽을 올리고, 하이라이트 대상 카드도 `'budget' | 'commute'`로 구분한다(`budgetCardRef`에 대응하는 `commuteCardRef` 추가).

**주의**: 예산과 통근 병목이 동시에 있는 세션은 없다는 기존 가정(주석: "한 세션엔 병목이 하나뿐이라 항상 둘 중 하나만(또는 아무것도) 뜬다")은 그대로 유지한다 — 사다리는 각 단계에서 a_target/b_target 중 하나만 'budget' 또는 'commute'로 정하므로 이 가정은 여전히 유효하다.

## 영향 범위

- `supabase/migrations/20260725020000_adjust_commute_slider.sql` (신규)
- `src/app/s/[id]/adjust/page.tsx`: 상태/파생값/화면 (1)·(3) JSX/추천 배너 로직 확장

`get_matches`, `get_fallback_matches`, `get_conflict_report`, `_session_candidates`(기존)는 변경하지 않는다. 결과 화면(`result-map-sheet.tsx` 등)도 이번 범위 밖.
