import { Home } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ResultHeaderPill({
  title,
  count,
  excludedCount = 0,
  partnerConfirmed,
  includeExcluded,
  groups
}: {
  title: string
  // 실제 구역 개수(89개까지 나와 압도적)가 아니라 "추천 시군구 수 × 3"을
  // 받는다 — 시군구별 추천 동네가 최대 3곳이라는 기준을 곳 단위로 보여준다.
  count?: number
  // 0보다 크면 "총 N -> M곳"으로 제외 반영 전/후를 함께 보여준다.
  excludedCount?: number
  // undefined면 배지를 아예 숨긴다 (예: 매칭 0건 폴백 상태)
  partnerConfirmed?: boolean
  includeExcluded:boolean
  groups:any;
}) {

  const totalList = groups.flatMap((g:any) => g.list)

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white bg-neutral-50/50 px-5 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.04)] backdrop-blur-[10px]">
      <p className="flex min-w-0 items-center gap-1.5 text-lg font-semibold tracking-[-0.03em] text-neutral-900">
        <Home className="size-5 shrink-0 text-pink-500" fill="currentColor" />
        <span className="truncate">{title}</span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {count != null && (
          <span className="whitespace-nowrap rounded-full bg-neutral-900 px-2 py-1.5 text-body-sb font-semibold text-pink-500">
            {includeExcluded ? `총 ${totalList.length}곳` : excludedCount > 0
              ? `총 ${count - excludedCount}곳`
              : `총 ${count}곳`}
          </span>
        )}
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
