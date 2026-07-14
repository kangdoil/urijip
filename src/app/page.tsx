'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ensureAnonSession } from '@/lib/supabase/ensure-anon'
import { useProfileStore } from '@/store/use-profile-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function HomePage() {
  const router = useRouter()
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
          <Label htmlFor="display-name">내 이름</Label>
          <Input
            id="display-name"
            placeholder="예: 도일"
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
