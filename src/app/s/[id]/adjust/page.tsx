'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant, type MyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok } from '@/lib/condition-labels'
import { GroupedAreaList } from '@/components/grouped-area-list'
import { useCommuteStatus } from '@/lib/use-commute-status'
import { Slider } from '@/components/ui/slider'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { DecisionResultSheet } from '@/components/decision-result-sheet'
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

function nextTier(t: Tier): Tier {
  return t === 'must' ? 'nice' : t === 'nice' ? 'skip' : 'must'
}

// A=핑크, B=청록 — 결과 화면(ResultAreaCard, Pin 등)과 동일한 역할 컬러 코드
function tierPillClass(role: 'A' | 'B') {
  return role === 'A' ? 'border-pink-500 text-pink-500' : 'border-accent-teal text-accent-teal'
}

// role 고유 색 토큰 — "변경 사항" 배지는 제안자 본인(role) 색을, "상대 확인
// 중" 배지는 결정할 상대(반대 role) 색을 쓴다. 즉 같은 화면 안에서 두 배지가
// 서로 다른 role의 색을 참조한다 (Figma: 제안 시 화면_A/_B).
function roleTokens(role: 'A' | 'B') {
  return role === 'A'
    ? { statusBg: 'bg-pink-100', statusDot: 'bg-pink-500', statusText: 'text-pink-500', badgeBg: 'bg-pink-50', badgeText: 'text-pink-500' }
    : { statusBg: 'bg-accent-teal/20', statusDot: 'bg-accent-teal', statusText: 'text-accent-teal', badgeBg: 'bg-accent-teal/20', badgeText: 'text-accent-teal' }
}

// 매칭 개수만 필요한 가벼운 버전 — "총 8곳 → 총 10곳" 비교용 (passing과 달리
// niceCount/정렬은 카드 렌더링에만 필요해서 뺐다).
function countMatches(
  candidates: Candidate[],
  aTiers: Record<string, Tier>,
  bTiers: Record<string, Tier>,
  budget: number
) {
  const musts = CODES.filter((c) => aTiers[c] === 'must' || bTiers[c] === 'must')
  return candidates.filter(
    (c) =>
      c.avg_price_krw != null &&
      c.avg_price_krw <= budget &&
      musts.every((code) => c.satisfied[code])
  ).length
}

function buildChanges(
  payload: Record<string, string | number>,
  original: ParticipantAdjust
) {
  return Object.entries(payload).map(([key, value]) => {
    if (key === 'budget_max_krw') {
      return {
        key,
        label: '예산 상한',
        oldValue: formatEok(original.budget_max_krw),
        newValue: formatEok(Number(value)),
        isSkip: false,
      }
    }
    const newTier = value as Tier
    return {
      key,
      label: CONDITION_LABEL[key] ?? key,
      oldValue: TIER_LABEL[original.conditions[key] as Tier],
      newValue: TIER_LABEL[newTier],
      isSkip: newTier === 'skip',
    }
  })
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
  const [decisionSheet, setDecisionSheet] = useState<'accepted' | 'rejected' | null>(null)
  const [resent, setResent] = useState(false)

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

  const isProposer = pending?.proposer_id === me?.id

  // 상대가 이 제안을 수락/거절하는 순간의 감지는 세션 레이아웃에 공통으로 걸린
  // ProposalSnackbar(전역 realtime 구독)가 담당한다 — 이 페이지에 있을 때도,
  // 다른 페이지에 있을 때도 동일하게 동작하도록 한 곳으로 모았다.

  const lowBudgetOriginal = data ? Math.min(data.a.budget_max_krw, data.b.budget_max_krw) : 0
  const highBudgetOriginal = data ? Math.max(data.a.budget_max_krw, data.b.budget_max_krw) : 0
  const budgetHasConflict = data ? data.a.budget_max_krw !== data.b.budget_max_krw : false
  // 예산 슬라이더는 min이 항상 lowBudgetOriginal이라 "올리는" 것만 가능하다.
  // 내가 이미 더 높은 예산 쪽이면 내 슬라이더를 올려도 적용 예산(최소값)엔
  // 아무 영향이 없는데, 예전엔 슬라이더는 누구나 움직일 수 있고 미리보기
  // 구역 수(passing)도 그 값을 그대로 반영해서 — 실제로는 반영되지 않는
  // 변경인데 마치 반영되는 것처럼 보였다(제안 시 myDiff가 iAmLowerBudget일
  // 때만 payload에 담아서, 조율 화면 미리보기 개수와 승인 후 결과 화면 개수가
  // 달라지는 버그의 원인). 낮은 예산 쪽만 슬라이더를 움직일 수 있게 막는다.
  const iAmLowerBudget =
    data && me ? (me.role === 'A' ? data.a.budget_max_krw : data.b.budget_max_krw) === lowBudgetOriginal : false
  // 두 사람 예산 중 더 높은 쪽보다도 3억 더 위까지 탐색해볼 수 있게 여유를 둔다
  // (예산이 같을 때도 슬라이더로 상한을 올려서 후보를 넓혀볼 수 있어야 함).
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

  async function suggest() {
    if (!me || !data || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: insertError } = await supabase.from('proposals').insert({
        session_id: sessionId,
        proposer_id: me.id,
        payload: myDiff(),
      })
      if (insertError) throw insertError
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '제안에 실패했어요')
    } finally {
      setSubmitting(false)
    }
  }

  // "다시 보내기" — 같은 제안을 새 row로 재제출한다(요청사항). 상대에게 새
  // pending 알림이 다시 뜨도록 동일 payload로 suggest()를 한 번 더 호출한다.
  async function resend() {
    await suggest()
    setResent(true)
    setTimeout(() => setResent(false), 1800)
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

  async function decide(accept: boolean) {
    if (!me || !data || !pending || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const supabase = createClient()
      if (accept) await saveMyChanges(supabase)

      const { error: decideError } = await supabase.rpc('decide_proposal', {
        pid: pending.id,
        accept,
      })
      if (decideError) throw decideError

      setDecisionSheet(accept ? 'accepted' : 'rejected')
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
    const proposerOriginal = me.role === 'A' ? data.a : data.b
    const badgeColors = roleTokens(me.role)
    const statusColors = roleTokens(me.role === 'A' ? 'B' : 'A')
    const changes = buildChanges(pending.payload, proposerOriginal)

    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-6 text-center">
            <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
              제안이 완료되었어요
            </h1>
            <span className={cn('flex items-center gap-2 rounded-full px-4 py-2', statusColors.statusBg)}>
              <span className={cn('size-1.5 rounded-full', statusColors.statusDot)} />
              <span className={cn('text-body-m font-bold', statusColors.statusText)}>상대 확인 중</span>
            </span>
          </div>

          <div className="flex w-full flex-col gap-4">
            <p className="pl-2 text-body-m font-bold text-neutral-900">변경 사항</p>
            <div className="flex w-full flex-col gap-5 rounded-xl border border-neutral-100 bg-white p-6 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
              {changes.length === 0 && (
                <p className="text-center text-body-s text-neutral-400">
                  변경 없이 지금 조건 그대로 제안했어요
                </p>
              )}
              {changes.map((change, i) => (
                <div key={change.key} className="contents">
                  {i > 0 && <div className="h-px w-full bg-neutral-100" />}
                  <div className="flex items-center justify-between">
                    <span className="text-body-m font-semibold text-neutral-900">
                      {change.label}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] font-medium tracking-[-0.03em] text-neutral-500">
                        {change.oldValue}
                      </span>
                      <ArrowRight className="size-4 text-neutral-400" />
                      <span
                        className={cn(
                          'rounded-full px-3 py-1.5 text-[15px] font-bold tracking-[-0.03em]',
                          badgeColors.badgeBg,
                          badgeColors.badgeText
                        )}
                      >
                        {change.newValue}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={resend}
              disabled={submitting}
              className="text-center text-body-sb font-medium text-neutral-500 underline decoration-1 underline-offset-4 disabled:opacity-50"
            >
              다시 보내기
            </button>
          </div>
        </div>

        {resent && (
          <div className="pointer-events-none fixed inset-x-0 bottom-8 z-30 flex justify-center px-4">
            <span className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-full bg-neutral-900 px-5 py-3 text-body-sb font-semibold text-neutral-0 shadow-lg">
              다시 보냈어요
            </span>
          </div>
        )}
      </main>
    )
  }

  if (pending && iAmDeciding) {
    const proposerRole = pending.proposer_id === data.a.id ? 'A' : 'B'
    const proposerOriginal = proposerRole === 'A' ? data.a : data.b
    const badgeColors = roleTokens(proposerRole)
    const changes = buildChanges(pending.payload, proposerOriginal)

    const beforeBudget = Math.min(data.a.budget_max_krw, data.b.budget_max_krw)
    const matchCountBefore = countMatches(data.candidates, data.a.conditions, data.b.conditions, beforeBudget)
    const matchCountAfter = countMatches(data.candidates, aTiers, bTiers, budgetValue)

    return (
      <main className="flex flex-1 justify-center bg-neutral-50">
        <div className="w-full max-w-sm pb-40">
          <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/result`)} />

          <div className="flex flex-col gap-10 px-4 pt-2">
            <h1 className="text-center text-[24px] leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
              상대방이 제안했어요
            </h1>

            <div className="flex flex-col gap-3 rounded-2xl border border-neutral-900 bg-neutral-900/80 p-6 shadow-[0_0_16px_rgba(15,23,42,0.12),0_8px_24px_rgba(15,23,42,0.03)] backdrop-blur-md">
              {changes.map((change) => (
                <div key={change.key} className="flex items-center justify-between">
                  <span className="w-16 text-body-sb font-semibold text-white">{change.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-body-sb font-medium text-white">{change.oldValue}</span>
                    <ArrowRight className="size-4 text-neutral-400" />
                    <span
                      className={cn(
                        'rounded-full px-3 py-1.5 text-body-sb font-bold',
                        change.isSkip ? 'bg-white/10 text-white' : `${badgeColors.badgeBg} ${badgeColors.badgeText}`
                      )}
                    >
                      {change.newValue}
                    </span>
                  </div>
                </div>
              ))}
              <div className="h-px w-full bg-white/10" />
              <div className={cn('flex items-center justify-center gap-3 text-[15px] font-medium', badgeColors.badgeText)}>
                <span>총 {matchCountBefore}곳</span>
                <ArrowRight className="size-4" />
                <span>총 {matchCountAfter}곳</span>
              </div>
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
                    <div
                      className={cn(
                        'w-full rounded-full border-2 bg-white px-7 py-5 text-center text-body-m font-bold',
                        tierPillClass('A'),
                        proposerRole === 'A' && 'opacity-30'
                      )}
                    >
                      {TIER_LABEL[aTiers[code]]}
                    </div>
                    <div
                      className={cn(
                        'w-full rounded-full border-2 bg-white px-7 py-5 text-center text-body-m font-bold',
                        tierPillClass('B'),
                        proposerRole === 'B' && 'opacity-30'
                      )}
                    >
                      {TIER_LABEL[bTiers[code]]}
                    </div>
                  </div>
                </div>
              ))}

              <div className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-title-sb font-bold text-neutral-900">예산 상한</span>
                  <span className="text-title-sb font-bold text-pink-500">{formatEok(budgetValue)}</span>
                </div>
                <Slider value={[budgetValue]} min={lowBudgetOriginal} max={budgetSliderMax} step={10_000_000} disabled />
                <div className="mt-2 flex justify-between text-body-sb font-semibold text-neutral-900">
                  <span>{formatEok(lowBudgetOriginal)}</span>
                  <span>{formatEok(budgetSliderMax)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-t-[60px] bg-neutral-100 px-4 pt-8 pb-2 -mx-4">
              <div className="mb-6 flex flex-col items-center gap-1.5">
                <p className="text-body-m text-neutral-500">우리가 함께 할 수 있는 동네</p>
                <p className="flex items-center gap-2 text-title-sb font-bold text-neutral-900">
                  <span className="rounded-full bg-neutral-900 px-4 py-2 font-montserrat text-mont-title-m text-white">
                    {matchCountAfter}
                  </span>
                  개 시군구에 걸쳐 있어요
                </p>
              </div>
              <GroupedAreaList areas={passing} />
            </div>
          </div>

          {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md gap-3 bg-white px-4 py-5">
          <button
            onClick={() => decide(false)}
            disabled={submitting}
            className="flex flex-1 items-center justify-center rounded-full border-2 border-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-pink-500 disabled:opacity-50"
          >
            No
          </button>
          <button
            onClick={() => decide(true)}
            disabled={submitting}
            className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-white disabled:opacity-50"
          >
            Yesss!
          </button>
        </div>

        {decisionSheet && (
          <DecisionResultSheet
            open
            onOpenChange={() => {}}
            sessionId={sessionId}
            kind={decisionSheet}
          />
        )}
      </main>
    )
  }

  return (
    <main className="flex flex-1 justify-center bg-neutral-50">
      <div className="w-full max-w-sm pb-32">
        <div className="rounded-b-[60px] bg-neutral-100 px-4 pb-8">
          <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/result`)} />

          <div className="mt-2 mb-8 flex flex-col items-center gap-2 px-2 text-center">
            <p className="text-body-s font-medium text-neutral-400">함께 조율하기</p>
            <h1 className="text-[24px] leading-[1.4] font-semibold tracking-[-0.03em] text-neutral-900">
              조건을 움직이면
              <br />
              구역이 바로 바뀌어요
            </h1>
          </div>

          {/* A/B 컬러 범례 — 카드마다 반복하지 않고 여기서 한 번만 안내.
              칩 순서는 항상 A=왼쪽/B=오른쪽 고정이라, B가 볼 땐 범례 문구도
              "상대·내"로 뒤집어야 순서와 말이 맞는다. */}
          <div className="mb-4 flex items-center justify-between px-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-pink-500 text-body-sb font-bold text-white">
              A
            </span>
            <span className="text-caption-l text-neutral-400">
              {me.role === 'B' ? '상대 조건 · 내 조건' : '내 조건 · 상대 조건'}
            </span>
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
                {/* 상단 A/B 범례(A=왼쪽 고정, B=오른쪽 고정)와 순서를 맞춘다 — "내
                    조건"이 항상 왼쪽에 오면 B가 볼 때 범례와 어긋나 보인다. */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={
                      me.role === 'A'
                        ? () => setATiers((t) => ({ ...t, [code]: nextTier(t[code]) }))
                        : undefined
                    }
                    disabled={me.role !== 'A'}
                    className={cn(
                      'w-full rounded-full border-2 bg-white px-7 py-5 text-body-m font-bold',
                      tierPillClass('A'),
                      me.role !== 'A' && 'opacity-30'
                    )}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {TIER_LABEL[aTiers[code]]}
                      {me.role === 'A' && (
                        <span className="inline-block size-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-current" />
                      )}
                    </span>
                  </button>
                  <button
                    onClick={
                      me.role === 'B'
                        ? () => setBTiers((t) => ({ ...t, [code]: nextTier(t[code]) }))
                        : undefined
                    }
                    disabled={me.role !== 'B'}
                    className={cn(
                      'w-full rounded-full border-2 bg-white px-7 py-5 text-body-m font-bold',
                      tierPillClass('B'),
                      me.role !== 'B' && 'opacity-30'
                    )}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {TIER_LABEL[bTiers[code]]}
                      {me.role === 'B' && (
                        <span className="inline-block size-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-current" />
                      )}
                    </span>
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
                {iAmLowerBudget
                  ? ' · 상한을 더 올려서 후보를 넓혀볼 수도 있어요'
                  : ' · 더 낮은 예산 쪽만 상한을 조정할 수 있어요'}
              </p>
              <Slider
                value={[budgetValue]}
                onValueChange={iAmLowerBudget ? ([v]) => setBudgetValue(v) : undefined}
                disabled={!iAmLowerBudget}
                min={lowBudgetOriginal}
                max={budgetSliderMax}
                step={10_000_000}
              />
              <div className="mt-2 flex justify-between text-body-sb font-semibold text-neutral-900">
                <span>{formatEok(lowBudgetOriginal)}</span>
                <span>{formatEok(budgetSliderMax)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 py-8">
          <p className="text-body-m text-neutral-500">함께 살 수 있는 구역</p>
          <p className="flex items-center gap-2 text-title-sb font-bold text-neutral-900">
            <span className="rounded-full bg-neutral-900 px-4 py-2 font-montserrat text-mont-title-m text-white">
              {new Set(passing.map((p) => p.sigungu)).size}
            </span>
            개 시군구에 걸쳐 있어요
          </p>
        </div>

        <div className="rounded-t-[60px] bg-neutral-100 px-4 pt-8 pb-6">
          <GroupedAreaList areas={passing} />
        </div>

        {error && <p className="mt-3 px-4 text-center text-sm text-red-600">{error}</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md bg-white px-4 py-5">
        <button
          onClick={suggest}
          disabled={submitting}
          className="w-full rounded-full bg-pink-500 py-4 text-body-m font-bold text-white disabled:opacity-50"
        >
          제안하기
        </button>
      </div>
    </main>
  )
}
