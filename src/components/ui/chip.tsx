import * as React from "react"

import { cn } from "@/lib/utils"

function Chip({
  className,
  selected = false,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      data-slot="chip"
      data-selected={selected}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
        selected ? "bg-neutral-900 text-neutral-0" : "bg-neutral-50 text-neutral-600",
        className
      )}
      {...props}
    />
  )
}

export { Chip }
