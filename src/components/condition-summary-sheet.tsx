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
  // 실제로 아래 카드 리스트에 뜨는 동네 개수(totalMatchCount) 그대로 — 시군구
  // 수 × 3 같은 별도 계산 없음.
  count: number
}

function topLabel(codes: string[]) {
  return codes[0] ? (CONDITION_LABEL[codes[0]] ?? codes[0]) : null
}

// A/B 1순위 조건 하드필터를 설명하는 문장 — 07-22 priority_hard_filter
// 마이그레이션 이후 get_matches는 A·B 각자의 1순위 조건을 만족 못 하는
// 동네를 후보에서 완전히 제외한다(2·3순위는 여전히 정렬 가중치로만 반영).
// aTop === bTop(같은 조건을 1순위로 고른 경우)과 solo(상대 순위 없음)를
// 각각 자연스러운 문장으로 분기한다.
function requiredConditionLine(aTop: string | null, bTop: string | null): string | null {
  if (aTop && bTop) {
    return aTop === bTop
      ? `두 분 모두 1순위로 고른 조건(${aTop})은 반드시 만족하는 동네만 추렸어요.`
      : `1순위 조건(A: ${aTop}, B: ${bTop})은 반드시 만족하는 동네만 추렸어요.`
  }
  const only = aTop ?? bTop
  return only ? `1순위 조건(${only})은 반드시 만족하는 동네만 추렸어요.` : null
}

// "A 1순위 : 평형 / B 1순위 : 인프라 · ..." 요약 줄을 누르면 뜨는 풀페이지 시트.
// 위쪽엔 A/B가 각각 매긴 순위를, 아래쪽엔 그 순위로 왜 이 동네들을 추천했는지
// 설명을 보여준다. 1순위 조건은 하드필터(반드시 만족), 2·3순위는 정렬
// 가중치로만 반영된다 — get_matches/_priority_hard_ok 참고.
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
  const requiredLine = requiredConditionLine(aTop, bTop)
  const sortIntro = requiredLine ? '나머지 조건은 두 분 순위를 반영해' : '두 분이 매긴 순위를 반영해'

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
              {requiredLine && <>{requiredLine} </>}
              {sortIntro} 더 잘 맞는 동네부터, {budgetLabel}인 구역 {count}곳을 통근시간 합이 짧은
              순으로 보여드려요.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
