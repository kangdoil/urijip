import { Car, CircleX } from 'lucide-react'
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
// 배지·제외(X) 버튼만 보여주지만, 통근시간(A/B)은 두 사람이 실제로 비교하는
// 핵심 정보라 UX 관점에서 유지한다 (요청: "AB 통근시간과 조건 충족 여부는
// 그대로 유지, 피그마는 그냥 목업").
export function ResultAreaCard({
  area,
  onExclude,
}: {
  area: ResultAreaData
  onExclude?: (code: string) => void
}) {
  const satisfiedCodes = Object.entries(area.satisfied ?? {})
    .filter(([, ok]) => ok)
    .map(([code]) => code)

  return (
    <div className="relative flex h-auto w-[304px] shrink-0 snap-start flex-col rounded-xl bg-neutral-50 px-5 py-4">
      {onExclude && (
        <button
          onClick={() => onExclude(area.code)}
          aria-label={`${area.name} 제외하기`}
          className="absolute top-3 right-3 text-neutral-400 transition-colors hover:text-neutral-600"
        >
          <CircleX className="size-6" />
        </button>
      )}

      <div className="flex items-baseline gap-2 pr-8">
        <span className="text-title-sb font-semibold text-neutral-900">{area.name}</span>
        <span className="whitespace-nowrap text-body-m font-semibold text-neutral-500">
          {formatEok(area.avg_price_krw)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-medium">
        {/* 카드 높이는 그대로 유지해야 해서 새 줄을 추가하지 않고, 텍스트 크기가
            같은 이 통근시간 줄 맨 앞에 시군구 + 구분선을 끼워 넣는다. */}
        <span className="min-w-0 shrink truncate text-neutral-500">{area.sigungu}</span>
        <span className="h-3 w-px shrink-0 bg-neutral-300" />
        <span className="flex shrink-0 items-center gap-1 text-pink-500">
          <Car className="size-3.5" />A {area.a_minutes}분
        </span>
        <span className="flex shrink-0 items-center gap-1 text-accent-teal">
          <Car className="size-3.5" />B {area.b_minutes}분
        </span>
      </div>

      {satisfiedCodes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
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
