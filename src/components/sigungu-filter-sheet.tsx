'use client'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Chip } from '@/components/ui/chip'

interface SigunguFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sigungus: string[]
  selected: Set<string>
  onToggle: (sigungu: string) => void
  onToggleAll: () => void
}

// "경기도 광주 외 N" 트리거를 누르면 뜨는 시군구 다중 선택 시트. 시트 안 칩은
// anchor 페이지의 카테고리 칩과 같은 Chip 컴포넌트를 그대로 쓴다. 중복 선택이
// 가능해서(요청사항) 칩을 눌러도 시트를 닫지 않는다 — 핸들 드래그나 바깥
// 탭으로 닫는다.
export function SigunguFilterSheet({
  open,
  onOpenChange,
  sigungus,
  selected,
  onToggle,
  onToggleAll,
}: SigunguFilterSheetProps) {
  const allSelected = sigungus.length > 0 && sigungus.every((s) => selected.has(s))

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>시군구 선택</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {sigungus.map((sigungu) => (
            <Chip key={sigungu} selected={selected.has(sigungu)} onClick={() => onToggle(sigungu)}>
              {sigungu}
            </Chip>
          ))}
        </div>
        <div className="px-4 pb-8">
          <button
            type="button"
            onClick={onToggleAll}
            className="w-full py-2 text-center text-body-sb font-medium text-neutral-500 underline decoration-1 underline-offset-4"
          >
            {allSelected ? '모두 선택 취소' : '모두 선택'}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
