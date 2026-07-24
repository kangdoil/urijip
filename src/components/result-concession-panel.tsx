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
  tipTitle: string
  tipBody: string
  // A/B 각자 무엇을 양보했는지 — 양보한 게 없는 role은 애초에 배열에 없다.
  giveChips: ConcessionGiveChip[]
  applying: boolean
  onApply: () => void
}

const ROLE_LETTER_SRC: Record<'A' | 'B', string> = {
  A: '/asset/priority-letter-a.png',
  B: '/asset/priority-letter-b.png',
}

// "다른 커플들은 이렇게 조율했어요" 카드 — 아직 다른 세션을 모아 보여주는
// 집계 API가 없어서 정적 목업이다(요청사항: 시각화 통계자료는 일단 목업
// 처리). 실제 집계 기능이 생기면 이 블록을 props로 바꾸면 된다.
function OtherCouplesCard() {
  return (
    <div className="flex w-[350px] shrink-0 flex-col gap-4 rounded-2xl bg-white px-4 py-5 opacity-60 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
            <Lightbulb className="size-5 text-pink-500" />
            다른 커플들은 이렇게 조율했어요
          </span>
          <span className="shrink-0 rounded-md bg-pink-50 px-2 py-[3px] text-caption-m font-bold text-pink-700">
            2순위 내려놓음
          </span>
        </div>
        <p className="text-body-s leading-[1.65] text-neutral-500">
          조건에 맞는 동네를 찾지 못했어요
          <br />두 분의 2순위 조건을 잠시 내려놓고 찾아봤어요
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {(
          [
            ['A', '년식 양보'] as const,
            ['B', '인프라 · 통근 +15분 양보'] as const,
          ]
        ).map(([role, text]) => (
          <span
            key={role}
            className={cn(
              'flex w-fit items-center gap-0.5 rounded-full py-1 pr-3 pl-2',
              role === 'A' ? 'bg-pink-200/50' : 'bg-[#c6fffe]'
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.4px] p-[1.4px]',
                role === 'A' ? 'border-pink-500 bg-pink-100' : 'border-accent-teal bg-accent-teal/10'
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ROLE_LETTER_SRC[role]} alt={role} className="size-full rounded-full object-cover" />
            </span>
            <span className="text-body-sb font-medium text-neutral-900">{text}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// 조건별로 양보하면 몇 곳이 열리는지 비교하는 막대그래프 — 실제 계산 RPC가
// 아직 없어서 목업 수치다(요청사항). 추천안(년식)만 강조색, 나머지는 중립색.
const MOCK_CHART_ROWS = [
  { label: '년식 양보', count: 10, highlighted: true },
  { label: '인프라 양보', count: 7, highlighted: false },
  { label: '평수 양보', count: 4, highlighted: false },
] as const
const MOCK_CHART_MAX = 10
const MOCK_BENEFIT_TAGS = ['넓은 평수 8곳', '인프라 우수 6곳', '예산 여유 5곳'] as const

function OpenedAreasCard() {
  return (
    <div className="flex w-[350px] shrink-0 flex-col gap-4 rounded-2xl bg-white px-5 py-6 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
          <Lightbulb className="size-5 text-pink-500" />
          함께 양보로 열리는 동네예요
        </span>
        <p className="text-body-s leading-[1.4] text-neutral-500">
          두 분 조건에서 무엇을 내려놓느냐에 따라
          <br />
          찾을 수 있는 동네가 달라져요.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {MOCK_CHART_ROWS.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
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
                style={{ width: `${(row.count / MOCK_CHART_MAX) * 100}%` }}
              />
            </span>
            <span className="w-[28px] shrink-0 text-right text-caption-l font-semibold text-neutral-900">
              {row.count}곳
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
        <p className="text-caption-l font-semibold text-neutral-900">년식을 양보하면 이런 곳이 열려요</p>
        <div className="flex flex-wrap gap-1.5">
          {MOCK_BENEFIT_TAGS.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-accent-teal/10 px-3 py-1.5 text-caption-m font-medium text-neutral-900"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// 결과 화면 "필수 조건 만족 구역 0곳(콜드 스테이션)" 전용 패널(Figma: 교집합
// 없을 때 화면). 캐러셀 카드 3장 — ① 실제 계산된 추천 조율안(우리 데이터),
// ② 다른 커플들 참고(목업), ③ 양보별로 열리는 동네 비교 그래프(목업). ②③는
// 아직 없는 집계 기능 자리라 정적 콘텐츠다. 하단 버튼은 apply_concession
// RPC로 ①의 추천안을 실제 조건에 반영한 뒤 결과 화면을 새로고침한다
// (제안/수락 절차 없이 즉시 적용 — 요청사항).
export function ResultConcessionPanel({
  totalCount,
  tipTitle,
  tipBody,
  giveChips,
  applying,
  onApply,
}: ResultConcessionPanelProps) {
  const [tipLine1, tipLine2] = tipBody.split('\n')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col items-center gap-0.5 p-4 text-center">
        <p className="text-body-m font-semibold text-neutral-900">함께 조금씩 양보하면 갈 수 있는 동네</p>
        <p className="text-title-sb font-bold text-neutral-900">
          총 <span className="font-montserrat text-mont-title-l text-pink-500">{totalCount}</span>곳
        </p>
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-2 overflow-x-auto px-5 pb-2">
        <div className="flex w-[350px] shrink-0 flex-col gap-8 rounded-2xl bg-white px-5 py-6 shadow-[0_10px_10px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1 text-[16px] font-bold tracking-[-0.42px] text-neutral-900">
              <Lightbulb className="size-5 text-pink-500" />
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
            <div className="flex flex-col gap-4">
              {giveChips.map((chip) => (
                <span
                  key={chip.role}
                  className={cn(
                    'flex w-full items-center gap-1 rounded-xl px-5 py-2',
                    chip.role === 'A' ? 'bg-pink-200/50' : 'bg-[#c6fffe]'
                  )}
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
        </div>

        <OtherCouplesCard />
        <OpenedAreasCard />
      </div>

      <div className="shrink-0 px-4 pt-3 pb-6">
        <button
          onClick={onApply}
          disabled={applying}
          className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white disabled:opacity-50"
        >
          {applying ? '적용하는 중...' : '이 조건으로 바꾸고 동네 보러 가기'}
        </button>
      </div>
    </div>
  )
}
