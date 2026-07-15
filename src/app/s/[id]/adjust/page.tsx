'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant, type MyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { Button } from '@/components/ui/button'
import { GroupedAreaList } from '@/components/grouped-area-list'
import { useCommuteStatus } from '@/lib/use-commute-status'
import { Slider } from '@/components/ui/slider'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { cn } from '@/lib/utils'

type Tier = 'must' | 'nice' | 'skip'
const CODES = ['area_size', 'build_year', 'infra'] as const
const TIER_LABEL: Record<Tier, string> = { must: '필수', nice: '선호', skip: '무관' }

interface Candidate {
  code: string
  name: string
  sigungu: string
  avg_price_krw: number | null
  a_minutes: number
  b_minutes: number
  satisfied: Record<string, boolean>
}

interface ParticipantAdjust {
  id: string
  budget_max_krw: number
  conditions: Record<string, Tier>
}

interface AdjustData {
  candidates: Candidate[]
  a: ParticipantAdjust
  b: ParticipantAdjust
}

interface Proposal {
  id: string
  proposer_id: string
  payload: Record<string, string | number>
  status: string
}

function describePayload(payload: Record<string, string | number>) {
  return Object.entries(payload)
    .map(([key, value]) => {
      if (key === 'budget_max_krw') return `예산 상한 ${formatEok(Number(value))}로 조정`
      return `${CONDITION_LABEL[key] ?? key} → ${TIER_LABEL[value as Tier] ?? value}`
    })
    .join(', ')
}

function nextTier(t: Tier): Tier {
  return t === 'must' ? 'nice' : t === 'nice' ? 'skip' : 'must'
}

// A=핑크, B=청록 — 결과 화면(ResultAreaCard, Pin 등)과 동일한 역할 컬러 코드
function tierPillClass(role: 'A' | 'B') {
  return role === 'A' ? 'border-pink-500 text-pink-500' : 'border-accent-teal text-accent-teal'
}

export default function AdjustPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const sessionId = params.id

  const [me, setMe] = useState<MyParticipant | null>(null)
  const [data, setData] = useState<AdjustData | null>(null)
  const [pending, setPending] = useState<Proposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [aTiers, setATiers] = useState<Record<string, Tier>>({})
  const [bTiers, setBTiers] = useState<Record<string, Tier>>({})
  const [budgetValue, setBudgetValue] = useState(0)

  const { ready: commuteReady, status: commuteStatus } = useCommuteStatus(sessionId)

  const refresh = useCallback(async () => {
    const supabase = createClient()
    const myRow = await getMyParticipant(supabase, sessionId)
    if (!myRow) return
    setMe(myRow)

    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('status')
      .eq('id', sessionId)
      .single()
    if (sessionRow?.status === 'resolved') {
      router.replace(`/s/${sessionId}/result`)
      return
    }

    const { data: adjustData, error: dataError } = await supabase.rpc(
      'get_adjust_data',
      { sid: sessionId }
    )
    if (dataError) {
      setError(dataError.message)
      setLoading(false)
      return
    }
    const parsed = adjustData as AdjustData

    const { data: proposals } = await supabase
      .from('proposals')
      .select('id, proposer_id, payload, status')
      .eq('session_id', sessionId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
    const pendingProposal = (proposals?.[0] as Proposal) ?? null
    setPending(pendingProposal)

    // 대기 중인 제안이 있으면, 제안자 쪽 조건은 "제안된 값"으로 덮어써서
    // 보여준다 (아직 실제로 저장되진 않았지만, 상대가 검토할 값은 이거니까).
    const aOverlay = { ...parsed.a.conditions }
    const bOverlay = { ...parsed.b.conditions }
    let budgetInit = Math.min(parsed.a.budget_max_krw, parsed.b.budget_max_krw)

    if (pendingProposal) {
      const proposerIsA = pendingProposal.proposer_id === parsed.a.id
      const target = proposerIsA ? aOverlay : bOverlay
      for (const [key, value] of Object.entries(pendingProposal.payload)) {
        if ((CODES as readonly string[]).includes(key)) {
          target[key] = value as Tier
        }
      }
      if ('budget_max_krw' in pendingProposal.payload) {
        budgetInit = Number(pendingProposal.payload.budget_max_krw)
      }
    }

    setData(parsed)
    setATiers(aOverlay)
    setBTiers(bOverlay)
    setBudgetValue(budgetInit)
    setLoading(false)
  }, [sessionId, router])

  useEffect(() => {
    if (!commuteReady) return
    refresh()
  }, [refresh, commuteReady])

  const lowBudgetOriginal = data ? Math.min(data.a.budget_max_krw, data.b.budget_max_krw) : 0
  const highBudgetOriginal = data ? Math.max(data.a.budget_max_krw, data.b.budget_max_krw) : 0
  const budgetHasConflict = data ? data.a.budget_max_krw !== data.b.budget_max_krw : false
  // 두 사람 예산 중 더 높은 쪽보다도 3억 더 위까지 탐색해볼 수 있게 여유를 둔다
  // (예산이 같을 때도 슬라이더로 상한을 올려서 후보를 더 넓혀볼 수 있어야 함).
  const budgetSliderMax = highBudgetOriginal + 300_000_000

  const passing = useMemo(() => {
    if (!data) return []
    const musts = CODES.filter((c) => aTiers[c] === 'must' || bTiers[c] === 'must')
    return data.candidates
      .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budgetValue)
      .filter((c) => musts.every((code) => c.satisfied[code]))
      .map((c) => {
        const niceCount = CODES.filter(
          (code) =>
            (aTiers[code] === 'nice' && c.satisfied[code]) ||
            (bTiers[code] === 'nice' && c.satisfied[code])
        ).length
        return { ...c, niceCount }
      })
      .sort(
        (x, y) =>
          y.niceCount - x.niceCount || x.a_minutes + x.b_minutes - (y.a_minutes + y.b_minutes)
      )
  }, [data, aTiers, bTiers, budgetValue])

  const passingSigunguCount = useMemo(
    () => new Set(passing.map((p) => p.sigungu)).size,
    [passing]
  )

  const isProposer = pending?.proposer_id === me?.id
  const iAmDeciding = pending && !isProposer

  function myDiff() {
    if (!me || !data) return {}
    const myTiers = me.role === 'A' ? aTiers : bTiers
    const myOriginal = me.role === 'A' ? data.a : data.b
    const iAmLowerBudget = myOriginal.budget_max_krw === lowBudgetOriginal

    const payload: Record<string, string | number> = {}
    for (const code of CODES) {
      if (myTiers[code] !== myOriginal.conditions[code]) payload[code] = myTiers[code]
    }
    if (iAmLowerBudget && budgetValue !== myOriginal.budget_max_krw) {
      payload.budget_max_krw = budgetValue
    }
    return payload
  }

  async function propose() {
    if (!me || !data || submitting) return
    const payload = myDiff()
    if (Object.keys(payload).length === 0) {
      setError('바꾼 내용이 없어요')
      setTimeout(() => setError(null), 1500)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('proposals').insert({
        session_id: sessionId,
        proposer_id: me.id,
        payload,
      })
      if (insertError) throw insertError
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '제안에 실패했어요')
    } finally {
      setSubmitting(false)
    }
  }

  async function saveMyChanges(supabase: ReturnType<typeof createClient>) {
    if (!me || !data) return
    const myTiers = me.role === 'A' ? aTiers : bTiers
    const myOriginal = me.role === 'A' ? data.a : data.b
    const iAmLowerBudget = myOriginal.budget_max_krw === lowBudgetOriginal

    const changedCodes = CODES.filter((code) => myTiers[code] !== myOriginal.conditions[code])
    if (changedCodes.length > 0) {
      const { error: condError } = await supabase.from('participant_conditions').upsert(
        changedCodes.map((code) => ({
          participant_id: me.id,
          condition_code: code,
          tier: myTiers[code],
        })),
        { onConflict: 'participant_id,condition_code' }
      )
      if (condError) throw condError
    }

    if (iAmLowerBudget && budgetValue !== myOriginal.budget_max_krw) {
      const { error: budgetError } = await supabase
        .from('participants')
        .update({ budget_max_krw: budgetValue })
        .eq('id', me.id)
      if (budgetError) throw budgetError
    }
  }

  async function finalizeNow() {
    if (!me || !data || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      await saveMyChanges(supabase)
      const { error: finalizeError } = await supabase.rpc('finalize_session', {
        sid: sessionId,
      })
      if (finalizeError) throw finalizeError
      router.push(`/s/${sessionId}/result`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정에 실패했어요')
      setSubmitting(false)
    }
  }

  async function saveMyChangesAndDecide() {
    if (!me || !data || !pending || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      await saveMyChanges(supabase)

      const { error: decideError } = await supabase.rpc('decide_proposal', {
        pid: pending.id,
        accept: true,
      })
      if (decideError) throw decideError

      router.push(`/s/${sessionId}/result`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리에 실패했어요')
      setSubmitting(false)
    }
  }

  async function reject() {
    if (!pending || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: decideError } = await supabase.rpc('decide_proposal', {
        pid: pending.id,
        accept: false,
      })
      if (decideError) throw decideError
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리에 실패했어요')
    } finally {
      setSubmitting(false)
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
        <p className="text-neutral-500">불러오는 중...</p>
      </main>
    )
  }

  if (error && !data) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  if (!me || !data) return null

  if (pending && isProposer) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <p className="mb-1 text-[13px] text-neutral-500">함께 조율하기</p>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-center">
            <p className="mb-1 text-sm font-medium text-neutral-700">
              제안 완료 · 상대 확인 대기 중
            </p>
            <p className="text-[13px] text-neutral-500">{describePayload(pending.payload)}</p>
          </div>
          <Button variant="ghost" onClick={refresh} className="mt-3 w-full">
            새로고침
          </Button>
        </div>
      </main>
    )
  }

  const proposerRole = pending ? (pending.proposer_id === data.a.id ? 'A' : 'B') : null

  return (
    <main className="flex flex-1 justify-center bg-neutral-50">
      <div className="w-full max-w-sm pb-6">
        <div className="rounded-b-[40px] bg-white px-4 pb-8">
          <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/result`)} />

          <div className="mt-2 mb-8 flex flex-col items-center gap-2 px-2 text-center">
            <p className="text-body-s font-medium text-neutral-400">함께 조율하기</p>
            <h1 className="text-[24px] leading-[1.4] font-semibold tracking-[-0.03em] text-neutral-900">
              조건을 움직이면 구역이 바로 바뀌어요
            </h1>
          </div>

          {iAmDeciding && (
            <div className="mb-4 rounded-[28px] border border-neutral-100 bg-neutral-50 px-4 py-3">
              <p className="text-body-sb font-bold text-neutral-900">{proposerRole}의 제안이에요</p>
              <p className="text-caption-l text-neutral-500">{describePayload(pending!.payload)}</p>
            </div>
          )}

          {/* A/B 컬러 범례 — 카드마다 반복하지 않고 여기서 한 번만 안내 */}
          <div className="mb-4 flex items-center justify-between px-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-pink-500 text-body-sb font-bold text-white">
              A
            </span>
            <span className="text-caption-l text-neutral-400">내 조건 · 상대 조건</span>
            <span className="flex size-8 items-center justify-center rounded-full bg-accent-teal text-body-sb font-bold text-white">
              B
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {CODES.map((code) => (
              <div
                key={code}
                className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]"
              >
                <p className="mb-3 text-center text-title-sb font-bold text-neutral-900">
                  {CONDITION_LABEL[code]}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      const setter = me.role === 'A' ? setATiers : setBTiers
                      setter((t) => ({ ...t, [code]: nextTier(t[code]) }))
                    }}
                    disabled={!!pending && proposerRole === me.role}
                    className={cn(
                      'w-full rounded-full border-2 bg-white px-7 py-5 text-body-m font-bold transition-opacity disabled:pointer-events-none disabled:opacity-30',
                      tierPillClass(me.role)
                    )}
                  >
                    {TIER_LABEL[me.role === 'A' ? aTiers[code] : bTiers[code]]}
                  </button>
                  <button
                    onClick={() => {
                      const setter = me.role === 'A' ? setBTiers : setATiers
                      setter((t) => ({ ...t, [code]: nextTier(t[code]) }))
                    }}
                    disabled={!pending || proposerRole === (me.role === 'A' ? 'B' : 'A')}
                    className={cn(
                      'w-full rounded-full border-2 bg-white px-7 py-5 text-body-m font-bold transition-opacity disabled:pointer-events-none disabled:opacity-30',
                      tierPillClass(me.role === 'A' ? 'B' : 'A')
                    )}
                  >
                    {TIER_LABEL[me.role === 'A' ? bTiers[code] : aTiers[code]]}
                  </button>
                </div>
              </div>
            ))}

            <div className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-title-sb font-bold text-neutral-900">예산 상한</span>
                <span className="text-title-sb font-bold text-pink-500">
                  {formatEok(budgetValue)}
                </span>
              </div>
              <p className="mb-3 text-caption-l text-neutral-400">
                {budgetHasConflict
                  ? '예산 상한이 서로 달라요 · 낮은 쪽 기준으로 시작해요'
                  : '두 분 예산이 같아요'}
                {' · 상한을 더 올려서 후보를 넓혀볼 수도 있어요'}
              </p>
              <Slider
                value={[budgetValue]}
                onValueChange={([v]) => setBudgetValue(v)}
                min={lowBudgetOriginal}
                max={budgetSliderMax}
                step={10_000_000}
                disabled={!!pending && 'budget_max_krw' in pending.payload}
              />
              <div className="mt-2 flex justify-between text-body-sb font-semibold text-neutral-900">
                <span>{formatEok(lowBudgetOriginal)}</span>
                <span>{formatEok(budgetSliderMax)}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-1.5">
            <p className="text-body-m text-neutral-500">함께 살 수 있는 구역</p>
            <p className="flex items-center gap-2 text-title-sb font-bold text-neutral-900">
              <span className="rounded-full bg-neutral-900 px-4 py-2 font-montserrat text-mont-title-m text-white">
                {passingSigunguCount}
              </span>
              개 시군구에 걸쳐 있어요
            </p>
          </div>
        </div>

        <div className="px-4 pt-4">
          <GroupedAreaList areas={passing} />
        </div>

        <div className="px-4 pt-4">
          {iAmDeciding ? (
            <div className="flex gap-2">
              <Button onClick={saveMyChangesAndDecide} disabled={submitting} className="flex-1">
                결정하기
              </Button>
              <Button
                onClick={reject}
                disabled={submitting}
                variant="outline"
                className="flex-1"
              >
                거절
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button onClick={finalizeNow} disabled={submitting} className="flex-1">
                  이 조건으로 결정하기
                </Button>
                <Button
                  onClick={propose}
                  disabled={submitting}
                  variant="outline"
                  className="flex-1"
                >
                  {me.role === 'A' ? 'B' : 'A'}에게 제안하기 →
                </Button>
              </div>
              <p className="mt-2 text-center text-caption-l text-neutral-400">
                상대 항목은 참고용이에요 · 결정하기는 내 변경분을 바로 반영하고 확정해요,
                제안하기는 상대 동의를 거쳐요
              </p>
            </>
          )}

          {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </main>
  )
}
