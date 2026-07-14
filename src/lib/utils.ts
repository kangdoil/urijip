import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// 기본 tailwind-merge는 text-{size}를 xs/sm/base/lg 같은 티셔츠 사이즈로만 인식한다.
// globals.css의 커스텀 타이포그래피 토큰(text-title-m 등)은 이 목록에 없으면
// text-color 유틸(text-neutral-0 등)과 같은 그룹으로 오인돼 서로를 지워버린다.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "headline-l",
        "headline-m",
        "title-l",
        "title-m",
        "title-sb",
        "body-l",
        "body-m",
        "body-sb",
        "body-s",
        "caption-l",
        "caption-m",
        "mont-headline-l",
        "mont-headline-m",
        "mont-title-l",
        "mont-title-m",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
