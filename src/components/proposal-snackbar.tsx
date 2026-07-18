'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'

type Notice =
  | { kind: 'new_proposal'; proposerName: string }
  | { kind: 'decision'; accepted: boolean }

// 세션 어느 화면에 있든(조율/결과 공통) 상대가 새 제안을 올리거나 내가 보낸
// 제안을 수락/거절하면 실시간으로 알려주는 전역 스낵바. Realtime으로 감지한다
// — proposals 테이블은 이미 supabase_realtime publication에 등록돼 있다
// (schema 참고).
export function ProposalSnackbar({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  const [notice, setNotice] = useState<Notice | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

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

            setNotice({
              kind: 'new_proposal',
              proposerName: proposer?.display_name || proposer?.role || '상대방',
            })
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'proposals',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const row = payload.new as { proposer_id: string; status: string }
            if (!myParticipantId || row.proposer_id !== myParticipantId) return
            if (row.status !== 'accepted' && row.status !== 'rejected') return

            // 조율 페이지의 "제안 완료" 대기 뷰에 있을 땐 그 화면 자체가 이
            // 결과를 기다리는 중이라 토스트 없이 바로 넘긴다. 다른 화면에
            // 있을 땐 하던 걸 방해하지 않도록 토스트로만 알리고 선택하게 한다.
            if (pathnameRef.current === `/s/${sessionId}/adjust`) {
              router.push(`/s/${sessionId}/result?notice=${row.status}`)
              return
            }
            setNotice({ kind: 'decision', accepted: row.status === 'accepted' })
          }
        )
        .subscribe()

      channelRef.current = channel
    })()

    return () => {
      cancelled = true
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [sessionId, router])

  if (!notice) return null

  const label =
    notice.kind === 'new_proposal' ? (
      <>
        <span className="text-pink-400">{notice.proposerName}</span>님으로부터 제안이 왔어요
      </>
    ) : notice.accepted ? (
      '상대방이 조율을 수락했어요'
    ) : (
      '상대방이 조율을 거절했어요'
    )

  const ctaLabel = notice.kind === 'new_proposal' ? '이동' : '결과 보기'
  const ctaHref =
    notice.kind === 'new_proposal'
      ? `/s/${sessionId}/adjust`
      : `/s/${sessionId}/result?notice=${notice.accepted ? 'accepted' : 'rejected'}`

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(16px,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <div className="animate-in fade-in-0 slide-in-from-top-2 pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full bg-neutral-900 py-2 pr-2 pl-5 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
        <p className="flex-1 truncate text-body-sb font-semibold text-white">{label}</p>
        <button
          onClick={() => {
            setNotice(null)
            router.push(ctaHref)
          }}
          className="shrink-0 rounded-full bg-white px-4 py-2 text-caption-l font-bold text-neutral-900"
        >
          {ctaLabel}
        </button>
        <button
          onClick={() => setNotice(null)}
          aria-label="닫기"
          className="shrink-0 text-neutral-400 hover:text-neutral-200"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
