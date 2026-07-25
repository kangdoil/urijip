'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { CONDITION_LABEL } from '@/lib/condition-labels'

function badgeClass(role: 'A' | 'B') {
  return role === 'A' ? 'bg-pink-500' : 'bg-accent-teal'
}

function borderClass(role: 'A' | 'B') {
  return role === 'A' ? 'border-pink-500' : 'border-accent-teal'
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 20" fill="none" className={className} aria-hidden>
      {[3, 9, 15].map((cy) => (
        <g key={cy}>
          <circle cx={3} cy={cy} r="1.4" fill="currentColor" />
          <circle cx={9} cy={cy} r="1.4" fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

interface PriorityOrderListProps {
  role: 'A' | 'B'
  order: string[]
  onReorder: (order: string[]) => void
  interactive: boolean
}

// 우선순위 칩 세로 목록 — 그립(⠿) 핸들을 눌러 위아래로 끌면 포인터가 이웃 칩의
// 중간선을 넘을 때마다 배열을 스왑한다. dnd-kit 등 정렬 전용 라이브러리를
// 새로 설치하지 않고(스택 변경 금지) Pointer Events만으로 구현한 최소 드래그
// 정렬 — 항목이 3개뿐이라 물리 애니메이션 없이도 충분히 자연스럽다.
// 키보드 사용자를 위해 그립에 방향키 재정렬도 함께 지원한다.
export function PriorityOrderList({ role, order, onReorder, interactive }: PriorityOrderListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragCode, setDragCode] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const dragState = useRef<{ startY: number; startIndex: number; itemHeight: number } | null>(null)

  useEffect(() => {
    if (!dragCode) return

    function handleMove(e: PointerEvent) {
      const state = dragState.current
      if (!state) return
      const delta = e.clientY - state.startY
      setDragOffset(delta)
      const shift = Math.round(delta / state.itemHeight)
      const newIndex = Math.min(Math.max(state.startIndex + shift, 0), order.length - 1)
      const currentIndex = order.indexOf(dragCode as string)
      if (newIndex !== currentIndex) {
        const next = [...order]
        next.splice(currentIndex, 1)
        next.splice(newIndex, 0, dragCode as string)
        onReorder(next)
      }
    }

    function handleUp() {
      setDragCode(null)
      setDragOffset(0)
      dragState.current = null
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [dragCode, order, onReorder])

  function handlePointerDown(e: React.PointerEvent, code: string) {
    if (!interactive) return
    const container = containerRef.current
    if (!container) return
    const items = container.querySelectorAll<HTMLElement>('[data-priority-item]')
    const itemHeight =
      items.length > 1
        ? items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top
        : (items[0]?.getBoundingClientRect().height ?? 52)
    dragState.current = { startY: e.clientY, startIndex: order.indexOf(code), itemHeight }
    setDragCode(code)
  }

  function handleKeyDown(e: React.KeyboardEvent, code: string, i: number) {
    if (!interactive) return
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault()
      const next = [...order]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      onReorder(next)
    } else if (e.key === 'ArrowDown' && i < order.length - 1) {
      e.preventDefault()
      const next = [...order]
      ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
      onReorder(next)
    }
  }

  return (
    <div ref={containerRef} className={cn('flex w-full flex-col gap-1.5', !interactive && 'opacity-50')}>
      {order.map((code, i) => {
        const isDragging = code === dragCode
        return (
          <div
            key={code}
            data-priority-item
            style={isDragging ? { transform: `translateY(${dragOffset}px)`, zIndex: 10 } : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full border bg-white px-[13px] py-[9px] transition-shadow',
              borderClass(role),
              isDragging && 'shadow-lg'
            )}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                badgeClass(role)
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.36px] text-neutral-900">
              {CONDITION_LABEL[code]}
            </span>
            {interactive && (
              <div
                role="button"
                tabIndex={0}
                onPointerDown={(e) => handlePointerDown(e, code)}
                onKeyDown={(e) => handleKeyDown(e, code, i)}
                aria-label={`${CONDITION_LABEL[code]} 순서 변경`}
                className="shrink-0 touch-none rounded px-1 text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300 active:text-neutral-400"
                style={{ touchAction: 'none' }}
              >
                <GripIcon className="size-3" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
