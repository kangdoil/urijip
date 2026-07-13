'use client'

import { useMemo, useState } from 'react'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'

export interface GroupedAreaMatch {
  code: string
  name: string
  sigungu: string
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  satisfied?: Record<string, boolean>
}

interface Props {
  areas: GroupedAreaMatch[]
  showConditionBadges?: boolean
  emptyMessage?: string
}

const MAX_PER_GROUP = 3

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

  const groups = useMemo(() => {
    const map = new Map<string, GroupedAreaMatch[]>()
    for (const area of areas) {
      const list = map.get(area.sigungu) ?? []
      list.push(area)
      map.set(area.sigungu, list)
    }
    return Array.from(map.entries()).map(([sigungu, list]) => ({ sigungu, list }))
  }, [areas])

  if (groups.length === 0) {
    return <p className="py-4 text-center text-sm text-neutral-400">{emptyMessage}</p>
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
    <div className="flex flex-col gap-2.5">
      {groups.map(({ sigungu, list }) => {
        const capped = list.slice(0, MAX_PER_GROUP)
        const isOpen = expanded.has(sigungu)
        const shown = isOpen ? capped : capped.slice(0, 1)
        const moreCount = capped.length - 1

        return (
          <div key={sigungu} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-900">{sigungu}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-neutral-500">
                {list.length}곳
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {shown.map((area) => (
                <div
                  key={area.code}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-neutral-900">{area.name}</span>
                    <span className="whitespace-nowrap text-sm font-medium text-neutral-700">
                      {formatEok(area.avg_price_krw)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-primary-600">A {area.a_minutes}분</span>
                    <span className="text-blue-600">B {area.b_minutes}분</span>
                    {showConditionBadges && area.satisfied && (
                      <span className="ml-auto flex gap-1">
                        {Object.entries(area.satisfied)
                          .filter(([, ok]) => ok)
                          .map(([conditionCode]) => (
                            <span
                              key={conditionCode}
                              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600"
                            >
                              {CONDITION_LABEL[conditionCode] ?? conditionCode}
                            </span>
                          ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {moreCount > 0 && (
              <button
                onClick={() => toggle(sigungu)}
                className="mt-2 w-full text-center text-xs font-medium text-primary-600"
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
