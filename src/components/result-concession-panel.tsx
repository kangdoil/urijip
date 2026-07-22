import { ArrowRight, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConcessionAreaCard, type ConcessionAreaData } from '@/components/concession-area-card'

// 아래 리스트에 노출하는 후보 상한 — 초과분은 카드로 나열하지 않고
// "지도에서 전체 보기" 버튼으로 넘긴다.
const MAX_VISIBLE_HOODS = 3

interface ResultConcessionPanelProps {
  // 진단 메시지 한 줄 — 후보가 있든 없든 항상 보여준다.
  message: string
  // "서로 양보" 요약 줄의 보조 설명(예: "B +15분 · A +0.8억"). 실제 양보 폭
  // 계산 로직이 아직 없어 지금은 일반 안내 문구를 쓴다.
  giveDetail: string
  // "서로 양보" 요약 줄의 배지 텍스트("폭 넓힘"/"2순위 내려놓음"/"예산 폭 넓힘").
  // null이면 양보 없이 이미 열린 상태(사다리 0단계)라 배지 자체를 숨긴다.
  giveTag: string | null
  // 서로 양보(AB) 단일안으로 새로 열리는 동네 목록. 비어 있으면 "메시지 →
  // 팁 카드 → 조율 버튼" 3단 구조로 렌더링한다 — A만/B만 개별 안은 없다.
  // 결과 화면 캐러셀과 같은 ResultAreaCard로 그려서 카드 모양·색을 통일한다.
  hoods: ConcessionAreaData[]
  // 실제 후보 총 개수 — hoods는 카드용으로 상위 몇 개만 담겨 있을 수 있어
  // "N곳" 배지·0곳 판정은 반드시 이 값을 쓴다(hoods.length로 하면 캡에 걸려
  // 실제보다 작게 보일 수 있다).
  totalCount: number
  tipTitle: string
  tipBody: string
  onAdjust: () => void
  onSelectHood?: (hood: ConcessionAreaData) => void
  onViewMap?: () => void
}

// 결과 화면 "필수 조건 만족 구역 0곳" 전용 패널. 서로 양보(AB) 후보가 있는
// 상태와 0곳 상태를 같은 컴포넌트가 데이터(hoods)만 바꿔 렌더링한다 — 부분
// 열림 / 폭을 넓혀야 열림 / 상한까지도 0곳, 세 경우 전부 이 컴포넌트 하나로
// 표현하며 별도 화면으로 분기하지 않는다. 헤드라인 + 서로 양보 요약 줄은
// 상단에, CTA 버튼은 하단에 고정되고 그 사이 콘텐츠(팁 카드 또는 후보
// 리스트)만 스크롤된다. 0곳일 땐 "서로 양보" 띠 자체를 보여줄 후보가 없어
// 렌더링하지 않는다.
export function ResultConcessionPanel({
  message,
  giveDetail,
  giveTag,
  hoods,
  totalCount,
  tipTitle,
  tipBody,
  onAdjust,
  onSelectHood,
  onViewMap,
}: ResultConcessionPanelProps) {
  const isZero = totalCount === 0
  const visibleHoods = hoods.slice(0, MAX_VISIBLE_HOODS)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-6">
        <div>
          <p className="text-title-sb leading-[1.3] font-extrabold text-neutral-900">
            🤝 함께 조금씩 양보하면 여기예요
          </p>
          <p className="mt-1 text-body-s text-neutral-500">
            두 분 조건에서 가장 균형 잡힌 조합이에요
          </p>
        </div>

        <p className="rounded-lg bg-pink-50 px-3.5 py-2.5 text-body-s leading-[1.5] text-pink-700">
          {message}
        </p>

        {!isZero && giveTag != null && (
          <div className="flex items-center gap-3 rounded-r-xl border-l-4 border-accent-lavender bg-neutral-50 px-3.5 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-lavender text-[11px] font-bold text-neutral-900">
              AB
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-body-sb font-bold text-neutral-900">
                서로 양보
                <span className="rounded-md bg-pink-50 px-1.5 py-0.5 text-caption-m font-bold text-pink-700">
                  {giveTag}
                </span>
              </p>
              <p className="mt-0.5 truncate text-caption-l text-neutral-500">{giveDetail}</p>
            </div>
            <span className="shrink-0 text-body-sb font-bold text-neutral-900">{totalCount}곳</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {isZero ? (
          <div className="rounded-2xl bg-white p-4 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
            <div className="mb-2 flex items-center gap-1.5">
              <Lightbulb className="size-4 text-pink-500" />
              <span className="text-body-sb font-bold text-neutral-900">{tipTitle}</span>
            </div>
            <p className="text-body-s leading-[1.65] text-neutral-600">{tipBody}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleHoods.map((h) => (
              <ConcessionAreaCard
                key={h.code}
                area={h}
                onSelect={onSelectHood ? () => onSelectHood(h) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* CTA는 콘텐츠 스크롤과 무관하게 항상 하단에 고정 — 위 스크롤 영역과
          분리된 shrink-0 블록으로 둔다. */}
      <div className={cn('shrink-0 px-4 pt-3', isZero ? 'pb-6' : onViewMap ? 'pb-6' : 'pb-0')}>
        {isZero ? (
          <button
            onClick={onAdjust}
            className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
          >
            조건 조율하기
          </button>
        ) : (
          onViewMap && (
            <button
              onClick={onViewMap}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
            >
              지도에서 전체 보기
              <ArrowRight className="size-4" />
            </button>
          )
        )}
      </div>
    </div>
  )
}
