'use client'

import { useRouter } from 'next/navigation'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'

interface DecisionResultSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
}

// 거절(No) 직후 뜨는 안내 시트 — 결과 화면으로 넘어가는 통로다. 수락(Yesss!)은
// 확인 없이 바로 결과 화면으로 이동하므로 이 시트를 거치지 않는다.
export function DecisionResultSheet({
  open,
  onOpenChange,
  sessionId,
}: DecisionResultSheetProps) {
  const router = useRouter()

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
      <DrawerContent>
        <div className="flex flex-col items-center gap-2 px-6 pt-4 pb-2 text-center">
          <DrawerTitle className="text-title-sb font-bold text-neutral-900">
            제안을 거절했어요
          </DrawerTitle>
          <DrawerDescription className="text-body-m text-neutral-500">
            기존 조건 그대로 결과를 보여드릴게요
          </DrawerDescription>
        </div>
        <div className="px-6 pt-4 pb-10">
          <Button
            onClick={() => router.push(`/s/${sessionId}/result`)}
            className="w-full font-montserrat text-mont-title-m"
          >
            결과 보기
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
