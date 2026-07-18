'use client'

import { FileText, Image as ImageIcon } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'

interface SaveOptionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // 시군구 수 × 3(시군구별 추천 동네 상한) 기준의 "곳" 수.
  count: number
  onSaveImage: () => void
  onSaveText: () => void
}

// Save 버튼을 누르면 뜨는 저장 방식 선택 시트 (이미지 / 텍스트).
export function SaveOptionsSheet({
  open,
  onOpenChange,
  count,
  onSaveImage,
  onSaveText,
}: SaveOptionsSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-body-m font-normal text-neutral-500">
            우리가 함께 할 수 있는 동네
          </DrawerTitle>
          <DrawerDescription className="text-title-sb font-bold text-neutral-900">
            총 <span className="font-montserrat text-mont-title-l text-pink-500">{count}</span>곳
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col px-8 pb-10">
          <button
            onClick={() => {
              onSaveImage()
              onOpenChange(false)
            }}
            className="flex items-center gap-4 border-b border-neutral-100 py-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-50">
              <ImageIcon className="size-5 text-pink-500" />
            </span>
            <span className="text-body-m font-medium text-neutral-900">이미지로 저장하기</span>
          </button>
          <button
            onClick={() => {
              onSaveText()
              onOpenChange(false)
            }}
            className="flex items-center gap-4 py-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-50">
              <FileText className="size-5 text-pink-500" />
            </span>
            <span className="text-body-m font-medium text-neutral-900">텍스트로 저장하기</span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
