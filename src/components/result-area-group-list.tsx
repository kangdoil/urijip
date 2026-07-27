'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'

interface ResultAreaGroupListProps {
  groups: { sigungu: string; list: ResultAreaData[] }[]
  excludedCodes: Set<string>
  onExclude: (code: string) => void
  onRestore: (code: string) => void
  selectedAreaCode: string | null
  focusedSigungu: string | null
  onCardSelect: (area: ResultAreaData) => void
  onGroupFocusChange: (sigungu: string | null) => void
  registerCardRef: (code: string, el: HTMLDivElement | null) => void
  emptyLabel: string
  // 조율 직후 새로 추가된 동네 코드 — 해당 카드에만 New 뱃지를 표시한다.
  newAreaCodes?: Set<string>
  // 리스트가 맨 위에 있는지 알려준다 — 부모(ResultMapSheet)가 필터 영역을
  // 스크롤 중엔 숨기고 맨 위로 돌아왔을 때만 다시 보여주는 데 쓴다.
  onAtTopChange?: (atTop: boolean) => void
  // 네이버부동산 "매물 보기" 클릭 — 넘겨주지 않으면 카드에 버튼이 안 뜬다.
  onListingClick?: (area: ResultAreaData) => void
}

// 결과 화면 바텀시트의 시군구별 세로 리스트. 리스트 자체를 스크롤 컨테이너로
// 두고(data-vaul-no-drag — vaul이 이 영역의 포인터는 시트 드래그로 가로채지
// 않도록), IntersectionObserver로 화면 중간쯤(rootMargin 상하 비대칭)에 걸린
// 시군구 그룹을 "포커스"로 판단해 부모(ResultMapSheet)에 알린다. 부모는 그
// 시군구 대표 좌표로 지도를 pan(줌 변경 없음)한다 — 카드 클릭 시의 focusPin
// (줌인)과는 다른, 스크롤 추적 전용 약한 포커스다.
export function ResultAreaGroupList({
  groups,
  excludedCodes,
  onExclude,
  onRestore,
  selectedAreaCode,
  focusedSigungu,
  onCardSelect,
  onGroupFocusChange,
  registerCardRef,
  emptyLabel,
  onAtTopChange,
  newAreaCodes,
  onListingClick,
}: ResultAreaGroupListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const lastFocusedRef = useRef<string | null>(null)
  // IntersectionObserver는 observe() 호출 직후에도(실제 스크롤 없이) 콜백을 한 번
  // 쏴준다 — 마운트 직후처럼 레이아웃이 아직 최종 크기로 자리잡기 전에 이 초기
  // 콜백이 오면 엉뚱한 그룹을 "포커스"로 잘못 판단해 지도를 튈 수 있다(실측:
  // 카드를 클릭해 focusPin으로 줌인한 직후, 뒤늦게 도착한 초기 콜백이 지도를
  // 다른 그룹으로 되돌려버림). 실제로 리스트를 스크롤하기 전까지는 스크롤스파이
  // 통지를 보류한다 — 스크롤 전 상태는 기본 포커스(첫 그룹)로 이미 충분하다.
  const hasScrolledRef = useRef(false)

  useEffect(() => {
    lastFocusedRef.current = focusedSigungu
  }, [focusedSigungu])

  // atTop 판정은 그룹 개수와 무관하게(단일 그룹이라도 카드가 많으면 스크롤됨)
  // 항상 감시한다 — 위 스크롤스파이 이펙트와는 별개 관심사라 분리했다.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !onAtTopChange) return

    onAtTopChange(root.scrollTop <= 0)
    const handleScroll = () => onAtTopChange(root.scrollTop <= 0)
    root.addEventListener('scroll', handleScroll, { passive: true })
    return () => root.removeEventListener('scroll', handleScroll)
  }, [onAtTopChange])

  useEffect(() => {
    // 그룹이 하나뿐이면 비교 대상이 없다 — 옵저버 없이 그 그룹을 바로 포커스한다.
    if (groups.length <= 1) {
      const only = groups[0]?.sigungu ?? null
      if (only !== lastFocusedRef.current) {
        lastFocusedRef.current = only
        onGroupFocusChange(only)
      }
      return
    }

    const root = scrollRef.current
    if (!root) return

    const handleScroll = () => {
      hasScrolledRef.current = true
    }
    root.addEventListener('scroll', handleScroll, { passive: true })

    const ratios = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        if (!hasScrolledRef.current) return
        for (const entry of entries) {
          const sigungu = (entry.target as HTMLElement).dataset.sigungu
          if (!sigungu) continue
          ratios.set(sigungu, entry.intersectionRatio)
        }
        let best: string | null = null
        let bestRatio = 0
        for (const [sigungu, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            best = sigungu
          }
        }
        if (best && best !== lastFocusedRef.current) {
          lastFocusedRef.current = best
          onGroupFocusChange(best)
        }
      },
      { root, rootMargin: '-35% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )

    for (const { sigungu } of groups) {
      const el = groupRefs.current[sigungu]
      if (el) observer.observe(el)
    }

    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', handleScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  if (groups.length === 0) {
    return <p className="py-4 text-center text-body-s text-neutral-400">{emptyLabel}</p>
  }

  return (
    <div ref={scrollRef} data-vaul-no-drag className="h-full overflow-y-auto pb-[160px]">
      {groups.map(({ sigungu, list }) => (
        <div
          key={sigungu}
          data-sigungu={sigungu}
          ref={(el) => {
            groupRefs.current[sigungu] = el
          }}
          className={cn(
            'flex flex-col gap-3 px-[16px] py-[20px]',
            sigungu === focusedSigungu && 'bg-pink-50/60'
          )}
        >
          <p className="text-body-sb font-medium text-neutral-900">{sigungu}</p>
          <div className="flex flex-col gap-2">
            {list.map((area) => (
              <div
                key={area.code}
                ref={(el) => registerCardRef(area.code, el)}
              >
                <ResultAreaCard
                  area={area}
                  excluded={excludedCodes.has(area.code)}
                  onExclude={onExclude}
                  onRestore={onRestore}
                  selected={area.code === selectedAreaCode}
                  showSigungu={false}
                  fullWidth
                  isNew={newAreaCodes?.has(area.code) ?? false}
                  onSelect={
                    area.lat != null && area.lng != null ? () => onCardSelect(area) : undefined
                  }
                  onListingClick={onListingClick}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
