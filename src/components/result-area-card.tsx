import { Car } from 'lucide-react'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { cn } from '@/lib/utils'

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
  excluded = false,
  onExclude,
  onRestore,
  onSelect,
}: {
  area: ResultAreaData
  excluded?: boolean
  onExclude?: (code: string) => void
  onRestore?: (code: string) => void
  // 카드를 탭하면(제외/복구 버튼 제외) 지도 핀으로 줌인 — 좌표가 없으면 안 넘어온다.
  onSelect?: () => void
}) {
  const satisfiedCodes = Object.entries(area.satisfied ?? {})
    .filter(([, ok]) => ok)
    .map(([code]) => code)

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex h-auto w-[304px] shrink-0 snap-start flex-col rounded-xl px-5 py-3',
        excluded ? 'bg-pink-50' : 'bg-neutral-50',
        onSelect && 'cursor-pointer'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-title-sb font-semibold text-neutral-900">{area.name}</span>
          <span className="whitespace-nowrap text-body-m font-semibold text-neutral-900">
            {formatEok(area.avg_price_krw)}
          </span>
        </div>
        {excluded
          ? onRestore && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRestore(area.code)
                }}
                className="shrink-0 text-body-sb font-medium text-neutral-500 underline decoration-1 underline-offset-4"
              >
                복구하기
              </button>
            )
          : onExclude && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onExclude(area.code)
                }}
                className="shrink-0 text-body-sb font-medium text-neutral-500 underline decoration-1 underline-offset-4"
              >
                제외하기
              </button>
            )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-medium">
        {/* 카드 높이는 그대로 유지해야 해서 새 줄을 추가하지 않고, 텍스트 크기가
            같은 이 통근시간 줄 맨 앞에 시군구 + 구분선을 끼워 넣는다. */}
        <span className="min-w-0 shrink truncate text-neutral-500">{area.sigungu}</span>
        <span className="h-3 w-px shrink-0 bg-neutral-300" />
        <span className="flex shrink-0 items-center gap-1 text-pink-500">
          <Car className="size-3.5" fill="currentColor" />A {area.a_minutes}분
        </span>
        <span className="flex shrink-0 items-center gap-1 text-accent-teal">
          <Car className="size-3.5" fill="currentColor" />B {area.b_minutes}분
        </span>
      </div>

      {satisfiedCodes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {satisfiedCodes.map((code) => (
            <span
              key={code}
              className="rounded-full bg-neutral-100 px-2 py-1.5 text-caption-l font-medium text-neutral-500"
            >
              {CONDITION_LABEL[code] ?? code} 충족
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
