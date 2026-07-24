import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'

export interface ConcessionGiveSide {
  commute_widen_min: number
  budget_widen_krw: number
  relieved_condition: string | null
}

export interface ConcessionArea {
  code: string
  name: string
  sigungu: string
  lat: number | null
  lng: number | null
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  satisfied: Record<string, boolean>
  a_violations: number
  b_violations: number
}

export interface ConcessionLadderResult {
  ladder_step: 0 | 1 | 2 | 3 | 4 | null
  give: { a: ConcessionGiveSide; b: ConcessionGiveSide }
  areas: ConcessionArea[]
  total_count: number
}

// get_concession_matches 응답 — main은 항상 존재(실패해도 ladder_step=null로
// areas=[]인 상태로 옴), extra는 main이 3곳 미만일 때만 채워진다.
export interface ConcessionMatchResult {
  main: ConcessionLadderResult
  extra: ConcessionLadderResult | null
}

// 참여자 한 명의 양보 내용을 칩 하나로 합친다 — "년식 양보" / "인프라 · 통근
// +15분 양보"처럼. 칩 옆에 A/B 아바타가 이미 역할을 보여주므로 role 접두사
// 없이 "조건 · 통근 · 예산" 순서로 합쳐 "양보"를 한 번만 붙인다. 양보한 게
// 하나도 없으면(=이 role은 그대로) null을 반환해 칩 자체를 숨긴다.
function giveChipText(side: ConcessionGiveSide): string | null {
  const parts: string[] = []
  if (side.relieved_condition) {
    parts.push(CONDITION_LABEL[side.relieved_condition] ?? side.relieved_condition)
  }
  if (side.commute_widen_min > 0) parts.push(`통근 +${side.commute_widen_min}분`)
  if (side.budget_widen_krw > 0) parts.push(`예산 +${formatEok(side.budget_widen_krw)}`)
  if (parts.length === 0) return null
  return `${parts.join(' · ')} 양보`
}

const STEP_MESSAGE: Record<number, string> = {
  0: '두 분 조건이 거의 맞았어요',
  1: '출퇴근 폭을 조금 넓혀 찾아봤어요',
  2: '두 분의 2순위 조건을 잠시 내려놓고 찾아봤어요',
  3: '출퇴근 조건이 가장 멀었어요. 그만큼 폭을 넓혀 찾아봤어요',
  4: '예산 범위를 조금 넓혀 찾아봤어요',
}

const STEP_TAG: Record<number, string | null> = {
  0: null,
  1: '폭 넓힘',
  2: '2순위 내려놓음',
  3: '폭 넓힘',
  4: '예산 폭 넓힘',
}

// get_concession_matches 응답을 ResultConcessionPanel이 바로 쓸 수 있는
// 카피(문구)로 변환한다. PRD §시스템 역할 경계 원칙("B가 양보하세요류의
// 처방적 메시지는 금지")에 따라 원인만 설명하고 특정 role에게 행동을
// 지시하지 않는다.
export function buildConcessionCopy(result: ConcessionMatchResult) {
  const { main } = result

  const giveChips = (
    [
      ['A', main.give.a] as const,
      ['B', main.give.b] as const,
    ] satisfies [role: 'A' | 'B', side: ConcessionGiveSide][]
  )
    .map(([role, side]) => {
      const text = giveChipText(side)
      return text ? { role, text } : null
    })
    .filter((v): v is { role: 'A' | 'B'; text: string } => v != null)

  if (main.ladder_step == null) {
    return {
      giveTag: null,
      tipTitle: '이렇게 조정해보세요',
      tipBody: '조건이나 우선순위를 조정하면 맞는 동네가 나올 수 있어요.',
      giveChips,
    }
  }

  return {
    giveTag: STEP_TAG[main.ladder_step],
    tipTitle: '이렇게 조정해보세요',
    tipBody: `조건에 맞는 동네를 찾지 못했어요\n${STEP_MESSAGE[main.ladder_step]}`,
    giveChips,
  }
}
