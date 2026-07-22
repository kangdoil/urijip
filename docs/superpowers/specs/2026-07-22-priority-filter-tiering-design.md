# 매칭 필터 강도 차등화 — 설계 (콜드 스테이션 회복 v2, 서브프로젝트 1/4)

## 배경

`docs/cold-station-recovery-spec-v2.md`는 콜드 스테이션(0곳 매칭) 회복을 순위 기반
완화 사다리로 재설계하는 스펙이다. 스코프가 커서 4개 서브프로젝트로 나눠 순서대로
브레인스토밍 → 계획 → 구현한다:

1. **매칭 엔진: 필터 강도 차등화** ← 이 문서
2. 매칭 엔진: 완화 사다리 (`get_concession_matches` 재작성)
3. 결과 화면 UI (진단 배너/서로 양보 바/접기 섹션)
4. 계측 (`recovery_ladder_step`)

### 이번 브레인스토밍에서 확정한 크로스커팅 결정

- **온보딩 UI는 변경하지 않는다.** v2 스펙은 "예산에도 1~3순위를 매겨 순위별로
  완화폭을 다르게 준다"고 하지만, 새 질문 화면을 추가하지 않기로 했다. 대신
  서브프로젝트 2(완화 사다리)의 예산 완화 단계는 순위 무관하게 기존
  `get_concession_matches`의 2단계 폭(기본 +0.8억 → 상한 +1.6억)을 그대로
  재사용한다. 순위 매기기는 기존처럼 평수/신축/인프라 3개에만 적용된다.
- 위 결정에 따라 `participant_conditions`의 조건 종류(area_size/build_year/infra
  3개, `priority` 1~3)와 스키마는 **변경 없음**.

## 이 문서의 범위

**포함**: 서브프로젝트 1 — 평수/신축/인프라 3개 조건의 순위별 필터 강도 차등화
(1순위=하드필터, 2순위=소프트필터, 3순위=가중치만)를 `get_matches`,
`get_solo_preview`, `/adjust` 페이지 라이브 프리뷰 3곳에 반영한다.

**제외**: `get_concession_matches`(서브2에서 통째로 재작성), 결과 화면 문구(서브3),
`recovery_ladder_step` 계측(서브4). 온보딩 conditions 페이지 UI는 변경 없음
(이미 순위 매기기 UI가 있고 그대로 재사용).

## 아키텍처

### SQL 공유 헬퍼: `_priority_hard_ok`

```sql
create or replace function public._priority_hard_ok(
  pid uuid, satisfied jsonb, relieve_priority_2 boolean default false
) returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority <= (case when relieve_priority_2 then 1 else 2 end)
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;
```

`relieve_priority_2 = false`(기본값)이면 1·2순위 조건이 모두 충족돼야 true —
이게 "기본 필터"(스펙 §2의 0단계)다. `relieve_priority_2 = true`면 1순위만 본다
— 서브프로젝트 2의 완화 사다리 2단계("2순위 해제")가 이 함수를 그대로
재호출해서 쓴다(로직 중복 없음, 이 서브프로젝트에서는 `true` 호출부 없음 —
그건 서브2 스코프).

기존 정렬 가중치 헬퍼 `_priority_score`(1위=+3, 2위=+2, 3위=+1)는 그대로 둔다
— 이번 변경은 필터링에만 영향, 정렬 로직은 손대지 않는다.

### TS 동등 헬퍼 (`/adjust` 페이지)

```ts
function priorityHardOk(
  order: string[], // aOrder/bOrder — 이미 드래그 순위 배열로 존재
  satisfied: Record<string, boolean>,
  relievePriority2 = false
): boolean {
  const threshold = relievePriority2 ? 1 : 2
  return order.slice(0, threshold).every((code) => satisfied[code])
}
```

## 변경 대상 3곳

### 1. `get_matches` (SQL)

`cand`(예산+통근 하드필터 통과, 기존 그대로) 뒤에 `passed` CTE를 다시 도입한다
(v1 마이그레이션에서 제거됐던 것을 순위 버전으로 부활):

```sql
with cand as (
  select * from public._session_candidates(sid) c
  where a_p.budget_max_krw is null or c.avg_price_krw <= low_budget
),
passed as (
  select c.* from cand c
  where public._priority_hard_ok(a_p.id, c.satisfied)
    and public._priority_hard_ok(b_p.id, c.satisfied)
)
```

`candidate_count`는 `cand` 기준(기존과 동일한 정의 유지), `match_count`와
`matches`는 `passed` 기준으로 바뀐다. 두 값이 프론트에서 이미 별도 필드로
존재하고(`MatchResult.candidate_count`/`match_count`), `candidate_count`는
Mixpanel 계측에만 쓰여 화면 분기 로직에 영향 없음을 확인했다 — 두 값이
달라져도(이제 `candidate_count >= match_count`) 안전하다.

정렬(`ORDER BY`)은 기존 `_priority_score` 합산 그대로 유지.

### 2. `get_solo_preview` (SQL)

동일한 `passed` 필터를 A 혼자 기준으로 추가한다: `_priority_hard_ok(a_p.id, satisfied)`.
"먼저 둘러보기"도 본 매칭과 동일한 필터 규칙으로 일관성을 준다(브레인스토밍에서
확정).

### 3. `/adjust` 페이지 (`src/app/s/[id]/adjust/page.tsx:308-320`)

`passing` useMemo의 필터 체인에 `priorityHardOk` 호출을 추가한다:

```ts
const passing = useMemo(() => {
  if (!data) return []
  return data.candidates
    .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budgetValue)
    .filter((c) => priorityHardOk(aOrder, c.satisfied) && priorityHardOk(bOrder, c.satisfied))
    .map((c) => {
      const score = CODES.reduce((sum, code) => {
        if (!c.satisfied[code]) return sum
        return sum + priorityWeight(aOrder, code) + priorityWeight(bOrder, code)
      }, 0)
      return { ...c, score }
    })
    .sort((x, y) => y.score - x.score || x.a_minutes + x.b_minutes - (y.a_minutes + y.b_minutes))
}, [data, aOrder, bOrder, budgetValue])
```

라이브 프리뷰는 완화 사다리를 반영하지 않으므로 `priorityHardOk`는 항상 기본값
(`relievePriority2` 미지정 = false)으로만 호출한다. 이유: 이 페이지는 사용자가
직접 순위/예산을 조정하며 "지금 이대로 저장하면 몇 곳 나오는지"를 보여주는
화면이라, 자동 완화가 섞이면 오히려 오해를 준다.

## 영향받지 않는 것

- `_session_candidates`(통근시간 하드필터만, satisfied 계산) — 변경 없음
- `get_concession_matches`, `get_adjust_data` 자체 — 이번 서브프로젝트에서 호출부만
  늘어나는 게 아니라 아예 손대지 않음(서브2에서 재작성)
- 온보딩 conditions/budget 페이지 UI — 변경 없음
- Mixpanel 이벤트 스키마 — 변경 없음(서브4 스코프)

## 알려진 트레이드오프 (스펙 문서에 이미 기록됨, 참고용)

1순위+2순위가 사람당 최대 2개씩, 두 사람 합쳐 최대 4개 슬롯인데 조건 종류는
3개뿐이라, 두 사람의 1·2순위가 서로 다른 조건을 가리키면 사실상 3개 조건 전부가
하드 필터가 되는 경우가 생길 수 있다(v1이 없애려던 콜드 스테이션 원인이 부분적으로
재도입됨). 이는 스펙이 이미 인지하고 감수한 트레이드오프이며, 서브프로젝트 2의
완화 사다리 2단계("2순위 해제")가 이 경우를 구조적으로 완화하도록 설계돼 있다.
