import { cn } from '@/lib/utils'

export function ResultHeaderPill({
  title,
  subtitle,
  count,
  partnerConfirmed,
}: {
  title: string
  // 매칭 0건(폴백) 상태에서 title 옆에 덧붙는 진단 문구(예: "통근·예산 조건에
  // 맞는 구역이 없어요") — Figma: 추천 동네 + 별도 텍스트가 나란히 온다.
  subtitle?: string
  // 아래 카드 리스트에 실제로 보이는 구역 개수 그대로 받는다(시군구 필터·
  // 제외 반영 결과) — 제외하면 곧바로 줄어들고, area_exclusions Realtime
  // 구독으로 상대방 화면에도 그대로 반영된다.
  count?: number
  // undefined면 배지를 아예 숨긴다 (예: 매칭 0건 폴백 상태)
  partnerConfirmed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white bg-neutral-50/50 px-5 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.04)] backdrop-blur-[10px]">
      <div className="flex min-w-0 items-center gap-2">
        <p className="flex shrink-0 items-center gap-1 text-lg font-semibold tracking-[-0.03em] text-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/asset/icon/house.svg" alt="" className="size-5 shrink-0" />
          <span className="truncate">{title}</span>
        </p>
        {subtitle && (
          <span className="truncate text-body-sb font-semibold text-neutral-900">{subtitle}</span>
        )}
        {count != null && (
          <span className="whitespace-nowrap text-body-sb font-semibold text-neutral-900">
            총 {count}곳
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {partnerConfirmed != null && (
          <span
            className={cn(
              'flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1.5 text-body-sb font-bold text-pink-500 shadow-[0_10px_20px_rgba(0,0,0,0.04)]',
              partnerConfirmed ? 'bg-neutral-900' : 'bg-pink-200'
            )}
          >
            <span className="size-1.5 rounded-full bg-pink-500" />
            {partnerConfirmed ? '상대 확정' : '상대 미확정'}
          </span>
        )}
      </div>
    </div>
  )
}
