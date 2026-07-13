'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { Button } from '@/components/ui/button'
import { FeedbackBanner } from '@/components/feedback-banner'

type Tier = 'must' | 'nice' | 'skip'
const CODES = ['area_size', 'build_year', 'infra'] as const
const TIER_LABEL: Record<Tier, string> = { must: '필수', nice: '선호', skip: '무관' }

interface ParticipantSummary {
  role: 'A' | 'B'
  display_name: string | null
  budget_max_krw: number | null
  commute_max_min: number | null
  conditions: Record<string, Tier>
}

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
  match_count: number
  matches: MatchArea[]
}

export default function DecidedPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const sessionId = params.id

  const [participants, setParticipants] = useState<ParticipantSummary[] | null>(null)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: sessionRow } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single()

      if (sessionRow?.status !== 'resolved') {
        router.replace(`/s/${sessionId}/adjust`)
        return
      }

      const { data: rows, error: pErr } = await supabase
        .from('participants')
        .select('role, display_name, budget_max_krw, commute_max_min, id')
        .eq('session_id', sessionId)
        .order('role')
      if (pErr || !rows) {
        setError(pErr?.message ?? '참여자 정보를 불러오지 못했어요')
        setLoading(false)
        return
      }

      const summaries: ParticipantSummary[] = []
      for (const row of rows) {
        const { data: conds } = await supabase
          .from('participant_conditions')
          .select('condition_code, tier')
          .eq('participant_id', row.id)
        const conditions: Record<string, Tier> = {}
        for (const c of conds ?? []) conditions[c.condition_code] = c.tier as Tier
        summaries.push({
          role: row.role,
          display_name: row.display_name,
          budget_max_krw: row.budget_max_krw,
          commute_max_min: row.commute_max_min,
          conditions,
        })
      }
      setParticipants(summaries)

      const { data: matchData, error: matchError } = await supabase.rpc('get_matches', {
        sid: sessionId,
      })
      if (!matchError) setResult(matchData as MatchResult)

      setLoading(false)
    })()
  }, [sessionId, router])

  async function handleShare() {
    if (!result || sharing) return
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

  async function handleReopen() {
    if (reopening) return
    setReopening(true)
    try {
      const supabase = createClient()
      const { error: reopenError } = await supabase.rpc('reopen_session', {
        sid: sessionId,
      })
      if (reopenError) throw reopenError
      router.push(`/s/${sessionId}/adjust`)
    } catch (e) {
      setShareError(e instanceof Error ? e.message : '다시 조율하기에 실패했어요')
      setReopening(false)
    }
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-neutral-500">불러오는 중...</p>
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

  if (!participants) return null

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-[13px] text-neutral-500">결정 완료</p>
        <p className="mb-1 text-xl font-semibold text-neutral-900">
          두 분의 조건으로 결정했어요
        </p>
        <p className="mb-4 text-[13px] text-neutral-500">
          아래 조건을 기준으로 계산된 결과예요
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          {participants.map((p) => (
            <div key={p.role} className="rounded-xl border border-neutral-200 px-3 py-3">
              <p
                className={`mb-2 text-sm font-medium ${
                  p.role === 'A' ? 'text-primary-700' : 'text-blue-700'
                }`}
              >
                {p.display_name ?? p.role} ({p.role})
              </p>
              <dl className="flex flex-col gap-1 text-[12px] text-neutral-600">
                <div className="flex justify-between">
                  <dt>예산</dt>
                  <dd className="font-medium text-neutral-800">
                    {formatEok(p.budget_max_krw)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>통근 상한</dt>
                  <dd className="font-medium text-neutral-800">
                    {p.commute_max_min}분
                  </dd>
                </div>
                {CODES.map((code) => (
                  <div key={code} className="flex justify-between">
                    <dt>{CONDITION_LABEL[code]}</dt>
                    <dd className="font-medium text-neutral-800">
                      {p.conditions[code] ? TIER_LABEL[p.conditions[code]] : '-'}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <p className="mb-3 text-sm font-medium text-neutral-900">
          최종 후보 {result?.match_count ?? 0}곳
        </p>
        <div className="flex flex-col gap-2">
          {result?.matches.map((m) => (
            <div
              key={m.code}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-sm font-medium text-neutral-900">
                  {m.sigungu} {m.name}
                </span>
                <span className="text-sm font-medium text-neutral-700">
                  {formatEok(m.avg_price_krw)}
                </span>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-primary-600">A {m.a_minutes}분</span>
                <span className="text-blue-600">B {m.b_minutes}분</span>
              </div>
            </div>
          ))}
          {(!result || result.match_count === 0) && (
            <p className="py-4 text-center text-sm text-neutral-400">
              이 조건을 만족하는 구역이 없어요
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <Button
            onClick={handleReopen}
            disabled={reopening}
            variant="outline"
            className="flex-1"
          >
            다시 조율하기
          </Button>
          <Button onClick={handleShare} disabled={sharing} variant="outline" className="flex-1">
            공유하기
          </Button>
        </div>

        {shareUrl && (
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            />
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(shareUrl)}>
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
