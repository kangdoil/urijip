import { cn } from '@/lib/utils'

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
