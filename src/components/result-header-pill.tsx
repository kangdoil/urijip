import { cn } from '@/lib/utils'

export function ResultHeaderPill({
  title,
  count,
  partnerConfirmed,
}: {
  title: string
  count?: number
  // undefined면 배지를 아예 숨긴다 (예: 매칭 0건 폴백 상태)
  partnerConfirmed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white bg-neutral-50/50 px-5 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.04)] backdrop-blur-[10px]">
      <p className="text-lg font-semibold tracking-[-0.03em] text-neutral-900">{title}</p>
      <div className="flex shrink-0 items-center gap-1">
        {count != null && (
          <span className="whitespace-nowrap rounded-full bg-neutral-900 px-4 py-2 text-body-sb font-semibold text-pink-500">
            총 {count}곳
          </span>
        )}
        {partnerConfirmed != null && (
          <span
            className={cn(
              'flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-2 text-body-sb font-bold text-pink-500 shadow-[0_10px_20px_rgba(0,0,0,0.04)]',
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
