'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok, type Tier } from '@/lib/condition-labels'
import { ResultMapSheet } from '@/components/result-map-sheet'
import { FeedbackBanner } from '@/components/feedback-banner'
import { useCommuteStatus } from '@/lib/use-commute-status'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { track } from '@/lib/mixpanel'

// 세션+역할 조합으로 "이 결과 화면을 처음 보는지"를 기기에 저장해 판단한다
// (서버엔 조회 이력을 남기지 않으므로 DB로 대체 불가 — result_viewed 고유 목적).
function markResultViewed(sessionId: string, role: 'A' | 'B'): boolean {
  if (typeof window === 'undefined') return true
  const key = `urijib:result_viewed:${sessionId}:${role}`
  const isFirst = !window.localStorage.getItem(key)
  window.localStorage.setItem(key, '1')
  return isFirst
}

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
  lat: number
  lng: number
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
  lat: number
  lng: number
}

interface FallbackResult {
  a_only: FallbackArea[]
  b_only: FallbackArea[]
}

// 시군구별 추천 동네 상한(grouped-area-list.tsx의 "상위 최대 3곳" 규칙과 동일) —
// "총 N곳" 헤더의 숫자를 시군구 수 × 3으로 계산하는 기준값이다.
const RECOMMENDED_PER_SIGUNGU = 3

function buildExportText(matches: MatchArea[], codes: string[]) {
  const selected = matches.filter((m) => codes.includes(m.code))
  const groups = groupBySigungu(selected)
  const count = groups.length * RECOMMENDED_PER_SIGUNGU
  const lines = [`우리가 함께 할 수 있는 동네 (총 ${count}곳)`, '']
  for (const { sigungu, list } of groups) {
    lines.push(`[${sigungu}]`)
    for (const m of list) {
      const satisfiedNames = Object.entries(m.satisfied)
        .filter(([, ok]) => ok)
        .map(([code]) => CONDITION_LABEL[code] ?? code)
      const satisfiedPart = satisfiedNames.length > 0 ? ` · ${satisfiedNames.join(', ')} 충족` : ''
      lines.push(`- ${m.name} (${formatEok(m.avg_price_krw)}) · A ${m.a_minutes}분 · B ${m.b_minutes}분${satisfiedPart}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

export default function ResultPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = params.id

  const [result, setResult] = useState<MatchResult | null>(null)
  const [fallback, setFallback] = useState<FallbackResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [resolved, setResolved] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [participants, setParticipants] = useState<ParticipantSummary[] | null>(null)

  const [myRole, setMyRole] = useState<'A' | 'B' | null>(null)
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null)
  const [partnerConfirmed, setPartnerConfirmed] = useState<boolean | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveSheetOpen, setSaveSheetOpen] = useState(false)
  const [savedCodes, setSavedCodes] = useState<string[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState(false)
  // 조율 화면에서 제안이 수락/거절돼 결과 화면으로 넘어온 직후 — 무슨 일이
  // 있었는지 토스트로 안내하고, 새로고침 시 다시 뜨지 않도록 쿼리를 정리한다.
  // accepted/rejected는 A·B 모두에게 동일하게 뜬다(제안자든 결정자든).
  const [notice, setNotice] = useState<'accepted' | 'rejected' | 'updated' | null>(() => {
    const value = searchParams.get('notice')
    return value === 'accepted' || value === 'rejected' || value === 'updated' ? value : null
  })
  const noticeTimerStarted = useRef(false)

  const exportRef = useRef<HTMLDivElement>(null)

  const { ready: commuteReady, status: commuteStatus } = useCommuteStatus(sessionId)

  // 데이터 로딩이 끝나 실제 화면이 뜬 뒤에야 카운트다운을 시작한다 — 로딩이
  // 2.5초보다 길면 토스트가 뜨기도 전에 사라지는 문제가 있었다.
  useEffect(() => {
    if (!notice || loading || noticeTimerStarted.current) return
    noticeTimerStarted.current = true
    router.replace(`/s/${sessionId}/result`)
    const timer = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(timer)
  }, [notice, loading, sessionId, router])

  useEffect(() => {
    if (!commuteReady) return

    const supabase = createClient()
    ;(async () => {
      const { data: sessionRow } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single()
      setResolved(sessionRow?.status === 'resolved')

      const me = await getMyParticipant(supabase, sessionId)
      setMyRole(me?.role ?? null)
      setMyParticipantId(me?.id ?? null)

      const { data, error: rpcError } = await supabase.rpc('get_matches', {
        sid: sessionId,
      })
      if (rpcError) {
        setError(rpcError.message)
        setLoading(false)
        return
      }
      setResult(data as MatchResult)

      if (me?.role) {
        track(
          'result_viewed',
          { session_id: sessionId, role: me.role },
          {
            is_first_view: markResultViewed(sessionId, me.role),
            candidate_count: (data as MatchResult).candidate_count,
            had_conflict: (data as MatchResult).budget.conflict,
          }
        )
      }

      if ((data as MatchResult).match_count === 0) {
        const { data: fb } = await supabase.rpc('get_fallback_matches', {
          sid: sessionId,
        })
        setFallback(fb as FallbackResult)
      }

      // "자세히 보기" 펼침용 — 어차피 가벼운 조회라 펼치기 전에 미리 받아둔다.
      const { data: rows } = await supabase
        .from('participants')
        .select('role, display_name, budget_max_krw, commute_max_min, id, confirmed_at')
        .eq('session_id', sessionId)
        .order('role')
      if (rows) {
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

        const partner = rows.find((r) => r.role !== me?.role)
        setPartnerConfirmed(partner ? partner.confirmed_at != null : null)
      }

      setLoading(false)
    })()
  }, [sessionId, router, commuteReady])

  // 상대가 Save(확정)하면 새로고침 없이도 상단 배지가 바뀌도록 주기적으로
  // 상대의 확정 여부만 가볍게 다시 조회한다.
  useEffect(() => {
    if (!commuteReady || !myRole) return
    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data: rows } = await supabase
        .from('participants')
        .select('role, confirmed_at')
        .eq('session_id', sessionId)
      const partner = rows?.find((r) => r.role !== myRole)
      if (partner) setPartnerConfirmed(partner.confirmed_at != null)
    }, 5000)
    return () => clearInterval(interval)
  }, [commuteReady, myRole, sessionId])

  async function handleRetry() {
    if (retrying) return
    if (myRole) {
      track('result_retry', { session_id: sessionId, role: myRole }, {})
    }
    setRetrying(true)
    try {
      if (resolved) {
        const supabase = createClient()
        const { error: reopenError } = await supabase.rpc('reopen_session', {
          sid: sessionId,
        })
        if (reopenError) throw reopenError
      }
      router.push(`/s/${sessionId}/adjust`)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '다시 조율하기에 실패했어요')
      setRetrying(false)
    }
  }

  async function handleSave(visibleAreaCodes: string[]) {
    if (saving) return
    setSaving(true)
    setActionError(null)
    try {
      const supabase = createClient()
      const me = await getMyParticipant(supabase, sessionId)
      if (!me) throw new Error('참여자 정보를 찾을 수 없어요')

      const { error: updateError } = await supabase
        .from('participants')
        .update({ confirmed_at: new Date().toISOString(), saved_area_codes: visibleAreaCodes })
        .eq('id', me.id)
      if (updateError) throw updateError

      // 원자적으로 "둘 다 확정됐는지" 응답해주는 RPC가 없어 update 직후 상대 행을
      // 다시 조회하는 best-effort 방식이다 — 두 사람이 수 초 이내 동시에 저장하면
      // 이 판단이 어긋날 수 있음(양쪽 다 false로 보일 수 있음)을 알고 쓴다.
      const { data: rows } = await supabase
        .from('participants')
        .select('role, confirmed_at')
        .eq('session_id', sessionId)
      const partnerRow = rows?.find((r) => r.role !== me.role)
      track(
        'result_saved',
        { session_id: sessionId, role: me.role },
        { is_joint_complete: Boolean(partnerRow?.confirmed_at) }
      )

      setSavedCodes(visibleAreaCodes)
      setSaveSheetOpen(true)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '저장에 실패했어요')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveImage() {
    if (!exportRef.current) return
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(exportRef.current, { pixelRatio: 2, backgroundColor: '#ffffff' })
      const link = document.createElement('a')
      link.download = '우리집-추천동네.png'
      link.href = dataUrl
      link.click()
    } catch {
      setActionError('이미지 저장에 실패했어요')
    }
  }

  function handleSaveText() {
    if (!result) return
    const text = buildExportText(result.matches, savedCodes)
    try {
      navigator.clipboard.writeText(text)?.catch(() => {})
    } catch {
      // ignore
    }
    setCopiedText(true)
    setTimeout(() => setCopiedText(false), 1800)
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

  const budgetLabel = `예산 ${formatEok(result.budget.applied_krw)} 이하`

  return (
    <main className="flex-1">
      <ResultMapSheet
        sessionId={sessionId}
        myParticipantId={myParticipantId}
        areas={result.matches}
        matchCount={result.match_count}
        fallback={fallback}
        mustConditions={result.must_conditions}
        budgetLabel={budgetLabel}
        conflict={result.budget.conflict}
        participants={participants}
        partnerConfirmed={partnerConfirmed}
        retrying={retrying}
        onRetry={handleRetry}
        saving={saving}
        onSave={handleSave}
        onSaveImage={handleSaveImage}
        onSaveText={handleSaveText}
        saveSheetOpen={saveSheetOpen}
        onSaveSheetOpenChange={setSaveSheetOpen}
        exportRef={exportRef}
      />

      {actionError && (
        <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <span className="rounded-full bg-red-600 px-5 py-3 text-body-sb font-semibold text-white shadow-lg">
            {actionError}
          </span>
        </div>
      )}

      {copiedText && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <span className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-full bg-neutral-900 px-5 py-3 text-body-sb font-semibold text-neutral-0 shadow-lg">
            클립보드에 복사되었어요
          </span>
        </div>
      )}

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(16px,env(safe-area-inset-top))] z-30 flex justify-center px-4">
          <span className="animate-in fade-in-0 slide-in-from-top-2 rounded-full bg-neutral-900 px-5 py-3 text-body-sb font-semibold text-neutral-0 shadow-lg">
            {notice === 'accepted'
              ? '조율된 동네 리스트를 확인해보세요'
              : notice === 'rejected'
                ? '상대방이 조율을 거절했어요'
                : '새로운 결과로 이동했어요'}
          </span>
        </div>
      )}

      <FeedbackBanner sessionId={sessionId} />
    </main>
  )
}
