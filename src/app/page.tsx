'use client'

import { Suspense, useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ensureAnonSession } from '@/lib/supabase/ensure-anon'
import { useProfileStore } from '@/store/use-profile-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { track } from '@/lib/mixpanel'

export default function HomePage() {
  // useSearchParams는 Suspense 경계 안에서만 정적 렌더링과 함께 쓸 수 있다.
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  )
}

function HomePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { displayName, setDisplayName } = useProfileStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateSession() {
    if (!displayName.trim()) {
      setError('이름을 입력해주세요')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const session = await ensureAnonSession(supabase)
      if (!session) throw new Error('익명 로그인에 실패했어요')

      const { data, error: rpcError } = await supabase.rpc('create_session', {
        name: displayName.trim(),
      })
      if (rpcError) throw rpcError

      // 결과 화면 공유 카드의 "나도 시작하기" 링크만 ?source=share_link를 붙인다
      // (invite_code를 통한 배우자 초대 플로우와는 무관한, 앱 자체의 획득 루프).
      track(
        'session_created',
        { session_id: data.id, role: 'A' },
        { source: searchParams.get('source') === 'share_link' ? 'share_link' : 'organic' }
      )

      router.push(`/s/${data.id}/onboard/anchor`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션 생성에 실패했어요')
      setLoading(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-50 px-4 py-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-3xl bg-white p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/urijip_logo.png" alt="우리집" width={184} height={184} priority />
          <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
            둘이서 주거 조건을 조율해
            <br />
            함께 살 구역을 찾아요
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="display-nickname">닉네임</Label>
          <Input
            id="display-nickname"
            placeholder="닉네임을 입력해주세요."
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          onClick={handleCreateSession}
          disabled={loading}
          className="w-full font-montserrat text-mont-title-m"
        >
          {loading ? '만드는 중...' : 'Start! (with A)'}
        </Button>
      </div>
    </main>
  )
}
