import { ChevronLeft } from 'lucide-react'

export function OnboardBackBar({
  onBack,
  disabled = false,
}: {
  onBack: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex h-[54px] items-center">
      <button
        onClick={onBack}
        disabled={disabled}
        aria-label="이전으로"
        className="flex size-9 items-center justify-center rounded-full text-neutral-900 transition-opacity disabled:opacity-0"
      >
        <ChevronLeft className="size-6" />
      </button>
    </div>
  )
}
