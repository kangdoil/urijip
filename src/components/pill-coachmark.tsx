'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'

const PILL_COACHMARK_SEEN_KEY = 'urijib:pill-coachmark-seen'

function subscribe() {
  return () => {}
}

function getSnapshot() {
  return window.localStorage.getItem(PILL_COACHMARK_SEEN_KEY) != null
}

// 서버 렌더는 "이미 봤다"고 가정해 항상 닫힌 채로 그린다 — SSR엔 localStorage가
// 없어 진짜 값을 알 수 없는데, 여기서 false(안 봤음)로 가정하면 클라이언트의
// 진짜 값과 어긋나 하이드레이션 경고가 난다(실측 확인). useSyncExternalStore는
// 하이드레이션 시점엔 이 서버 스냅샷을 그대로 쓰고, 마운트 뒤에만 실제
// localStorage 값으로 안전하게 갈아끼워준다.
function getServerSnapshot() {
  return true
}

// 대표 조건 pill을 처음 보여줄 때 1회만 뜨는 코치마크. 스와이프 안내
// 버블(SwipeHintBubble)과 동일한 원칙 — 유저 브라우저당 딱 한 번만 자동
// 노출하고, 탭하면(자기 자신이든 화면의 다른 곳이든) 닫힌 뒤 다시 뜨지 않는다.
export function PillCoachmark() {
  const alreadySeen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [dismissed, setDismissed] = useState(false)
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const visible = !alreadySeen && !dismissed

  function close() {
    window.localStorage.setItem(PILL_COACHMARK_SEEN_KEY, '1')
    setDismissed(true)
  }

  // 버블 자신을 탭해도, 화면의 다른 곳을 탭해도 동일하게 닫힌다 — 버블 안쪽
  // 탭은 버튼 onClick이 이미 처리하므로, 여기서는 바깥 탭만 잡아 중복 호출을
  // 막는다.
  useEffect(() => {
    if (!visible) return
    function handlePointerDown(e: PointerEvent) {
      if (bubbleRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [visible])

  if (!visible) return null

  return (
    <button
      ref={bubbleRef}
      type="button"
      onClick={close}
      className="mx-auto flex max-w-[calc(100%-32px)] items-center gap-3 rounded-full bg-neutral-900 py-2 pr-3 pl-4 text-left shadow-[0_10px_15px_rgba(0,0,0,0.2)]"
    >
      <span className="text-[14px] font-semibold tracking-[-0.03em] text-white">
        위 조건을 탭하면 추천 이유를 볼 수 있어요.
      </span>
      <X className="size-4 shrink-0 text-white" aria-hidden />
    </button>
  )
}
