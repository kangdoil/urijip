'use client'

import { Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ConcessionGiveChip {
  role: 'A' | 'B'
  text: string
}

interface ResultConcessionPanelProps {
  // "총 N곳" — get_concession_matches의 main.total_count 그대로.
  totalCount: number
  // 팁 카드 우상단 배지("2순위 내려놓음"/"폭 넓힘" 등). null이면 배지를 숨긴다
  // (사다리 0단계 — 사실상 이 패널 자체가 뜰 일이 없는 경우).
  giveTag: string | null
  tipTitle: string
  tipBody: string
  // A/B 각자 무엇을 양보했는지 — 양보한 게 없는 role은 애초에 배열에 없다.
  giveChips: ConcessionGiveChip[]
  onAdjust: () => void
}

const ROLE_LETTER_SRC: Record<'A' | 'B', string> = {
  A: '/asset/priority-letter-a.png',
  B: '/asset/priority-letter-b.png',
}

// 결과 화면 "필수 조건 만족 구역 0곳(콜드 스테이션)" 전용 패널(Figma: 교집합
// 없을 때 화면). 예전엔 서로 양보(AB) 후보를 카드 리스트로 나열하고 "조금 더
// 양보하면" 섹션까지 펼쳤지만, 지금은 무엇을 조율하면 열리는지 설명하는 팁
// 카드 캐러셀 하나로 대체한다 — 실제 동네 리스트는 이 화면에서 더 이상
// 보여주지 않는다(조율은 onAdjust로 넘어가서 한다). 캐러셀 두 번째 자리는
// 아직 틀만 — 콘텐츠는 다음 작업에서 채운다.
export function ResultConcessionPanel({
  totalCount,
  giveTag,
  tipTitle,
  tipBody,
  giveChips,
  onAdjust,
}: ResultConcessionPanelProps) {
  const [tipLine1, tipLine2] = tipBody.split('\n')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col items-center gap-0.5 p-4 text-center">
        <p className="text-body-m font-semibold text-neutral-900">함께 조금씩 양보하면 여기예요</p>
        <p className="text-title-sb font-bold text-neutral-900">
          총 <span className="font-montserrat text-mont-title-l text-pink-500">{totalCount}</span>곳
        </p>
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-2 overflow-x-auto px-5 pb-2">
        <div className="flex w-[350px] shrink-0 flex-col gap-4 rounded-2xl bg-white px-4 py-5 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
              <Lightbulb className="size-5 text-pink-500" />
              {tipTitle}
            </span>
            {giveTag && (
              <span className="shrink-0 rounded-md bg-pink-50 px-2 py-[3px] text-caption-m font-bold text-pink-700">
                {giveTag}
              </span>
            )}
          </div>

          <p className="text-body-s leading-[1.65] text-neutral-500">
            {tipLine1}
            {tipLine2 && (
              <>
                <br />
                {tipLine2}
              </>
            )}
          </p>

          {giveChips.length > 0 && (
            <div className="flex flex-col gap-2">
              {giveChips.map((chip) => (
                <span
                  key={chip.role}
                  className={cn(
                    'flex w-fit items-center gap-0.5 rounded-full py-1 pr-3 pl-2',
                    chip.role === 'A' ? 'bg-pink-200/50' : 'bg-[#c6fffe]'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.4px] p-[1.4px]',
                      chip.role === 'A' ? 'border-pink-500 bg-pink-100' : 'border-accent-teal bg-accent-teal/10'
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ROLE_LETTER_SRC[chip.role]} alt={chip.role} className="size-full rounded-full object-cover" />
                  </span>
                  <span className="text-body-sb font-medium text-neutral-900">{chip.text}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 캐러셀 두 번째 자리 — 틀만, 콘텐츠는 아직 없음 */}
        <div className="h-full min-h-[160px] w-[350px] shrink-0 rounded-2xl border-2 border-dashed border-neutral-200" />
      </div>

      <div className="shrink-0 px-4 pt-3 pb-6">
        <button
          onClick={onAdjust}
          className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
        >
          이 조건으로 바꾸고 동네 보러 가기
        </button>
      </div>
    </div>
  )
}
