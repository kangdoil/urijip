# 완화 사다리 — 설계 (콜드 스테이션 회복 v2, 서브프로젝트 2/4)

## 배경

`docs/cold-station-recovery-spec-v2.md`의 §3(완화 사다리)·§5(정렬)·§7(정지 기준)을
구현한다. 서브프로젝트 1(`docs/superpowers/specs/2026-07-22-priority-filter-tiering-design.md`)에서
만든 `_priority_hard_ok(pid, satisfied, relieve_priority_2)`를 그대로 재사용한다.

이 문서의 범위: `get_concession_matches` RPC를 5단계 누적 완화 사다리로 재작성.
**제외**: 결과 화면 UI 문구(서브3), `recovery_ladder_step` Mixpanel 계측(서브4) — 단,
서브4가 바로 쓸 수 있도록 응답에 `ladder_step` 필드는 포함한다.

## 이번 브레인스토밍에서 확정한 결정

1. **통근·예산 완화는 기존 개인별 병목 판별 로직을 유지한다.** 즉 A/B 각자
   `a_target`/`b_target`(그 사람에게 더 많은 후보를 막는 쪽이 통근인지 예산인지)을
   판별해서, 사다리의 통근 단계(1·3단계)는 병목이 통근인 사람에게만, 예산 단계
   (4단계)는 병목이 예산인 사람에게만 실효를 갖는다. 둘 다 같은 폭을 무조건
   받는 게 아니다(순위 해제 2단계는 예외 — 항상 대칭으로 둘 다 해제).
2. **정렬 공식의 "통과 조건 수"**는 "두 사람의 통근+예산 슬롯(항상 4개) 중
   위반하지 않은 개수"로 해석한다: `(4 - (a_violations + b_violations)) * 10`.
   순위 하드필터(1·2순위) 통과 여부는 애초에 후보 풀 진입 조건이라 변별력이
   없어 이 항에서 제외한다.
3. **"조금 더 양보하면" 추가 섹션은 차집합**으로 만든다 — 다음 단계 결과에서
   메인 섹션에 이미 나온 지역(code)을 제외하고 보여준다.
4. **RPC 응답 스키마**는 아래 §스키마 그대로 확정.

## 아키텍처

### 헬퍼 함수: `_concession_ladder_step`

```sql
create or replace function public._concession_ladder_step(
  sid uuid,
  a_target text,       -- 'commute' | 'budget' | null
  b_target text,
  widen_min int,        -- 통근 완화폭(분) — a_target/b_target이 'commute'인 사람에게만 적용
  widen_budget bigint,  -- 예산 완화폭(원) — a_target/b_target이 'budget'인 사람에게만 적용
  relieve_a2 boolean,   -- A의 2순위 조건 해제 여부
  relieve_b2 boolean    -- B의 2순위 조건 해제 여부
) returns table (areas_json jsonb, total_count bigint)
```

내부 로직은 기존 `get_concession_matches`(v1, `20260721020000`)의 candidate 계산부
(`base`/`scored` CTE)를 그대로 옮기되:
- WHERE 절의 통근/예산 조건은 `widen_min`/`widen_budget` 파라미터를 그대로 씀(기존
  `case when a_target = 'commute' then ... + widen_min ...` 패턴 유지)
- 순위 하드필터를 추가: `public._priority_hard_ok(a_p.id, satisfied, relieve_a2) and public._priority_hard_ok(b_p.id, satisfied, relieve_b2)`
- 정렬은 §정렬 공식(아래) 적용

`get_concession_matches`는 이 헬퍼를 아래 표의 파라미터로 최대 6번(0~4단계 +
"한 단계 더") 순차 호출하고, `total_count >= 1`인 첫 단계에서 멈춘다. 이렇게
헬퍼로 뽑아내는 이유: 스펙 §3 "각 단계는 동일한 판정 함수를 조건 파라미터만
바꿔 재호출한다(새 엔진 불필요)" 요구사항을 그대로 만족.

### 사다리 파라미터표 (누적식 — 이전 단계 완화를 계속 유지)

| 단계 | widen_min | widen_budget | relieve_a2 | relieve_b2 |
|---|---|---|---|---|
| 0 | 0 | 0 | false | false |
| 1 | 5 | 0 | false | false |
| 2 | 5 | 0 | true | true |
| 3 | 15 | 0 | true | true |
| 4a | 15 | 80000000(0.8억) | true | true |
| 4b(4a가 0곳일 때) | 15 | 160000000(1.6억) | true | true |

`a_target`/`b_target`은 기존 로직(원래 상한 기준 `a_commute_fail`/`a_budget_fail`
비교)으로 함수 시작 시 한 번만 계산해 전 단계에서 그대로 재사용한다(사다리
진행 중 병목 대상이 바뀌지 않음).

### 정지 기준 구현

```
step ← 0
loop step 0..4a..4b in order:
  result ← _concession_ladder_step(...이 단계 파라미터...)
  if result.total_count >= 1:
    main ← result (해당 step 번호 기록)
    if result.total_count < 3 and 다음 단계가 존재:
      next_result ← _concession_ladder_step(...다음 단계 파라미터...)
      extra.areas ← next_result.areas 중 main.areas에 없는 code만
      extra.total_count ← next_result.total_count - (main.areas와 겹치는 next_result 내 개수)
      extra.ladder_step ← 다음 단계 번호
    break
  step ← 다음 단계
전부 0곳: main.ladder_step ← null, main.areas ← [], extra ← null
```

4b(예산 상한폭)가 마지막 단계라 "3곳 미만이면 다음 단계"가 적용될 다음 단계가
없다 — 이 경우 `extra`는 항상 null.

## 정렬 공식

```sql
sort_score =
  (4 - (a_violations + b_violations)) * 10
  - abs(a_violations - b_violations)
  + (public._priority_score(a_p.id, satisfied) + public._priority_score(b_p.id, satisfied))
```

`a_violations`/`b_violations`는 기존 정의 그대로: widen 여부와 무관하게 **원래**
`commute_max_min`/`budget_max_krw` 대비 초과했는지 카운트(0~2). `_priority_score`는
서브프로젝트 1 이전부터 있던 기존 헬퍼(1위=+3/2위=+2/3위=+1), 변경 없음.

## RPC 응답 스키마

```ts
interface ConcessionGiveSide {
  commute_widen_min: number         // 0이면 통근은 안 넓힘(병목 아니었음)
  budget_widen_krw: number          // 0이면 예산은 안 넓힘(병목 아니었음)
  relieved_condition: string | null // 2단계에서 내려놓은 2순위 조건 코드, 아직이면 null
}

interface ConcessionArea {
  code: string; name: string; sigungu: string
  lat: number | null; lng: number | null
  avg_price_krw: number | null
  a_minutes: number; b_minutes: number
  satisfied: Record<string, boolean>
  a_violations: number; b_violations: number
}

interface ConcessionLadderResult {
  ladder_step: 0 | 1 | 2 | 3 | 4 | null  // null = 전부 실패(0곳). 4a/4b 모두 4로 표기
  give: { a: ConcessionGiveSide; b: ConcessionGiveSide }
  areas: ConcessionArea[]  // 상위 10개
  total_count: number
}

interface ConcessionMatchResult {
  main: ConcessionLadderResult
  extra: ConcessionLadderResult | null  // 메인이 3곳 미만일 때만, 메인과 차집합
}
```

`give.a.relieved_condition`/`give.b.relieved_condition`은 각각
`select condition_code from participant_conditions where participant_id = a_p.id/b_p.id and priority = 2`로
채운다(2단계 이상 도달했을 때만 non-null — 0·1단계에서 멈추면 null).

### 기존 스키마 대비 제거된 필드

- `widen_level`('default'/'max'/'none') → `ladder_step`(0~4 또는 null)으로 대체
- `bottleneck`(role/field/fail_count) → 제거. `give.a`/`give.b`의 widen 값이
  0보다 큰지로 병목 여부가 자명하게 드러나고, 서브3의 진단 배너 문구는
  `ladder_step`별 고정 템플릿(스펙 §4 표)을 쓰므로 별도 bottleneck 객체가
  필요 없다.

## 영향받지 않는 것

- `get_matches`, `get_solo_preview`, `/adjust` 페이지(서브프로젝트 1에서 이미 완료)
- 온보딩 UI, `participant_conditions` 스키마 — 변경 없음
- `_priority_hard_ok`, `_priority_score` 자체 로직 — 재사용만, 수정 없음
- 결과 화면 UI(`ResultConcessionPanel`, `concession-copy.ts`, `result-map-sheet.tsx`)
  — 이번 서브프로젝트에서는 건드리지 않는다. 새 스키마로 바뀌면 이 파일들의
  타입이 깨지겠지만, 그 수정은 서브프로젝트 3의 스코프다(단, 컴파일이 깨진
  채로 이 브랜치를 머지하면 안 되므로 — 구현 계획 단계에서 어떻게 처리할지
  별도 결정 필요, 아래 참고).

## 알려진 후속 이슈 (구현 계획에서 다룰 것)

`ResultConcessionPanel`/`concession-copy.ts`/`result-map-sheet.tsx`는 현재
`ConcessionMatchResult`의 옛 스키마(`widen_level`/`give.a`/`give.b`/`bottleneck`/
`areas`/`total_count` 평면 구조)를 직접 참조한다. 이번 서브프로젝트가 SQL과
`src/lib/concession-copy.ts`의 타입 정의만 새 스키마로 바꾸면 그 소비자들의
TypeScript 컴파일이 깨진다. 구현 계획에서 다음 중 하나를 택해야 한다:
(a) 소비자 3개 파일도 최소한으로 함께 고쳐 컴파일은 통과시키고 UI 문구
    개선은 서브3에서 마저 하거나,
(b) 새 타입을 옛 이름과 다른 이름으로 추가하고 어댑터 함수로 옛 스키마를
    합성해 소비자를 그대로 두는 임시 다리를 놓는다.
(a)가 더 단순하고 어댑터라는 임시 코드를 안 남기므로 기본값으로 권장하되,
구현 계획 작성 시 재확인한다.
