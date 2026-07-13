import type { Metadata } from 'next'
import { getInvitePreview } from '@/lib/invite-preview'
import { JoinForm } from '@/components/join-form'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type Props = {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'
  const title = `${inviterName}님이 신혼집 찾기에 초대했어요`

  return {
    title,
    description: '우리집 — 신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾아요',
    openGraph: {
      title,
      description: '함께 조건을 입력하고 둘 다 만족하는 구역을 찾아보세요',
    },
  }
}

export default async function InvitePage({ params }: Props) {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm border-teal-200">
        <CardHeader>
          <CardTitle className="text-teal-700">
            {inviterName}님이 초대했어요
          </CardTitle>
          <CardDescription>
            내 조건은 상대가 입력을 마치기 전까지 공개되지 않아요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JoinForm code={code} />
        </CardContent>
      </Card>
    </main>
  )
}
