import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 border-transparent bg-clip-padding font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-primary/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:border-transparent disabled:bg-neutral-300 disabled:text-neutral-500 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-neutral-0 hover:bg-primary/90",
        outline:
          "border-primary bg-transparent text-primary hover:bg-primary/5",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "border-none bg-transparent px-0 py-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "px-10 py-5 text-body-m has-data-[icon=inline-end]:pr-8 has-data-[icon=inline-start]:pl-8",
        sm: "px-6 py-3 text-body-s has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "px-12 py-6 text-body-l has-data-[icon=inline-end]:pr-9 has-data-[icon=inline-start]:pl-9",
        icon: "size-[62px] p-0 [&_svg:not([class*='size-'])]:size-5",
        "icon-sm": "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
