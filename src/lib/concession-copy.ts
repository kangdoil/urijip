import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'

export interface ConcessionGiveSide {
  field: 'commute' | 'budget'
  amount: number
}

export interface ConcessionBottleneck {
  role: 'A' | 'B'
  field: string
  fail_count: number
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

export interface ConcessionMatchResult {
  widen_level: 'default' | 'max' | 'none'
  give: { widen_level: string; a: ConcessionGiveSide | null; b: ConcessionGiveSide | null }
  bottleneck: ConcessionBottleneck
  // 카드/지도용 상위 10개만 담는다 — 실제 "N곳" 문구는 반드시 total_count를 쓴다.
  areas: ConcessionArea[]
  total_count: number
}

function fieldLabel(field: string) {
  if (field === 'commute') return '출퇴근 조건'
  if (field === 'budget') return '예산'
  return CONDITION_LABEL[field] ?? field
}

function giveText(side: ConcessionGiveSide | null, role: 'A' | 'B') {
  if (!side) return null
  const amount = side.field === 'commute' ? `+${side.amount}분` : `+${formatEok(side.amount)}`
  return `${role} ${amount}`
}

// get_concession_matches RPC 결과를 ResultConcessionPanel이 바로 쓸 수 있는
// 카피(문구)로 변환한다. PRD §시스템 역할 경계 원칙("B가 양보하세요류의
// 처방적 메시지는 금지")에 따라 원인만 설명하고 특정 role에게 행동을
// 지시하지 않는다 — "B 예산이 낮았어요"는 원인 설명이라 허용, "B가
// 예산을 올리세요"는 금지 대상이라 쓰지 않는다.
export function buildConcessionCopy(result: ConcessionMatchResult) {
  const { bottleneck, give, widen_level } = result
  const bLabel = fieldLabel(bottleneck.field)

  const message =
    widen_level === 'none'
      ? '폭을 많이 넓혀도 맞는 동네를 찾기 어려웠어요.'
      : `${bottleneck.role} ${bLabel}에서 두 분 차이가 가장 컸어요. 그만큼 폭을 넓혀 찾아봤어요.`

  const giveParts = [giveText(give.b, 'B'), giveText(give.a, 'A')].filter(
    (v): v is string => v != null
  )
  const giveDetail =
    giveParts.length > 0
      ? giveParts.join(' · ')
      : '조건을 조율하면 새로 열리는 동네를 여기서 보여드려요'

  const tipTitle = '이렇게 조정해보세요'
  const tipBody =
    widen_level === 'none'
      ? `${bottleneck.role} ${bLabel}이 두 분 조건 중 가장 크게 어긋나 후보를 찾기 어려웠어요. ${bLabel}이나 우선순위를 조정하면 맞는 동네가 나올 수 있어요.`
      : ''

  return { message, giveDetail, tipTitle, tipBody }
}
