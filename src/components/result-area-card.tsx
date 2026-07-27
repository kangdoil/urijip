import { useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { CarIcon } from '@/components/icons/car-icon'
import { formatEok } from '@/lib/condition-labels'
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

// 왼쪽 스와이프로 드러나는 "제외" 액션의 폭(px) — 스와이프 드래그 clamp와
// 스냅 판정(REVEAL_WIDTH의 40% 이상 밀면 열림 유지)에 함께 쓰인다.
const REVEAL_WIDTH = 76

// 결과 화면 전용 동네 카드. 세로 그룹 리스트(ResultAreaGroupList)와 결과 0곳
// 화면의 서로 양보(AB) 후보 리스트가 같이 쓴다. AB 통근시간과 조건 충족
// 여부는 두 사람이 실제로 비교하는 핵심 정보라 유지한다.
//
// 제외는 자주 쓰는 행동이 아니라 iOS 리스트 패턴처럼 왼쪽 스와이프로 숨겨둔다
// (onExclude가 있고 아직 제외되지 않은 카드에서만 동작). 터치가 없는
// 데스크톱/마우스 환경에선 스와이프를 대신할 수단이 없어, 카드 호버 시
// 우상단에 "제외" 텍스트 버튼을 노출하는 폴백을 함께 둔다.
export function ResultAreaCard({
  area,
  excluded = false,
  onExclude,
  onRestore,
  onSelect,
  fullWidth = false,
  selected = false,
  showSigungu = true,
  isNew = false,
  onListingClick,
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
  // 조율 직후 새로 추가된 동네에만 표시(Figma node 310:1715 — badge + 타이틀).
  isNew?: boolean
  // 네이버부동산 "매물 보기" — 넘겨주지 않으면 버튼 자체를 렌더링하지 않는다
  // (내보내기용 카드 스냅샷 등 클릭이 의미 없는 곳). 좌표 없는 동네는 이 prop이
  // 있어도 버튼을 숨긴다.
  onListingClick?: (area: ResultAreaData) => void
}) {
  const swipeable = !excluded && !!onExclude

  const [dragX, setDragX] = useState(0)
  const [open, setOpen] = useState(false)
  // 드래그 중엔 transform이 손가락을 1:1로 따라가야 해서 transition을 끈다 —
  // dragRef(값 읽기 전용 ref)로는 렌더링 중 참조가 안 되므로 별도 상태로 둔다.
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    axis: 'x' | 'y' | null
    dragged: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)

  function closeSwipe() {
    setOpen(false)
    setDragX(0)
  }

  function commitExclude() {
    closeSwipe()
    onExclude?.(area.code)
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!swipeable) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: open ? -REVEAL_WIDTH : 0,
      axis: null,
      dragged: false,
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const state = dragRef.current
    if (!state) return
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    // 첫 이동에서 가로/세로 중 더 크게 움직인 쪽을 축으로 확정한다 — 세로
    // 스크롤과 가로 스와이프가 서로 방해하지 않도록.
    if (state.axis === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (state.axis === 'x') setDragging(true)
    }
    if (state.axis !== 'x') return
    state.dragged = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragX(Math.min(0, Math.max(-REVEAL_WIDTH, state.originX + dx)))
  }

  function handlePointerUp() {
    const state = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!state || state.axis !== 'x') return
    suppressClickRef.current = state.dragged
    const shouldOpen = dragX < -REVEAL_WIDTH * 0.4
    setOpen(shouldOpen)
    setDragX(shouldOpen ? -REVEAL_WIDTH : 0)
  }

  function handleCardClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (open) {
      closeSwipe()
      return
    }
    onSelect?.()
  }

  const widthClass = fullWidth ? 'w-full' : 'w-[304px] shrink-0 snap-start'

  const cardBody = (
    <div
      {...(swipeable
        ? {
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onPointerCancel: handlePointerUp,
            onClick: handleCardClick,
            style: { transform: `translateX(${dragX}px)`, touchAction: 'pan-y' },
          }
        : { onClick: onSelect })}
      className={cn(
        'group relative flex items-center gap-2 rounded-lg border bg-white px-[17px] py-[13px]',
        !dragging && 'transition-transform duration-200 ease-out',
        swipeable ? 'w-full' : widthClass,
        excluded
          ? 'border-pink-100 bg-pink-50'
          : selected
            ? 'border-pink-300 bg-white shadow-[0_0_4px_rgba(255,112,150,0.15)]'
            : 'border-neutral-100 bg-white',
        (onSelect || swipeable) && 'cursor-pointer'
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1">
            {isNew && (
              <span className="shrink-0 text-[16px] leading-[22.4px] font-bold tracking-[-0.48px] text-pink-500">
                New
              </span>
            )}
            <span className="text-body-sb font-semibold text-neutral-900">{area.name}</span>
            <span className="whitespace-nowrap text-[12px] font-medium text-neutral-900">
              {formatEok(area.avg_price_krw)}
            </span>
          </div>
          {excluded && onRestore && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRestore(area.code)
              }}
              className="shrink-0 text-[12px] font-medium tracking-[-0.42px] text-neutral-500 underline decoration-1 underline-offset-4"
            >
              복구하기
            </button>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium">
            <span className="flex items-center gap-1 text-pink-500">
              <CarIcon className="size-3.5" />A {area.a_minutes}분
            </span>
            {area.b_minutes != null && (
              <span className="flex items-center gap-1 text-accent-teal">
                <CarIcon className="size-3.5" />B {area.b_minutes}분
              </span>
            )}
          </span>
          {showSigungu && (
            <>
              <span className="h-3 w-px shrink-0 bg-neutral-100" />
              <span className="min-w-0 shrink truncate text-caption-l font-medium text-neutral-500">
                {area.sigungu}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 카드의 유일한 상시 행동 — 통근시간 줄이 아니라 카드 전체 높이 기준으로
          center 정렬한다(요구사항: display:flex; align-items:center). */}
      {!excluded && onListingClick && area.lat != null && area.lng != null && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onListingClick(area)
          }}
          className="flex shrink-0 items-center justify-center gap-0.5 text-[14px] leading-[1.4] font-medium tracking-[-0.48px] text-neutral-500"
        >
          매물 보기
          <ArrowUpRight className="size-4" />
        </button>
      )}

      {swipeable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            commitExclude()
          }}
          aria-label="제외"
          className="absolute top-2 right-2 hidden text-[12px] font-medium tracking-[-0.42px] text-neutral-500 underline decoration-1 underline-offset-4 opacity-0 transition-opacity [@media(hover:hover)]:block [@media(hover:hover)]:group-hover:opacity-100"
        >
          제외
        </button>
      )}
    </div>
  )

  if (!swipeable) return cardBody

  return (
    <div className={cn('relative overflow-hidden rounded-lg', widthClass)}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL_WIDTH }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            commitExclude()
          }}
          className="flex w-full items-center justify-center bg-pink-500 text-[14px] font-semibold text-white"
        >
          제외
        </button>
      </div>
      {cardBody}
    </div>
  )
}
