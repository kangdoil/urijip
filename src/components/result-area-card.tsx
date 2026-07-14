import { Car } from 'lucide-react'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'

export interface ResultAreaData {
  code: string
  name: string
  sigungu: string
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  lat?: number
  lng?: number
  satisfied?: Record<string, boolean>
}

// 결과 화면 전용 동네 카드 — 가로 스크롤 캐러셀에 쓴다. Figma는 이름·가격·충족
// 배지만 보여주지만, 통근시간(A/B)은 두 사람이 실제로 비교하는 핵심 정보라 UX
// 관점에서 추가했다 (grouped_result_screen_mockup.html에서도 같은 판단으로
// 통근시간을 카드에 넣었었다). 시군구 이름은 활성 칩에 이미 표시되므로 카드
// 안에서는 반복하지 않는다.
export function ResultAreaCard({ area }: { area: ResultAreaData }) {
  const satisfiedCodes = Object.entries(area.satisfied ?? {})
    .filter(([, ok]) => ok)
    .map(([code]) => code)

  return (
    <div className="flex h-[150px] w-[304px] shrink-0 snap-start flex-col justify-between rounded-2xl border-[0.6px] border-neutral-300 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-title-sb font-semibold text-neutral-900">{area.name}</span>
        <span className="whitespace-nowrap text-body-m font-semibold text-neutral-500">
          {formatEok(area.avg_price_krw)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs font-medium">
        <span className="flex items-center gap-1 text-pink-500">
          <Car className="size-3.5" />A {area.a_minutes}분
        </span>
        <span className="flex items-center gap-1 text-accent-teal">
          <Car className="size-3.5" />B {area.b_minutes}분
        </span>
      </div>

      {satisfiedCodes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {satisfiedCodes.map((code) => (
            <span
              key={code}
              className="rounded-full bg-neutral-500 px-3 py-1.5 text-caption-l font-medium text-neutral-0"
            >
              {CONDITION_LABEL[code] ?? code} 충족
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
