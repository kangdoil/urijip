'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ensureAnonSession } from '@/lib/supabase/ensure-anon'
import { useProfileStore } from '@/store/use-profile-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

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
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm border-violet-200">
        <CardHeader>
          <CardTitle className="text-violet-700">우리집</CardTitle>
          <CardDescription>
            신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾아요
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
          <Button onClick={handleCreateSession} disabled={loading}>
            {loading ? '만드는 중...' : '세션 만들기 (A로 시작)'}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
