'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'

interface IncomingProposal {
  proposerName: string
}

// 세션 어느 화면에 있든(조율/결과 공통) 상대가 새 제안을 올리면 실시간으로
// 알려주는 전역 스낵바. Realtime으로 감지한다 — proposals 테이블은 이미
// supabase_realtime publication에 등록돼 있다 (schema 참고).
export function ProposalSnackbar({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [incoming, setIncoming] = useState<IncomingProposal | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let myParticipantId: string | null = null
    let cancelled = false

    ;(async () => {
      const me = await getMyParticipant(supabase, sessionId)
      if (!me) return
      myParticipantId = me.id

      await ensureRealtimeAuth(supabase)
      if (cancelled) return

      const channel = supabase
        .channel(`proposals:${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'proposals',
            filter: `session_id=eq.${sessionId}`,
          },
          async (payload) => {
            const proposerId = payload.new.proposer_id as string
            if (!myParticipantId || proposerId === myParticipantId) return

            const { data: proposer } = await supabase
              .from('participants')
              .select('display_name, role')
              .eq('id', proposerId)
              .single()

            setIncoming({ proposerName: proposer?.display_name || proposer?.role || '상대방' })
          }
        )
        .subscribe()

      channelRef.current = channel
    })()

    return () => {
      cancelled = true
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [sessionId])

  if (!incoming) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(16px,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <div className="animate-in fade-in-0 slide-in-from-top-2 pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full bg-neutral-900 py-2 pr-2 pl-5 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
        <p className="flex-1 truncate text-body-sb font-semibold text-white">
          <span className="text-pink-400">{incoming.proposerName}</span>님으로부터 제안이 왔어요
        </p>
        <button
          onClick={() => {
            setIncoming(null)
            router.push(`/s/${sessionId}/adjust`)
          }}
          className="shrink-0 rounded-full bg-white px-4 py-2 text-caption-l font-bold text-neutral-900"
        >
          이동
        </button>
        <button
          onClick={() => setIncoming(null)}
          aria-label="닫기"
          className="shrink-0 text-neutral-400 hover:text-neutral-200"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
