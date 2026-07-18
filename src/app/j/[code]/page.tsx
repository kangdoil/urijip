import type { Metadata } from 'next'
import { getInvitePreview } from '@/lib/invite-preview'
import { JoinForm } from '@/components/join-form'

type Props = {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'
  const title = `${inviterName}님이 우리집 찾기에 초대했어요`

  return {
    title,
    description: '우리집 — 두 사람이 주거 조건을 조율해 함께 살 동네를 찾아요',
    openGraph: {
      title,
      description: '함께 조건을 입력하고 둘 다 만족하는 동네를 찾아보세요',
    },
  }
}

export default async function InvitePage({ params }: Props) {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'

  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-6">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
              &ldquo;{inviterName}&rdquo;님이 우리 집에 초대했어요
            </h1>
            <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
              지금 바로 내 조건을 입력하고
              <br />
              {inviterName}님과 함께 조율해 보세요
            </p>
          </div>

          <JoinForm code={code} />
        </div>
      </div>
    </main>
  )
}
