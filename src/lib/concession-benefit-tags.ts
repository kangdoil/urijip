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
