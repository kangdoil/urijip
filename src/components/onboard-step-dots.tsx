export function OnboardStepDots({ total, activeIndex }: { total: number; activeIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-10 rounded-full ${
            i === activeIndex ? 'bg-pink-500 shadow-sm' : 'bg-pink-200'
          }`}
        />
      ))}
    </div>
  )
}
