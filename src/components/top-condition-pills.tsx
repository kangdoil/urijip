import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import type { ParticipantConditionSummary } from '@/components/condition-summary-sheet'

// 지도 상단 pill 전용 표기 — 조건 시트(CONDITION_LABEL: 평형/연식/인프라)와는
// 다른, 결과 화면 헤드라인용 카피(넓은 집/새 집/인프라)다.
const PILL_CONDITION_LABEL: Record<string, string> = {
  area_size: '넓은 집',
  build_year: '새 집',
  infra: '인프라',
}

// 참여자의 1순위 조건 하나를 "대표 조건"으로 뽑는다. priority 데이터가 없는
// 예외 상황(온보딩 중 조회 실패 등)에서만 통근시간을 기본값으로 보여준다.
function representativeLabel(priorities: Record<string, number>): string {
  const topCode = Object.entries(priorities).find(([, priority]) => priority === 1)?.[0]
  if (!topCode) return '통근시간'
  return PILL_CONDITION_LABEL[topCode] ?? CONDITION_LABEL[topCode] ?? topCode
}

const AVATAR_SRC: Record<'A' | 'B', string> = {
  A: '/asset/a2.png',
  B: '/asset/b2.png',
}

// 지도 상단에 상시 노출되는 A/B 대표 조건 pill. 탭하면 조건 상세 + 추천 이유
// 바텀시트(ConditionSummarySheet)가 뜬다 — 예전 "왜 이 동네들을 추천했을까요?"
// 버튼을 대체한다.
export function TopConditionPills({
  participants,
  onClick,
}: {
  participants: ParticipantConditionSummary[] | null
  onClick: () => void
}) {
  if (!participants || participants.length === 0) return null

  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto flex items-center gap-4 rounded-full border border-white bg-[rgba(246,247,249,0.4)] px-[21px] py-[7px] shadow-[0_10px_40px_rgba(0,0,0,0.08)] backdrop-blur-[6px]"
    >
      {participants.map((p, i) => (
        <div key={p.role} className="flex items-center gap-4">
          {i > 0 && <span className="h-6 w-px shrink-0 bg-neutral-300" aria-hidden />}
          <div className="flex items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={AVATAR_SRC[p.role]}
              alt={p.role}
              className="size-7 shrink-0 rounded-full"
              width={28}
              height={28}
            />
            <span className="flex flex-col items-start text-[12px] leading-[1.4]">
              <span className="font-semibold tracking-[-0.03em] text-neutral-900">
                {representativeLabel(p.priorities)}
              </span>
              <span className="font-medium tracking-[-0.035em] text-neutral-900">
                {formatEok(p.budget_max_krw)} · {p.commute_max_min}분
              </span>
            </span>
          </div>
        </div>
      ))}
    </button>
  )
}
