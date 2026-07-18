'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ensureAnonSession } from '@/lib/supabase/ensure-anon'
import { useProfileStore } from '@/store/use-profile-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { track } from '@/lib/mixpanel'

export function JoinForm({ code }: { code: string }) {
  const router = useRouter()
  const { displayName, setDisplayName } = useProfileStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // get_invite_preview는 실제 sessions.id를 안 돌려줘서(RLS상 비참여자에게
    // 굳이 노출할 필요가 없음) session_id는 아직 모른다 — invite_code로만 식별한다.
    track('invite_opened', { session_id: null, role: '미참여' }, { invite_code: code })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleJoin() {
    if (!displayName.trim()) {
      setError('이름을 입력해주세요')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      await ensureAnonSession(supabase)

      const { data: sessionId, error: joinError } = await supabase.rpc(
        'join_session',
        { code, name: displayName.trim() }
      )
      if (joinError) throw joinError

      track('b_started', { session_id: sessionId, role: 'B' }, {})

      router.push(`/s/${sessionId}/onboard/anchor`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '참여에 실패했어요')
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex w-full flex-col items-center gap-6 rounded-3xl bg-pink-100 p-8 shadow-[0_0_17px_rgba(15,23,42,0.08)]">
        <Image src="/urijip_logo.png" alt="우리집" width={184} height={184} priority />
        <p className="text-center text-base leading-[1.4] font-semibold tracking-[-0.015em] text-pink-500">
          둘이서 주거 조건을 조율해
          <br />
          함께 살 동네를 찾아요
        </p>
        <div className="h-px w-full bg-pink-200" />
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="닉네임을 입력해주세요."
          aria-label="닉네임"
        />
      </div>

      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-sm px-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <Button
          onClick={handleJoin}
          disabled={loading}
          className="w-full font-montserrat text-mont-title-m"
        >
          {loading ? '참여하는 중...' : 'Start! (with B)'}
        </Button>
      </div>
    </>
  )
}
