'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface SessionRow {
  id: string
  invite_code: string
  status: string
}

interface MyParticipant {
  role: 'A' | 'B'
  display_name: string | null
}

interface Presence {
  participant_count: number
  roles: ('A' | 'B')[]
}

const ROLE_STYLE: Record<'A' | 'B', string> = {
  A: 'bg-violet-100 text-violet-700 border-violet-300',
  B: 'bg-teal-100 text-teal-700 border-teal-300',
}

export default function SessionPage() {
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [session, setSession] = useState<SessionRow | null>(null)
  const [me, setMe] = useState<MyParticipant | null>(null)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [bothReady, setBothReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')

  const refresh = useCallback(async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return

    const { data: sessionRow, error: sessionError } = await supabase
      .from('sessions')
      .select('id, invite_code, status')
      .eq('id', sessionId)
      .single()
    if (sessionError) {
      setError('세션을 찾을 수 없어요')
      return
    }
    setSession(sessionRow)
    setInviteUrl(`${window.location.origin}/j/${sessionRow.invite_code}`)

    const { data: myRow } = await supabase
      .from('participants')
      .select('role, display_name')
      .eq('session_id', sessionId)
      .eq('user_id', userData.user.id)
      .single()
    setMe(myRow ?? null)

    const { data: presenceData, error: presenceError } = await supabase.rpc(
      'get_session_presence',
      { sid: sessionId }
    )
    if (!presenceError) setPresence(presenceData as Presence)

    const { data: readyData } = await supabase.rpc('session_is_ready', {
      sid: sessionId,
    })
    setBothReady(Boolean(readyData))
  }, [sessionId])

  useEffect(() => {
    refresh()
    const interval = setInterval(() => {
      setPresence((prev) => {
        if (prev && prev.participant_count >= 2) return prev
        refresh()
        return prev
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md border-violet-200">
        <CardHeader>
          <CardTitle className="text-violet-700">세션 대기실</CardTitle>
          <CardDescription>
            {me?.display_name ? `${me.display_name}님, 반가워요.` : '불러오는 중...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">참여자</span>
            {presence?.roles.map((role) => (
              <Badge key={role} variant="outline" className={ROLE_STYLE[role]}>
                {role}
              </Badge>
            ))}
            <span className="text-sm text-zinc-500">
              {presence ? `${presence.participant_count}/2` : '...'}
            </span>
          </div>

          {bothReady ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-teal-700">
                두 분 모두 조건 입력을 마쳤어요!
              </p>
              <Button asChild>
                <Link href={`/s/${sessionId}/result`}>결과 보기 →</Link>
              </Button>
            </div>
          ) : presence && presence.participant_count >= 2 ? (
            <p className="text-sm font-medium text-neutral-600">
              배우자가 참여했어요. 조건 입력이 끝나면 결과를 보여드릴게요.
            </p>
          ) : me?.role === 'A' ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-500">
                배우자에게 이 링크를 보내주세요
              </span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(inviteUrl)}
                >
                  복사
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">배우자의 참여를 기다리는 중...</p>
          )}

          <Button variant="ghost" onClick={refresh} className="self-start">
            새로고침
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
