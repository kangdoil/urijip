'use client'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Chip } from '@/components/ui/chip'

interface SigunguFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sigungus: string[]
  active: string | null
  onSelect: (sigungu: string) => void
}

// "N개 시군구" 칩을 누르면 뜨는 전체 목록 필터 시트. 시트 안 칩은 anchor
// 페이지의 카테고리 칩과 같은 Chip 컴포넌트를 그대로 쓴다.
export function SigunguFilterSheet({
  open,
  onOpenChange,
  sigungus,
  active,
  onSelect,
}: SigunguFilterSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>시군구 선택</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-wrap gap-2 px-4 pb-8">
          {sigungus.map((sigungu) => (
            <Chip
              key={sigungu}
              selected={sigungu === active}
              onClick={() => {
                onSelect(sigungu)
                onOpenChange(false)
              }}
            >
              {sigungu}
            </Chip>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
