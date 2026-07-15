'use client'

import { useRouter } from 'next/navigation'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'

interface DecisionResultSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  kind: 'accepted' | 'rejected'
}

const COPY = {
  accepted: {
    title: '제안을 수락했어요',
    description: '두 분의 조건이 반영된 새 결과를 확인해보세요',
  },
  rejected: {
    title: '제안을 거절했어요',
    description: '기존 조건 그대로 결과를 보여드릴게요',
  },
} as const

// No/Yesss! 결정 직후 뜨는 안내 시트 — 결과 화면으로 넘어가는 유일한 통로다.
export function DecisionResultSheet({
  open,
  onOpenChange,
  sessionId,
  kind,
}: DecisionResultSheetProps) {
  const router = useRouter()
  const copy = COPY[kind]

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
      <DrawerContent>
        <div className="flex flex-col items-center gap-2 px-6 pt-4 pb-2 text-center">
          <DrawerTitle className="text-title-sb font-bold text-neutral-900">
            {copy.title}
          </DrawerTitle>
          <DrawerDescription className="text-body-m text-neutral-500">
            {copy.description}
          </DrawerDescription>
        </div>
        <div className="px-6 pt-4 pb-10">
          <Button
            onClick={() => router.push(`/s/${sessionId}/result?notice=updated`)}
            className="w-full font-montserrat text-mont-title-m"
          >
            결과 보기
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
