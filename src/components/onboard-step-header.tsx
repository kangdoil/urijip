export function OnboardStepHeader({
  step,
  total,
  label,
}: {
  step: number
  total: number
  label: string
}) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-neutral-500">{label}</span>
        <span className="text-[13px] font-semibold text-neutral-600">
          {step} / {total}
        </span>
      </div>
      <div className="h-1 rounded-full bg-neutral-200">
        <div
          className="h-1 rounded-full bg-primary-500 transition-all duration-200"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  )
}
