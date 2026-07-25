'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StatsComparisonProps } from '@/lib/concession-copy'

export interface ConcessionGiveChip {
  role: 'A' | 'B'
  text: string
}

interface ResultConcessionPanelProps {
  // "총 N곳" — get_concession_matches의 main.total_count 그대로.
  totalCount: number
  tipTitle: string
  tipBody: string
  // A/B 각자 무엇을 양보했는지 — 양보한 게 없는 role은 애초에 배열에 없다.
  giveChips: ConcessionGiveChip[]
  stats: StatsComparisonProps
}

const ROLE_LETTER_SRC: Record<'A' | 'B', string> = {
  A: '/asset/priority-letter-a.png',
  B: '/asset/priority-letter-b.png',
}

// 조건별로 양보하면 몇 곳이 열리는지 비교하는 막대그래프 — get_concession_matches
// RPC가 계산한 실제 수치(Task 2의 buildStatsComparisonProps)를 그대로 그린다.
function StatsComparisonCard({ rows, benefit }: StatsComparisonProps) {
  const maxCount = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="flex h-full w-full shrink-0 flex-col gap-4 rounded-2xl bg-white px-5 py-6">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/asset/icon/idea.svg" alt="" className="size-5" />
          함께 양보로 열리는 동네예요
        </span>
        <p className="text-body-s leading-[1.4] text-neutral-500">
          두 분 조건에서 무엇을 내려놓느냐에 따라
          <br />
          찾을 수 있는 동네가 달라져요.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.code} className="flex items-center gap-2">
            <span className="w-[70px] shrink-0 text-caption-l font-medium text-neutral-900">
              {row.label}
              {row.highlighted && (
                <span className="ml-1 rounded bg-pink-50 px-1 py-px text-[9px] font-bold text-pink-700">
                  제안
                </span>
              )}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <span
                className={cn('block h-full rounded-full', row.highlighted ? 'bg-pink-500' : 'bg-neutral-300')}
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="w-[28px] shrink-0 text-right text-caption-l font-semibold text-neutral-900">
              {row.count}곳
            </span>
          </div>
        ))}
      </div>

      {benefit && (
        <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
          <p className="text-caption-l font-semibold text-neutral-900">{benefit.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {benefit.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-teal/10 px-3 py-1.5 text-caption-m font-medium text-neutral-900"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// 결과 화면 "필수 조건 만족 구역 0곳(콜드 스테이션)" 전용 패널(Figma: 교집합
// 없을 때 화면). 스와이프 페이저 카드 2장 — ① 실제 계산된 추천 조율안(우리
// 데이터), ② 양보별로 열리는 동네 비교 그래프(실 데이터, StatsComparisonCard).
// 적용 버튼은 vaul Drawer.Content의 transform이 fixed/absolute 자손의
// containing block이 되는 문제 때문에 이 패널 밖(result-map-sheet.tsx)에서
// 뷰포트 기준 fixed로 별도 렌더링한다 — ActionButtonsFooter와 동일한 이유.
export function ResultConcessionPanel({
  totalCount,
  tipTitle,
  tipBody,
  giveChips,
  stats,
}: ResultConcessionPanelProps) {
  const [tipLine1, tipLine2] = tipBody.split('\n')
  const [page, setPage] = useState(0)
  const hasStatsCard = stats.rows.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col items-center gap-0.5 p-4 text-center">
        <p className="text-body-m font-semibold text-neutral-900">함께 조금씩 양보하면 갈 수 있는 동네</p>
        <p className="text-title-sb font-bold text-neutral-900">
          총 <span className="font-montserrat text-mont-title-l text-pink-500">{totalCount}</span>곳
        </p>
      </div>

      <div className="overflow-hidden px-5 pb-2">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          <div className="h-full w-full shrink-0">
            <div className="flex h-full flex-col gap-8 rounded-2xl bg-white px-5 py-6">
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/asset/icon/idea.svg" alt="" className="size-5" />
                  {tipTitle}
                </span>
                <p className="text-body-s leading-[1.4] text-neutral-500">
                  {tipLine1}
                  {tipLine2 && (
                    <>
                      <br />
                      {tipLine2}
                    </>
                  )}
                </p>
              </div>

              {giveChips.length > 0 && (
                <div className="flex flex-col gap-2">
                  {giveChips.map((chip) => (
                    <span
                      key={chip.role}
                      className="flex w-full items-center gap-1 rounded-xl bg-neutral-50 px-5 py-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ROLE_LETTER_SRC[chip.role]} alt={chip.role} className="size-8 shrink-0" />
                      <span className="text-base font-semibold tracking-[-0.504px] text-neutral-900">
                        {chip.text}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="h-px w-full bg-neutral-100" />
                <div className="flex items-center justify-center gap-2 text-body-s">
                  <span className="text-neutral-400">조율 전 0곳</span>
                  <ArrowRight className="size-4 text-neutral-300" />
                  <span className="font-semibold text-neutral-900">
                    조율 후 <span className="text-pink-500">{totalCount}</span>곳
                  </span>
                </div>
              </div>
            </div>
          </div>

          {hasStatsCard && (
            <div className="h-full w-full shrink-0">
              <StatsComparisonCard rows={stats.rows} benefit={stats.benefit} />
            </div>
          )}
        </div>
      </div>

      {hasStatsCard && (
        <div className="flex shrink-0 justify-center gap-1.5 pb-1">
          {[0, 1].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i + 1}번째 카드로 이동`}
              onClick={() => setPage(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                page === i ? 'w-4 bg-pink-500' : 'w-1.5 bg-neutral-200'
              )}
            />
          ))}
        </div>
      )}

    </div>
  )
}
