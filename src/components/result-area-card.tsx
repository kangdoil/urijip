import { CarIcon } from '@/components/icons/car-icon'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { cn } from '@/lib/utils'

export interface ResultAreaData {
  code: string
  name: string
  sigungu: string
  avg_price_krw: number | null
  a_minutes: number
  // 먼저 둘러보기(solo 미리보기)는 B 데이터가 없어 null — 이땐 B 통근시간을 숨긴다.
  b_minutes: number | null
  lat?: number
  lng?: number
  satisfied?: Record<string, boolean>
}

// 결과 화면 전용 동네 카드. 세로 그룹 리스트(ResultAreaGroupList)와 결과 0곳
// 화면의 서로 양보(AB) 후보 리스트가 같이 쓴다. AB 통근시간과 조건 충족
// 여부는 두 사람이 실제로 비교하는 핵심 정보라 유지한다.
export function ResultAreaCard({
  area,
  excluded = false,
  onExclude,
  onRestore,
  onSelect,
  fullWidth = false,
  selected = false,
  showSigungu = true,
}: {
  area: ResultAreaData
  excluded?: boolean
  onExclude?: (code: string) => void
  onRestore?: (code: string) => void
  // 카드를 탭하면(제외/복구 버튼 제외) 지도 핀으로 줌인 — 좌표가 없으면 안 넘어온다.
  onSelect?: () => void
  // 세로 리스트에서 컨테이너 폭을 그대로 채운다.
  fullWidth?: boolean
  // 클릭으로 선택된 카드 강조(핑크 테두리) — 그룹 리스트의 스크롤 포커스와는
  // 독립적인 상태다.
  selected?: boolean
  // 그룹 헤더가 이미 시군구명을 보여주는 목록(ResultAreaGroupList)에서는
  // 카드 안 시군구 표기가 중복이라 꺼둔다.
  showSigungu?: boolean
}) {
  const satisfiedCodes = Object.entries(area.satisfied ?? {})
    .filter(([, ok]) => ok)
    .map(([code]) => code)

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex h-auto flex-col gap-1.5 rounded-lg border px-[17px] py-[13px]',
        fullWidth ? 'w-full' : 'w-[304px] shrink-0 snap-start',
        excluded
          ? 'border-pink-100 bg-pink-50'
          : selected
            ? 'border-pink-300 bg-white shadow-[0_0_4px_rgba(255,112,150,0.15)]'
            : 'border-neutral-100 bg-white',
        onSelect && 'cursor-pointer'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="text-body-sb font-medium text-neutral-900">{area.name}</span>
          <span className="whitespace-nowrap text-[12px] font-medium text-neutral-900">
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
                className="shrink-0 text-[12px] font-medium tracking-[-0.42px] text-neutral-500 underline decoration-1 underline-offset-4"
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
                className="shrink-0 text-[12px] font-medium tracking-[-0.42px] text-neutral-500 underline decoration-1 underline-offset-4"
              >
                제외하기
              </button>
            )}
      </div>

      <div className="flex items-center gap-2">
        {satisfiedCodes.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            {satisfiedCodes.map((code) => (
              <span
                key={code}
                className="whitespace-nowrap rounded-full bg-neutral-100 px-[5px] py-[2px] text-caption-m font-semibold text-neutral-500"
              >
                {CONDITION_LABEL[code] ?? code} 충족
              </span>
            ))}
          </div>
        )}
        {showSigungu && (
          <span className="min-w-0 shrink truncate text-caption-l font-medium text-neutral-500">
            {area.sigungu}
          </span>
        )}
        {(satisfiedCodes.length > 0 || showSigungu) && (
          <span className="h-3 w-px shrink-0 bg-neutral-300" />
        )}
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-pink-500">
          <CarIcon className="size-3.5" />
          {area.a_minutes}분
        </span>
        {area.b_minutes != null && (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-accent-teal">
            <CarIcon className="size-3.5" />
            {area.b_minutes}분
          </span>
        )}
      </div>
    </div>
  )
}
