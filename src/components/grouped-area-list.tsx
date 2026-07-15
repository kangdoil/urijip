'use client'

import { useMemo, useState } from 'react'
import { Car } from 'lucide-react'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { groupBySigungu } from '@/lib/group-by-sigungu'

export interface GroupedAreaMatch {
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

interface Props {
  areas: GroupedAreaMatch[]
  showConditionBadges?: boolean
  emptyMessage?: string
}

const MAX_PER_GROUP = 3

// 동 카드 한 장. GroupedAreaList와 ResultMapSheet(지도+바텀시트)가 같이 쓴다.
export function AreaCard({
  area,
  showConditionBadges = false,
}: {
  area: GroupedAreaMatch
  showConditionBadges?: boolean
}) {
  return (
    <div className="rounded-2xl border border-neutral-100 bg-white px-4 py-3 shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-body-sb font-bold text-neutral-900">{area.name}</span>
        <span className="whitespace-nowrap text-body-sb font-semibold text-neutral-500">
          {formatEok(area.avg_price_krw)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-caption-l font-medium">
        <span className="flex items-center gap-1 text-pink-500">
          <Car className="size-3.5" />A {area.a_minutes}분
        </span>
        <span className="flex items-center gap-1 text-accent-teal">
          <Car className="size-3.5" />B {area.b_minutes}분
        </span>
        {showConditionBadges && area.satisfied && (
          <span className="ml-auto flex gap-1">
            {Object.entries(area.satisfied)
              .filter(([, ok]) => ok)
              .map(([conditionCode]) => (
                <span
                  key={conditionCode}
                  className="rounded-full bg-neutral-500 px-2.5 py-1 text-caption-m font-medium text-neutral-0"
                >
                  {CONDITION_LABEL[conditionCode] ?? conditionCode}
                </span>
              ))}
          </span>
        )}
      </div>
    </div>
  )
}

// 시군구별로 묶어서 랭킹 1위 동만 기본 노출하고, "더보기"로 그 시군구 안
// 상위 최대 3곳까지 펼친다. areas는 이미 랭킹순(선호 충족 수 desc, 통근시간
// 합 asc)으로 정렬돼 들어오므로, Map 삽입 순서를 그대로 쓰면 그룹 자체도
// 1위 동이 속한 그룹부터, 그룹 내부도 랭킹순으로 자연히 정렬된다.
export function GroupedAreaList({
  areas,
  showConditionBadges = false,
  emptyMessage = '이 기준을 만족하는 구역이 없어요',
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => groupBySigungu(areas), [areas])

  if (groups.length === 0) {
    return <p className="py-4 text-center text-body-s text-neutral-400">{emptyMessage}</p>
  }

  function toggle(sigungu: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sigungu)) next.delete(sigungu)
      else next.add(sigungu)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ sigungu, list }) => {
        const capped = list.slice(0, MAX_PER_GROUP)
        const isOpen = expanded.has(sigungu)
        const shown = isOpen ? capped : capped.slice(0, 1)
        const moreCount = capped.length - 1

        return (
          <div key={sigungu} className="rounded-[28px] border border-neutral-100 bg-neutral-50 p-4">
            <div className="mb-2.5 px-0.5">
              <span className="text-body-sb font-bold text-neutral-900">{sigungu}</span>
            </div>

            <div className="flex flex-col gap-2">
              {shown.map((area) => (
                <AreaCard key={area.code} area={area} showConditionBadges={showConditionBadges} />
              ))}
            </div>

            {moreCount > 0 && (
              <button
                onClick={() => toggle(sigungu)}
                className="mt-2.5 w-full text-center text-caption-l font-semibold text-pink-500"
              >
                {isOpen ? '접기 ▲' : `${moreCount}곳 더보기 ▼`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
