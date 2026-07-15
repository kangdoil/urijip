'use client'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Chip } from '@/components/ui/chip'

export type AreaVisibility = 'all' | 'selected' | 'excluded'

interface SelectedAreaFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: Set<AreaVisibility>
  onToggle: (value: AreaVisibility) => void
}

const OPTIONS: { value: AreaVisibility; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'selected', label: '선택된 구역만' },
  { value: 'excluded', label: '제외된 구역만' },
]

// "선택된 구역만" 트리거를 누르면 뜨는 필터 시트. 카드의 X 버튼으로 제외한
// 구역을 기준으로 전체/선택된 구역만/제외된 구역만을 중복 선택 가능하게
// 보여준다 (요청사항).
export function SelectedAreaFilterSheet({
  open,
  onOpenChange,
  selected,
  onToggle,
}: SelectedAreaFilterSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>구역 필터</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-wrap gap-2 px-4 pb-8">
          {OPTIONS.map(({ value, label }) => (
            <Chip key={value} selected={selected.has(value)} onClick={() => onToggle(value)}>
              {label}
            </Chip>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
