'use client'

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { CONDITION_LABEL, PRIORITY_LABEL, formatEok, type Priority } from '@/lib/condition-labels'

export interface ParticipantConditionSummary {
  role: 'A' | 'B'
  display_name: string | null
  budget_max_krw: number | null
  commute_max_min: number | null
  priorities: Record<string, Priority>
}

const CODES = ['area_size', 'build_year', 'infra'] as const

interface ConditionSummarySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  participants: ParticipantConditionSummary[] | null
  // get_matches가 내려주는 순위 순서(코드 배열, 1위부터) — A/B 각각.
  priorities: { a: string[]; b: string[] }
  budgetLabel: string
  conflict: boolean
  // 시군구 수 × 3(시군구별 추천 동네 상한) 기준의 "곳" 수.
  count: number
}

function topLabel(codes: string[]) {
  return codes[0] ? (CONDITION_LABEL[codes[0]] ?? codes[0]) : null
}

// "A 1순위 : 평형 / B 1순위 : 인프라 · ..." 요약 줄을 누르면 뜨는 풀페이지 시트.
// 위쪽엔 A/B가 각각 매긴 순위를, 아래쪽엔 그 순위로 왜 이 동네들을 추천했는지
// 설명을 보여준다. 더 이상 "필수 조건"은 없다 — 순위는 정렬 가중치일 뿐이라
// 후보를 걸러내지 않는다.
export function ConditionSummarySheet({
  open,
  onOpenChange,
  participants,
  priorities,
  budgetLabel,
  conflict,
  count,
}: ConditionSummarySheetProps) {
  const aTop = topLabel(priorities.a)
  const bTop = topLabel(priorities.b)
  const topLine = [aTop && `A 1순위 ${aTop}`, bTop && `B 1순위 ${bTop}`].filter(Boolean).join(' · ')

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className=" data-[vaul-drawer-direction=bottom]:max-h-[92vh]">
        <DrawerHeader>
          <DrawerTitle>두 분의 조건</DrawerTitle>
          <DrawerDescription>
            {topLine || '순위 정보 없음'} · {budgetLabel}
            {conflict && ' (예산은 낮은 쪽 기준)'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {participants && (
            <div className="mb-6 grid grid-cols-2 gap-3">
              {participants.map((p) => (
                <div key={p.role} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <p
                    className={`mb-2 text-sm font-semibold ${
                      p.role === 'A' ? 'text-pink-500' : 'text-accent-teal'
                    }`}
                  >
                    {p.display_name ?? p.role} ({p.role})
                  </p>
                  <dl className="flex flex-col gap-1.5 text-xs text-neutral-600">
                    <div className="flex justify-between">
                      <dt>예산</dt>
                      <dd className="font-medium text-neutral-900">{formatEok(p.budget_max_krw)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>통근 상한</dt>
                      <dd className="font-medium text-neutral-900">{p.commute_max_min}분</dd>
                    </div>
                    {CODES.map((code) => (
                      <div key={code} className="flex justify-between">
                        <dt>{CONDITION_LABEL[code]}</dt>
                        <dd className="font-medium text-neutral-900">
                          {p.priorities[code] ? PRIORITY_LABEL[p.priorities[code]] : '-'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl bg-neutral-50 p-4">
            <p className="mb-1 text-sm font-semibold text-neutral-900">이렇게 추천했어요</p>
            <p className="text-sm leading-[1.5] text-neutral-600">
              두 분이 매긴 순위를 반영해 더 잘 맞는 동네부터, {budgetLabel}인 구역 {count}곳을
              통근시간 합이 짧은 순으로 보여드려요.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
