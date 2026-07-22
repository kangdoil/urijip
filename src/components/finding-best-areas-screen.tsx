'use client'

import { useEffect, useState } from 'react'

// 통근시간 배치 계산을 기다리는 동안 보여주는 화면 — 카피는 "통근 시간"이
// 아니라 "최적의 동네를 찾는 중"으로 제공한다(실제로는 통근시간 계산이 그
// 안에 포함된 여러 단계 중 하나일 뿐이라, 사용자에게는 결과에 가까운 표현을
// 보여준다). Figma: 우리집 동네 찾기 마지막 프레임과 동일한 레이아웃.
const LOADING_MESSAGES = [
  '나의 출퇴근 최적 거리 찾는 중...',
  '상대방과의 교집합 찾는 중...',
  '최고의 우리집 지역 찾는 중...',
  '상대방 통근 시간 계산 하는 중...',
  '예산에 맞는 동네 좁혀가는 중...',
]

export function FindingBestAreasScreen() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % LOADING_MESSAGES.length)
    }, 2200)
    return () => clearInterval(timer)
  }, [])

  return (
    <main className="flex flex-1 flex-col items-center bg-neutral-50 px-4 pt-[138px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
          최적의 동네를 찾고 있어요
        </h1>
        <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
          보통 30초 안에 끝나요, 잠시만 기다려주세요
        </p>
      </div>

      <div className="mt-12 flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/urijip_logo.png" alt="우리집" className="size-[184px]" />

        <div className="relative flex flex-col items-center pb-8">
          {/* 다음 순서로 올라올 메시지가 뒤에서 살짝 미리 보이는 "카드 스택" 연출
              (Figma: Frame 2 — 뒤 카드는 앞 카드보다 작고 흐리게, 66% 지점부터
              아래로 삐져나오게 배치한다). */}
          <div
            aria-hidden
            className="absolute top-[47px] left-1/2 w-[75%] -translate-x-1/2 rounded-[19.2px] bg-white px-[25.6px] py-[19.2px] opacity-30 shadow-[0_8px_8px_rgba(0,0,0,0.04)]"
          >
            <p className="truncate text-center text-xs leading-[18px] font-bold text-neutral-900">
              {LOADING_MESSAGES[(index + 1) % LOADING_MESSAGES.length]}
            </p>
          </div>
          <p
            key={index}
            role="status"
            aria-live="polite"
            className="animate-in fade-in slide-in-from-bottom-2 relative z-10 rounded-xl bg-white px-8 py-6 text-center text-[15px] leading-[22.5px] font-bold text-neutral-900 shadow-[0_10px_10px_rgba(0,0,0,0.04)] duration-500"
          >
            {LOADING_MESSAGES[index]}
          </p>
        </div>
      </div>
    </main>
  )
}
