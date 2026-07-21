'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { cn } from '@/lib/utils'

// 초대장을 보낸 뒤 대기 화면 상단에 떠 있는 지역 확장 의견 수렴 배너
// (Figma: 지역 의견 메세지). area_suggestions 테이블에 저장만 하고
// 클라이언트가 되읽지는 않는다 — 운영자가 Supabase Studio에서 직접 확인해
// 지역 확장 우선순위를 판단하는 용도다.
export function RegionSuggestionBanner({
  sessionId,
  className,
}: {
  sessionId: string
  className?: string
}) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle')

  async function submit() {
    const message = value.trim()
    if (!message || status === 'saving') return

    setStatus('saving')
    try {
      const supabase = createClient()
      const me = await getMyParticipant(supabase, sessionId)
      if (!me) throw new Error('참여자 정보를 찾을 수 없어요')

      const { error } = await supabase
        .from('area_suggestions')
        .insert({ session_id: sessionId, participant_id: me.id, message })
      if (error) throw error

      setValue('')
      setStatus('sent')
      setTimeout(() => setStatus('idle'), 2400)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2400)
    }
  }

  return (
    <div className={cn('bg-pink-50 px-5 py-3', className)}>
      <p className="text-center text-[12px] leading-[1.4] font-medium tracking-[-0.04em] text-pink-400">
        ※ 우리집은 현재 경기도 지역만 추천하고 있어요
        <br />
        추가를 원하는 지역이 있으시다면 의견을 남겨주세요
      </p>
      <div className="mt-2 flex items-center gap-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="예: 서울 외곽"
          disabled={status === 'saving'}
          className="min-w-0 flex-1 rounded-full border border-neutral-300 bg-neutral-0 px-[25px] py-[13px] text-[12px] tracking-[-0.04em] text-neutral-900 placeholder:text-neutral-500 focus:ring-2 focus:ring-pink-200 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={status === 'saving'}
          className="shrink-0 text-[12px] font-medium tracking-[-0.03em] text-neutral-500 underline decoration-1 underline-offset-4 disabled:opacity-50"
        >
          {status === 'sent' ? '전달했어요' : status === 'error' ? '실패했어요' : '제안하기'}
        </button>
      </div>
    </div>
  )
}
