'use client'

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer'
import { CONDITION_LABEL, TIER_LABEL, formatEok, type Tier } from '@/lib/condition-labels'

export interface ParticipantConditionSummary {
  role: 'A' | 'B'
  display_name: string | null
  budget_max_krw: number | null
  commute_max_min: number | null
  conditions: Record<string, Tier>
}

const CODES = ['area_size', 'build_year', 'infra'] as const

interface MustConditionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  participants: ParticipantConditionSummary[] | null
  mustConditions: string[]
  budgetLabel: string
  conflict: boolean
  // 시군구 수 × 3(시군구별 추천 동네 상한) 기준의 "곳" 수.
  count: number
}

// "필수 조건 : 평형, 인프라 / ..." 요약 줄을 누르면 뜨는 풀페이지 시트.
// 위쪽엔 A/B가 각각 고른 조건을, 아래쪽엔 그 조건으로 왜 이 동네들을
// 추천했는지 설명을 보여준다.
export function MustConditionSheet({
  open,
  onOpenChange,
  participants,
  mustConditions,
  budgetLabel,
  conflict,
  count,
}: MustConditionSheetProps) {
  const mustNames = mustConditions.map((c) => CONDITION_LABEL[c] ?? c)
  const mustLabel = mustNames.length > 0 ? `${mustNames.join(', ')} 필수` : '필수 조건 없음'

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-[92vh] data-[vaul-drawer-direction=bottom]:max-h-[92vh]">
        <DrawerHeader>
          <DrawerTitle>두 분의 조건</DrawerTitle>
          <DrawerDescription>
            {mustLabel} · {budgetLabel}
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
                          {p.conditions[code] ? TIER_LABEL[p.conditions[code]] : '-'}
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
              두 분이 필수로 고른 조건({mustNames.length > 0 ? mustNames.join(', ') : '없음'})을 모두
              만족하고, {budgetLabel}인 구역 {count}곳을 통근시간 합이 짧은 순으로 보여드려요.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
