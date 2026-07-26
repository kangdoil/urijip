'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { CarIcon } from '@/components/icons/car-icon'
import { formatEok } from '@/lib/condition-labels'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { MAX_PER_GROUP, type GroupedAreaMatch } from '@/components/grouped-area-list'

interface AdjustAreaPreviewListProps {
  areas: GroupedAreaMatch[]
  emptyMessage: string
  // 조율 전(원래 조건) 기준엔 없던 동네 코드 — 시군구 그룹 전체(안의 동
  // 전부)가 새로 생긴 경우에만 그룹 헤더에 New 뱃지를 달고 최상단으로 올린다.
  newAreaCodes?: Set<string>
}

// "우리가 함께 할 수 있는 동네 미리보기" 카드 목록. GroupedAreaList(구역마다
// 개별 흰 카드)와 달리 이 화면의 Figma는 시군구당 카드 한 장 안에 동을 행으로
// 쌓는다 — 전용 스타일이라 재사용 대신 이 화면만을 위한 컴포넌트로 둔다.
// 접힌 상태(대표 동 1곳)에서는 16px로 강조하고, 펼치면 전부 14px 목록으로
// 바뀐다(Figma 스펙 그대로).
export function AdjustAreaPreviewList({ areas, emptyMessage, newAreaCodes }: AdjustAreaPreviewListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const groups = useMemo(() => {
    const grouped = groupBySigungu(areas).map((g) => ({
      ...g,
      isNew: newAreaCodes != null && newAreaCodes.size > 0 && g.list.every((a) => newAreaCodes.has(a.code)),
    }))
    // 새로 생긴 시군구 그룹을 랭킹 순서는 유지한 채 맨 앞으로 옮긴다
    // (요구사항: 새 동네가 미리보기 최상단에).
    return [...grouped.filter((g) => g.isNew), ...grouped.filter((g) => !g.isNew)]
  }, [areas, newAreaCodes])

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
    <div className="flex flex-col gap-4">
      {groups.map(({ sigungu, list, isNew }) => {
        const capped = list.slice(0, MAX_PER_GROUP)
        const isOpen = expanded.has(sigungu)
        const shown = isOpen ? capped : capped.slice(0, 1)
        const moreCount = capped.length - 1
        const nameSize = shown.length === 1 ? 'text-[16px]' : 'text-[14px]'

        return (
          <div key={sigungu} className="flex flex-col gap-5 rounded-[32px] bg-white p-5">
            <div className="flex flex-col gap-3">
              <p className="flex items-start gap-1">
                {isNew && (
                  <span className="shrink-0 text-[16px] leading-[22.4px] font-bold tracking-[-0.48px] text-pink-500">
                    New
                  </span>
                )}
                <span className="text-[16px] font-bold tracking-[-0.42px] text-neutral-900">{sigungu}</span>
              </p>
              <div className="flex flex-col gap-2">
                {shown.map((area) => (
                  <div key={area.code} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 tracking-[-0.42px]">
                      <span className={cn('truncate font-semibold text-neutral-900', nameSize)}>
                        {area.name}
                      </span>
                      <span className="shrink-0 text-[12px] font-medium text-neutral-500">
                        {formatEok(area.avg_price_krw)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="flex items-center gap-1 text-[12px] font-semibold tracking-[-0.36px] text-pink-500">
                        <CarIcon className="size-3.5" />
                        {area.a_minutes}분
                      </span>
                      <span className="flex items-center gap-1 text-[12px] font-semibold tracking-[-0.36px] text-accent-teal">
                        <CarIcon className="size-3.5" />
                        {area.b_minutes}분
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {moreCount > 0 && (
              <>
                <div className="h-px w-full bg-neutral-100" />
                <button
                  type="button"
                  onClick={() => toggle(sigungu)}
                  className="text-center text-[12px] font-semibold tracking-[-0.36px] text-pink-500"
                >
                  {isOpen ? '접기 ▲' : `${moreCount}곳 더보기 ▼`}
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
