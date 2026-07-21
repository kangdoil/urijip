'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, Compass } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant, type MyParticipant } from '@/lib/get-my-participant'
import { CONDITION_LABEL, formatEok, type Priority } from '@/lib/condition-labels'
import { GroupedAreaList } from '@/components/grouped-area-list'
import { useCommuteStatus } from '@/lib/use-commute-status'
import { Slider } from '@/components/ui/slider'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { DecisionResultSheet } from '@/components/decision-result-sheet'
import { FindingBestAreasScreen } from '@/components/finding-best-areas-screen'
import { cn } from '@/lib/utils'
import type { ConcessionMatchResult } from '@/lib/concession-copy'

const CODES = ['area_size', 'build_year', 'infra'] as const
// 시군구별 추천 동네 상한(grouped-area-list.tsx의 "상위 최대 5곳" 규칙과 동일) —
// "총 N곳" 배지의 숫자를 시군구 수 × 5로 계산하는 기준값이다.
const RECOMMENDED_PER_SIGUNGU = 5

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
  priorities: Record<string, Priority>
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

// priorities(코드->1~3위) <-> order(1위부터 순서대로 나열한 코드 배열) 변환.
// 순위는 더 이상 하드 필터가 아니라 정렬 가중치라 permutation으로만 다룬다.
function orderFromPriorities(priorities: Record<string, Priority>): string[] {
  return [...CODES].sort((a, b) => (priorities[a] ?? 99) - (priorities[b] ?? 99))
}

function priorityWeight(order: string[], code: string) {
  const idx = order.indexOf(code)
  return idx === -1 ? 0 : 3 - idx // 1위=3점, 2위=2점, 3위=1점
}

function orderLabel(order: string[]) {
  return order.map((code) => CONDITION_LABEL[code] ?? code).join(' · ')
}

// A=핑크, B=청록 — 결과 화면(ResultAreaCard, Pin 등)과 동일한 역할 컬러 코드
function rankBadgeClass(role: 'A' | 'B') {
  return role === 'A' ? 'bg-pink-500 text-white' : 'bg-accent-teal text-white'
}

function rankBorderClass(role: 'A' | 'B') {
  return role === 'A' ? 'border-pink-500' : 'border-accent-teal'
}

function moveOrder(setOrder: (updater: (order: string[]) => string[]) => void, index: number, delta: number) {
  setOrder((order) => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return order
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
}

// role 고유 색 토큰 — "변경 사항" 배지는 제안자 본인(role) 색을, "상대 확인
// 중" 배지는 결정할 상대(반대 role) 색을 쓴다. 즉 같은 화면 안에서 두 배지가
// 서로 다른 role의 색을 참조한다 (Figma: 제안 시 화면_A/_B).
function roleTokens(role: 'A' | 'B') {
  return role === 'A'
    ? { statusBg: 'bg-pink-100', statusDot: 'bg-pink-500', statusText: 'text-pink-500', badgeBg: 'bg-pink-50', badgeText: 'text-pink-500' }
    : { statusBg: 'bg-accent-teal/20', statusDot: 'bg-accent-teal', statusText: 'text-accent-teal', badgeBg: 'bg-accent-teal/20', badgeText: 'text-accent-teal' }
}

// 시군구 개수만 필요한 가벼운 버전 — "총 8개 시군구 → 총 10개 시군구" 비교용
// 순위는 더 이상 하드 필터가 아니라서(정렬 가중치일 뿐) 예산 상한만 후보
// 개수를 바꾼다 — musts 필터링이 통째로 사라졌다.
function countMatches(candidates: Candidate[], budget: number) {
  const passing = candidates.filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budget)
  return new Set(passing.map((c) => c.sigungu)).size
}

// payload의 조건 3개 키(area_size/build_year/infra)는 순위가 바뀔 때 항상
// 셋이 함께 온다(순열이라 하나만 따로 바꿀 수 없음) — "우선순위" 항목 하나로
// 묶어서 보여준다.
function buildChanges(payload: Record<string, string | number>, original: ParticipantAdjust) {
  const changes: { key: string; label: string; oldValue: string; newValue: string; isSkip: boolean }[] = []

  if ('budget_max_krw' in payload) {
    changes.push({
      key: 'budget_max_krw',
      label: '예산 상한',
      oldValue: formatEok(original.budget_max_krw),
      newValue: formatEok(Number(payload.budget_max_krw)),
      isSkip: false,
    })
  }

  const hasPriorityChange = CODES.some((code) => code in payload)
  if (hasPriorityChange) {
    const newOrder = [...CODES].sort(
      (a, b) => Number(payload[a] ?? original.priorities[a] ?? 99) - Number(payload[b] ?? original.priorities[b] ?? 99)
    )
    changes.push({
      key: 'priorities',
      label: '우선순위',
      oldValue: orderLabel(orderFromPriorities(original.priorities)),
      newValue: orderLabel(newOrder),
      isSkip: false,
    })
  }

  return changes
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
  // 수락(Yesss!)은 확인 시트 없이 바로 결과 화면으로 이동한다 — 거절만
  // "결과 보기" 버튼이 있는 시트를 거친다(본인이 거절한 화면이라 서두를 필요가
  // 없고, 실수로 되돌릴 여지를 준다).
  const [decisionSheet, setDecisionSheet] = useState<'rejected' | null>(null)
  const [resent, setResent] = useState(false)

  // 1위부터 나열한 조건 코드 배열 — 더 이상 하드 필터가 아니라 permutation일
  // 뿐이라, 개별 코드 값이 아니라 순서 자체가 상태다.
  const [aOrder, setAOrder] = useState<string[]>([])
  const [bOrder, setBOrder] = useState<string[]>([])
  const [budgetValue, setBudgetValue] = useState(0)

  // 통근·예산 조건에 맞는 후보 0건(콜드 스테이션)이었던 세션에서만 채워진다
  // — "추천 조정" 카드/하이라이트에 쓴다. get_concession_matches가 계산한
  // 원래 상태 기준 값이라, 슬라이더를 만져도 이 값 자체는 안 바뀐다(추천
  // 문구가 매 순간 바뀌면 오히려 헷갈린다).
  const [concession, setConcession] = useState<ConcessionMatchResult | null>(null)
  const [recommendationApplied, setRecommendationApplied] = useState(false)
  // 'budget' | null — 추천을 적용한 직후, 예산 카드에 잠깐 강조 링을 준다.
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null)
  const budgetCardRef = useRef<HTMLDivElement>(null)

  const { ready: commuteReady } = useCommuteStatus(sessionId)

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

    // 대기 중인 제안이 있으면, 제안자 쪽 순위는 "제안된 순서"로 덮어써서
    // 보여준다 (아직 실제로 저장되진 않았지만, 상대가 검토할 값은 이거니까).
    // 순위 3개는 permutation이라 제안 payload엔 바뀔 때 항상 셋이 함께 온다.
    let aOverlayOrder = orderFromPriorities(parsed.a.priorities)
    let bOverlayOrder = orderFromPriorities(parsed.b.priorities)
    let budgetInit = Math.min(parsed.a.budget_max_krw, parsed.b.budget_max_krw)

    if (pendingProposal) {
      const proposerIsA = pendingProposal.proposer_id === parsed.a.id
      const hasPriorityChange = CODES.some((code) => code in pendingProposal.payload)
      if (hasPriorityChange) {
        const proposedOrder = [...CODES].sort(
          (a, b) => Number(pendingProposal.payload[a]) - Number(pendingProposal.payload[b])
        )
        if (proposerIsA) aOverlayOrder = proposedOrder
        else bOverlayOrder = proposedOrder
      }
      if ('budget_max_krw' in pendingProposal.payload) {
        budgetInit = Number(pendingProposal.payload.budget_max_krw)
      }
    }

    setData(parsed)
    setAOrder(aOverlayOrder)
    setBOrder(bOverlayOrder)
    setBudgetValue(budgetInit)
    setLoading(false)

    // 원래(조율 전) 조건 기준으로 콜드 스테이션이었던 세션만 추천 조정 카드를
    // 계산한다 — 애초에 매칭이 있던 세션에 뜬금없는 추천을 보여주지 않기 위함.
    const originalLowBudget = Math.min(parsed.a.budget_max_krw, parsed.b.budget_max_krw)
    const wasColdStation = countMatches(parsed.candidates, originalLowBudget) === 0
    if (wasColdStation) {
      const { data: cm } = await supabase.rpc('get_concession_matches', { sid: sessionId })
      setConcession(cm as ConcessionMatchResult)
    }
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

  // "추천 조정" 카드 — 예산과 필수조건 두 종류를 같은 패턴(카드 → 강조된
  // 항목으로 스크롤+링 하이라이트)으로 보여준다. 한 세션엔 병목이 하나뿐이라
  // 항상 둘 중 하나만(또는 아무것도) 뜬다.
  //
  // 1) 예산: 조율 화면엔 예산 슬라이더만 있고 통근 상한을 바꾸는 UI가 없어서,
  //    get_concession_matches의 give 중 field가 'budget'인 것만 다룬다(통근이
  //    병목이면 이 카드는 안 뜬다). 예산을 움직일 수 있는 건 항상 "더 낮은
  //    예산" 쪽이라 그 role에게만 보여준다.
  const budgetRecommendation = (() => {
    if (!concession || !data || !me) return null
    if (concession.total_count === 0) return null
    const lowerRole: 'A' | 'B' = data.a.budget_max_krw <= data.b.budget_max_krw ? 'A' : 'B'
    if (me.role !== lowerRole) return null
    const side = lowerRole === 'A' ? concession.give.a : concession.give.b
    if (!side || side.field !== 'budget') return null
    return { kind: 'budget' as const, role: lowerRole, amount: side.amount, areaCount: concession.total_count }
  })()

  // 순위(area_size/build_year/infra)는 더 이상 하드 필터가 아니라서 "넓힐"
  // 수도, 낮춰서 후보를 열 수도 없다 — 남는 병목은 항상 통근·예산뿐이라
  // budgetRecommendation 하나로 충분하다(통근 조정 UI는 이 화면에 없어서
  // 통근이 병목이면 카드 자체가 안 뜬다).
  const recommendation = budgetRecommendation

  function applyRecommendation() {
    if (!recommendation) return
    setBudgetValue((v) => Math.min(v + recommendation.amount, budgetSliderMax))
    setHighlightTarget('budget')
    setRecommendationApplied(true)
    requestAnimationFrame(() => {
      budgetCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => setHighlightTarget(null), 2500)
  }

  const passing = useMemo(() => {
    if (!data) return []
    return data.candidates
      .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budgetValue)
      .map((c) => {
        const score = CODES.reduce((sum, code) => {
          if (!c.satisfied[code]) return sum
          return sum + priorityWeight(aOrder, code) + priorityWeight(bOrder, code)
        }, 0)
        return { ...c, score }
      })
      .sort((x, y) => y.score - x.score || x.a_minutes + x.b_minutes - (y.a_minutes + y.b_minutes))
  }, [data, aOrder, bOrder, budgetValue])

  const iAmDeciding = pending && !isProposer

  function myDiff() {
    if (!me || !data) return {}
    const myOrder = me.role === 'A' ? aOrder : bOrder
    const myOriginal = me.role === 'A' ? data.a : data.b
    const iAmLowerBudget = myOriginal.budget_max_krw === lowBudgetOriginal

    const payload: Record<string, string | number> = {}
    const originalOrder = orderFromPriorities(myOriginal.priorities)
    if (myOrder.join(',') !== originalOrder.join(',')) {
      myOrder.forEach((code, i) => {
        payload[code] = i + 1
      })
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
    const myOrder = me.role === 'A' ? aOrder : bOrder
    const myOriginal = me.role === 'A' ? data.a : data.b
    const iAmLowerBudget = myOriginal.budget_max_krw === lowBudgetOriginal

    const originalOrder = orderFromPriorities(myOriginal.priorities)
    if (myOrder.join(',') !== originalOrder.join(',')) {
      const { error: condError } = await supabase.from('participant_conditions').upsert(
        myOrder.map((code, i) => ({
          participant_id: me.id,
          condition_code: code,
          priority: i + 1,
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

      if (accept) {
        router.push(`/s/${sessionId}/result?notice=accepted`)
      } else {
        setDecisionSheet('rejected')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리에 실패했어요')
    } finally {
      setSubmitting(false)
    }
  }

  if (!commuteReady) {
    return <FindingBestAreasScreen />
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
    const sigunguCountBefore = countMatches(data.candidates, beforeBudget)
    const sigunguCountAfter = countMatches(data.candidates, budgetValue)
    // "총 N곳" 배지 전용 — "N개 시군구에 걸쳐 있어요" 문구는 시군구 수 그대로 쓴다.
    const displayCountBefore = sigunguCountBefore * RECOMMENDED_PER_SIGUNGU
    const displayCountAfter = sigunguCountAfter * RECOMMENDED_PER_SIGUNGU

    return (
      <main className="flex flex-1 justify-center bg-neutral-50">
        <div className="w-full max-w-sm pb-40">
          <div className="sticky top-0 z-10 bg-neutral-50">
            <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/result`)} />
          </div>

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
                <span>총 {displayCountBefore}곳</span>
                <ArrowRight className="size-4" />
                <span>총 {displayCountAfter}곳</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
                <p className="mb-3 text-center text-title-sb font-bold text-neutral-900">우선순위</p>
                <div className="grid grid-cols-2 gap-3">
                  {[aOrder, bOrder].map((order, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      {order.map((code, rank) => (
                        <div
                          key={code}
                          className={cn(
                            'flex items-center gap-2 rounded-full border-2 bg-white px-4 py-2.5',
                            i === 0 ? 'border-pink-500' : 'border-accent-teal'
                          )}
                        >
                          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', rankBadgeClass(i === 0 ? 'A' : 'B'))}>
                            {rank + 1}
                          </span>
                          <span className="truncate text-body-sb font-bold text-neutral-900">
                            {CONDITION_LABEL[code]}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-title-sb font-bold text-neutral-900">예산 상한</span>
                  <span className="text-title-sb font-bold text-pink-500">{formatEok(budgetValue)}</span>
                </div>
                <Slider
                  value={[budgetValue]}
                  min={lowBudgetOriginal}
                  max={budgetSliderMax}
                  step={10_000_000}
                  // disabled
                  className="data-disabled:opacity-100"
                />
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
                    {sigunguCountAfter}
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
          <DecisionResultSheet open onOpenChange={() => {}} sessionId={sessionId} />
        )}
      </main>
    )
  }

  return (
    <main className="flex flex-1 justify-center bg-neutral-50">
      <div className="w-full max-w-sm pb-32">
        <div className="rounded-b-[60px] bg-neutral-100 px-4 pb-8">
          <div className="sticky top-0 z-10 -mx-4 bg-neutral-100 px-4">
            <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/result`)} />
          </div>

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

          {recommendation && !recommendationApplied && (
            <div className="mb-4 flex flex-col gap-4 rounded-[40px] border-2 border-pink-500 bg-white px-6 py-6">
              <p className="flex items-center gap-1.5 text-body-m font-bold text-pink-500">
                <Compass className="size-5" />
                추천 조정
              </p>
              <p className="text-body-m leading-[1.6] text-neutral-900">
                <span className="font-bold">{recommendation.role}의 예산 상한</span>이 낮아 후보가
                없었어요. 아래{' '}
                <span className="font-bold text-accent-teal">강조된 항목</span>처럼{' '}
                <span className="font-bold">{formatEok(recommendation.amount)}</span> 올리면{' '}
                <span className="font-bold text-pink-500">{recommendation.areaCount}곳</span>이
                열려요.
              </p>
              <button
                type="button"
                onClick={applyRecommendation}
                className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
              >
                추천대로 변경하기
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
              <p className="mb-1 text-center text-title-sb font-bold text-neutral-900">우선순위</p>
              <p className="mb-3 text-center text-caption-l text-neutral-400">
                위로 올릴수록 결과에 더 크게 반영돼요
              </p>
              {/* 상단 A/B 범례(A=왼쪽 고정, B=오른쪽 고정)와 순서를 맞춘다 — "내
                  조건"이 항상 왼쪽에 오면 B가 볼 때 범례와 어긋나 보인다. */}
              <div className="grid grid-cols-2 gap-3">
                {([['A', aOrder, setAOrder] as const, ['B', bOrder, setBOrder] as const]).map(
                  ([role, order, setOrder]) => (
                    <div key={role} className={cn('flex flex-col gap-1.5', me.role !== role && 'opacity-30')}>
                      {order.map((code, i) => (
                        <div
                          key={code}
                          className={cn(
                            'flex items-center gap-1.5 rounded-2xl border-2 bg-white px-3 py-2',
                            rankBorderClass(role)
                          )}
                        >
                          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', rankBadgeClass(role))}>
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-caption-l font-bold text-neutral-900">
                            {CONDITION_LABEL[code]}
                          </span>
                          {me.role === role && (
                            <div className="flex shrink-0 flex-col">
                              <button
                                type="button"
                                onClick={() => moveOrder(setOrder, i, -1)}
                                disabled={i === 0}
                                aria-label={`${CONDITION_LABEL[code]} 순위 올리기`}
                                className="text-neutral-400 disabled:opacity-20"
                              >
                                <ChevronUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveOrder(setOrder, i, 1)}
                                disabled={i === order.length - 1}
                                aria-label={`${CONDITION_LABEL[code]} 순위 내리기`}
                                className="text-neutral-400 disabled:opacity-20"
                              >
                                <ChevronDown className="size-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>

            <div
              ref={budgetCardRef}
              className={cn(
                'rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)] transition-all',
                highlightTarget === 'budget' && 'border-pink-500 ring-4 ring-pink-200'
              )}
            >
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
                // disabled={!iAmLowerBudget}
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
