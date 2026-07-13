'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { Button } from '@/components/ui/button'
import { FeedbackBanner } from '@/components/feedback-banner'
import { GroupedAreaList } from '@/components/grouped-area-list'
import { useCommuteStatus } from '@/lib/use-commute-status'

interface MatchArea {
  code: string
  name: string
  sigungu: string
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  satisfied: Record<string, boolean>
}

interface MatchResult {
  ready: boolean
  must_conditions: string[]
  budget: {
    a_budget_krw: number | null
    b_budget_krw: number | null
    applied_krw: number | null
    conflict: boolean
  }
  candidate_count: number
  match_count: number
  matches: MatchArea[]
}

interface FallbackArea {
  code: string
  name: string
  sigungu: string
}

interface FallbackResult {
  a_only: FallbackArea[]
  b_only: FallbackArea[]
}

export default function ResultPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const sessionId = params.id

  const [result, setResult] = useState<MatchResult | null>(null)
  const [fallback, setFallback] = useState<FallbackResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const { ready: commuteReady, status: commuteStatus } = useCommuteStatus(sessionId)

  useEffect(() => {
    if (!commuteReady) return

    const supabase = createClient()
    ;(async () => {
      const { data: sessionRow } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single()
      if (sessionRow?.status === 'resolved') {
        router.replace(`/s/${sessionId}/decided`)
        return
      }

      const { data, error: rpcError } = await supabase.rpc('get_matches', {
        sid: sessionId,
      })
      if (rpcError) {
        setError(rpcError.message)
        setLoading(false)
        return
      }
      setResult(data as MatchResult)

      if ((data as MatchResult).match_count === 0) {
        const { data: fb } = await supabase.rpc('get_fallback_matches', {
          sid: sessionId,
        })
        setFallback(fb as FallbackResult)
      }
      setLoading(false)
    })()
  }, [sessionId, router, commuteReady])

  async function handleShare() {
    if (!result || result.match_count === 0 || sharing) return
    setSharing(true)
    setShareError(null)
    try {
      const supabase = createClient()
      const me = await getMyParticipant(supabase, sessionId)
      if (!me) throw new Error('참여자 정보를 찾을 수 없어요')

      const { data: existing } = await supabase
        .from('result_shares')
        .select('share_slug')
        .eq('session_id', sessionId)
        .eq('created_by', me.id)
        .order('created_at', { ascending: false })
        .limit(1)

      let slug = existing?.[0]?.share_slug
      if (!slug) {
        const { data: created, error: insertError } = await supabase
          .from('result_shares')
          .insert({
            session_id: sessionId,
            created_by: me.id,
            area_codes: result.matches.slice(0, 5).map((m) => m.code),
          })
          .select('share_slug')
          .single()
        if (insertError) throw insertError
        slug = created.share_slug
      }

      setShareUrl(`${window.location.origin}/share/${slug}`)
    } catch (e) {
      setShareError(e instanceof Error ? e.message : '공유 링크 생성에 실패했어요')
    } finally {
      setSharing(false)
    }
  }

  if (!commuteReady) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <p className="mb-2 text-lg font-medium text-neutral-900">
            통근시간을 계산하고 있어요
          </p>
          <p className="text-[13px] text-neutral-500">
            {commuteStatus && !commuteStatus.aReady && !commuteStatus.bReady
              ? '두 분 거점 기준으로 전 구역 통근시간을 처음 계산하는 중이에요'
              : '상대방 거점 기준 계산이 아직 끝나지 않았어요'}
            {' · '}
            보통 몇 분 안에 끝나요, 잠시만 기다려주세요
          </p>
        </div>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-neutral-500">결과를 불러오는 중...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  if (!result) return null

  const sigunguCount = new Set(result.matches.map((m) => m.sigungu)).size

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-[13px] text-neutral-500">결과</p>
        <p className="mb-1 text-xl font-semibold text-neutral-900">
          {result.match_count > 0
            ? `함께 갈 수 있는 구역, ${sigunguCount}개 시군구에 걸쳐 있어요`
            : '필수 조건을 모두 만족하는 구역이 없어요'}
        </p>
        <p className="mb-4 text-[13px] text-neutral-500">
          {result.must_conditions.length > 0
            ? `${result.must_conditions.map((c) => CONDITION_LABEL[c] ?? c).join(', ')} 필수 조건과 통근·예산 상한 기준`
            : '통근·예산 상한 기준'}
        </p>

        {result.budget.conflict && (
          <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-[13px] text-primary-700">
            예산 상한이 서로 달라요 · 낮은 쪽({formatEok(result.budget.applied_krw)})을
            기본으로 적용했어요
          </div>
        )}

        {result.match_count > 0 ? (
          <GroupedAreaList areas={result.matches} showConditionBadges />
        ) : (
          fallback && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-neutral-500">
                대신, 한쪽 필수 조건만 반영했을 때의 후보를 보여드릴게요
              </p>
              <div>
                <p className="mb-2 text-sm font-medium text-primary-700">
                  A의 필수만 반영 ({fallback.a_only.length}곳)
                </p>
                <div className="flex flex-col gap-1.5">
                  {fallback.a_only.map((a) => (
                    <div
                      key={a.code}
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                    >
                      {a.sigungu} {a.name}
                    </div>
                  ))}
                  {fallback.a_only.length === 0 && (
                    <p className="text-xs text-neutral-400">후보가 없어요</p>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-blue-700">
                  B의 필수만 반영 ({fallback.b_only.length}곳)
                </p>
                <div className="flex flex-col gap-1.5">
                  {fallback.b_only.map((a) => (
                    <div
                      key={a.code}
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                    >
                      {a.sigungu} {a.name}
                    </div>
                  ))}
                  {fallback.b_only.length === 0 && (
                    <p className="text-xs text-neutral-400">후보가 없어요</p>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        <div className="mt-5 flex gap-2">
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/s/${sessionId}/adjust`}>다시 조율하기</Link>
          </Button>
          {result.match_count > 0 && (
            <Button
              onClick={handleShare}
              disabled={sharing}
              variant="outline"
              className="flex-1"
            >
              공유하기
            </Button>
          )}
        </div>

        {shareUrl && (
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            />
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              복사
            </Button>
          </div>
        )}

        {shareError && <p className="mt-3 text-sm text-red-600">{shareError}</p>}
      </div>
      <FeedbackBanner sessionId={sessionId} />
    </main>
  )
}
