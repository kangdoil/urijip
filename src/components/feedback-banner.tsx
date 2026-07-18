'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { Button } from '@/components/ui/button'
import { track, type Role } from '@/lib/mixpanel'

const DWELL_MS = 4000

type Stage = 'hidden' | 'prompt' | 'comment' | 'done'

export function FeedbackBanner({ sessionId }: { sessionId: string }) {
  const [stage, setStage] = useState<Stage>('hidden')
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 배너가 '왜' 떴는지(이미 조율 종료됐거나 vs 4초 체류) — feedback_submitted의
  // trigger 프로퍼티로 같이 보낸다. state가 아니라 ref인 이유는 리렌더를 유발할
  // 필요 없이 다음 제출 시점에만 읽으면 되기 때문.
  const triggerRef = useRef<'resolved' | 'dwell'>('dwell')

  useEffect(() => {
    const dismissedKey = `urijib-feedback-dismissed-${sessionId}`
    if (sessionStorage.getItem(dismissedKey)) return

    let cancelled = false
    const supabase = createClient()

    ;(async () => {
      const me = await getMyParticipant(supabase, sessionId)
      if (!me || cancelled) return

      const { data: existing } = await supabase
        .from('feedback')
        .select('id')
        .eq('participant_id', me.id)
        .maybeSingle()
      if (existing || cancelled) return

      setParticipantId(me.id)
      setRole(me.role)

      const { data: sessionRow } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single()

      if (cancelled) return
      if (sessionRow?.status === 'resolved') {
        triggerRef.current = 'resolved'
        setStage('prompt')
      } else {
        setTimeout(() => {
          if (!cancelled) {
            triggerRef.current = 'dwell'
            setStage('prompt')
          }
        }, DWELL_MS)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  function dismiss() {
    sessionStorage.setItem(`urijib-feedback-dismissed-${sessionId}`, '1')
    // comment 단계의 "건너뛰기"는 이미 react('down')에서 반응을 남긴 뒤라
    // 실질적인 제출 완료다 — prompt 단계에서 그냥 닫는 것과 구분한다.
    if (stage === 'comment' && role) {
      track(
        'feedback_submitted',
        { session_id: sessionId, role },
        { reaction: 'down', has_comment: false, trigger: triggerRef.current }
      )
    }
    setStage('hidden')
  }

  async function react(reaction: 'up' | 'down') {
    if (!participantId || submitting) return
    setSubmitting(true)
    try {
      const supabase = createClient()
      await supabase.from('feedback').insert({
        session_id: sessionId,
        participant_id: participantId,
        reaction,
      })
      if (reaction === 'down') {
        setStage('comment')
      } else {
        if (role) {
          track(
            'feedback_submitted',
            { session_id: sessionId, role },
            { reaction: 'up', has_comment: false, trigger: triggerRef.current }
          )
        }
        setStage('done')
        setTimeout(() => setStage('hidden'), 1800)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function sendComment() {
    if (!participantId || submitting) return
    setSubmitting(true)
    try {
      const supabase = createClient()
      const hasComment = Boolean(comment.trim())
      if (hasComment) {
        await supabase
          .from('feedback')
          .update({ comment: comment.trim() })
          .eq('participant_id', participantId)
      }
      if (role) {
        track(
          'feedback_submitted',
          { session_id: sessionId, role },
          { reaction: 'down', has_comment: hasComment, trigger: triggerRef.current }
        )
      }
      setStage('done')
      setTimeout(() => setStage('hidden'), 1800)
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'hidden') return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg">
        {stage === 'prompt' && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-800">
                이 결과가 도움이 됐나요?
              </p>
              <button
                onClick={dismiss}
                aria-label="닫기"
                className="text-neutral-400 hover:text-neutral-600"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => react('up')}
                disabled={submitting}
                variant="outline"
                className="flex-1 text-lg"
              >
                👍
              </Button>
              <Button
                onClick={() => react('down')}
                disabled={submitting}
                variant="outline"
                className="flex-1 text-lg"
              >
                👎
              </Button>
            </div>
          </>
        )}

        {stage === 'comment' && (
          <>
            <p className="mb-2 text-sm font-medium text-neutral-800">
              어떤 점이 아쉬웠는지 알려주실래요? (선택)
            </p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="mb-2 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
              placeholder="편하게 적어주세요"
            />
            <div className="flex gap-2">
              <Button onClick={sendComment} disabled={submitting} className="flex-1">
                보내기
              </Button>
              <Button onClick={dismiss} variant="ghost" className="flex-1">
                건너뛰기
              </Button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <p className="text-center text-sm text-neutral-600">
            소중한 의견 감사해요!
          </p>
        )}
      </div>
    </div>
  )
}
