'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ensureAnonSession } from '@/lib/supabase/ensure-anon'
import { useProfileStore } from '@/store/use-profile-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function JoinForm({ code }: { code: string }) {
  const router = useRouter()
  const { displayName, setDisplayName } = useProfileStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      router.push(`/s/${sessionId}/onboard/anchor`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '참여에 실패했어요')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="join-display-name">내 이름</Label>
        <Input
          id="join-display-name"
          placeholder="예: 도일"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleJoin} disabled={loading}>
        {loading ? '참여하는 중...' : '참여하기 (B로 시작)'}
      </Button>
    </div>
  )
}
