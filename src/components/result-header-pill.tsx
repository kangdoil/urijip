export function ResultHeaderPill({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white bg-neutral-50/50 px-5 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.04)] backdrop-blur-[10px]">
      <p className="text-lg font-semibold tracking-[-0.03em] text-neutral-900">{title}</p>
      {count != null && (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-pink-500">
          총 {count}곳
        </span>
      )}
    </div>
  )
}
