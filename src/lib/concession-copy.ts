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

function giveText(side: ConcessionGiveSide, role: 'A' | 'B'): string | null {
  const parts: string[] = []
  if (side.relieved_condition) {
    parts.push(`${role} ${CONDITION_LABEL[side.relieved_condition] ?? side.relieved_condition} 내려놓음`)
  }
  if (side.commute_widen_min > 0) parts.push(`${role} +${side.commute_widen_min}분`)
  if (side.budget_widen_krw > 0) parts.push(`${role} +${formatEok(side.budget_widen_krw)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

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
