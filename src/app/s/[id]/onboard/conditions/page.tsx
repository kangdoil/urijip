'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { OnboardStepDots } from '@/components/onboard-step-dots'
import { Button } from '@/components/ui/button'

const MUST_LIMIT = 2

interface Condition {
  code: string
  name: string
  descr: string | null
}

// Figma에서 내려받은 실제 아이콘은 '인프라'만 있다 — 나머지 조건은 기존 이모지를 그대로 쓴다.
const ICON_SRC: Record<string, string> = { infra: '/icons/infra.svg' }
const ICON_EMOJI: Record<string, string> = { area_size: '📐', build_year: '🏗️', infra: '🏥' }

type Tier = 'must' | 'nice' | 'skip'

const TIER_OPTIONS: { tier: Tier; label: string }[] = [
  { tier: 'must', label: '필수' },
  { tier: 'nice', label: '선호' },
  { tier: 'skip', label: '무관' },
]

const TIER_LABEL: Record<Tier, string> = { must: '필수', nice: '선호', skip: '무관' }

function tierButtonClass(selected: boolean) {
  if (!selected) return 'bg-neutral-100 text-neutral-900'
  return 'border-2 border-pink-500 bg-white text-pink-500'
}

export default function ConditionsStepPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [participantId, setParticipantId] = useState<string | null>(null)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState<{ code: string; tier: Tier }[]>([])
  const [override, setOverride] = useState<{ idx: number; tier: Tier } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const me = await getMyParticipant(supabase, sessionId)
      if (!me) {
        router.replace('/')
        return
      }
      if (me.completed_at) {
        router.replace(`/s/${sessionId}`)
        return
      }
      if (!me.budget_max_krw) {
        router.replace(`/s/${sessionId}/onboard/budget`)
        return
      }
      setParticipantId(me.id)

      const { data } = await supabase
        .from('conditions')
        .select('code, name, descr')
        .order('sort_order')
      setConditions(data ?? [])
      setReady(true)
    })()
  }, [sessionId, router])

  const current = conditions[idx]
  const isLast = idx + 1 >= conditions.length

  // 뒤로 돌아왔을 때 이미 고른 값이 있으면 그 값을 그대로 보여준다.
  const committedTier = results.find((r) => r.code === current?.code)?.tier ?? null
  const pendingTier = override && override.idx === idx ? override.tier : committedTier

  const mustCountExcludingCurrent = results.filter(
    (r) => r.tier === 'must' && r.code !== current?.code
  ).length

  function goBack() {
    if (idx > 0 && !done && !saving) {
      setError(null)
      setIdx(idx - 1)
    } else if (idx === 0 && !done && !saving) {
      router.push(`/s/${sessionId}/onboard/budget`)
    }
  }

  function pick(tier: Tier) {
    if (!current || saving) return
    if (tier === 'must' && mustCountExcludingCurrent >= MUST_LIMIT) {
      setError(`필수는 ${MUST_LIMIT}개까지만 고를 수 있어요`)
      setTimeout(() => setError(null), 1800)
      return
    }
    setError(null)
    setOverride({ idx, tier })
  }

  async function handleNext() {
    if (!participantId || !current || !pendingTier || saving) return

    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: upsertError } = await supabase
        .from('participant_conditions')
        .upsert(
          { participant_id: participantId, condition_code: current.code, tier: pendingTier },
          { onConflict: 'participant_id,condition_code' }
        )
      if (upsertError) throw upsertError

      setResults((prev) => {
        const existingIdx = prev.findIndex((r) => r.code === current.code)
        if (existingIdx >= 0) {
          const copy = [...prev]
          copy[existingIdx] = { code: current.code, tier: pendingTier }
          return copy
        }
        return [...prev, { code: current.code, tier: pendingTier }]
      })

      if (isLast) {
        const { error: completeError } = await supabase
          .from('participants')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', participantId)
        if (completeError) throw completeError
        setDone(true)
        setTimeout(() => router.push(`/s/${sessionId}`), 1200)
      } else {
        setIdx(idx + 1)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했어요')
    } finally {
      setSaving(false)
    }
  }

  if (!ready) return null

  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <div className="shrink-0 px-4">
        <OnboardBackBar onBack={goBack} disabled={done || idx === 0 || saving} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {done ? (
          <div className="flex flex-col items-center pt-16 text-center">
            <div className="mb-3 text-3xl" aria-hidden>
              ✅
            </div>
            <p className="mb-1 text-lg font-semibold text-neutral-900">분류 완료</p>
            <p className="text-sm text-neutral-500">
              상대의 입력이 끝나면 결과를 보여드릴게요
            </p>
          </div>
        ) : (
          current && (
            <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
                  이 조건, 얼마나 중요한가요?
                </h1>
                <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
                  {idx + 1}/{conditions.length}
                </p>
              </div>

              <div className="flex w-full flex-col items-center gap-6 rounded-3xl bg-white p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
                <div className="flex flex-col items-center gap-5">
                  <div className="flex size-20 items-center justify-center rounded-full bg-pink-100">
                    {ICON_SRC[current.code] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ICON_SRC[current.code]} alt="" className="h-[27px] w-[33px]" />
                    ) : (
                      <span className="text-3xl" aria-hidden>
                        {ICON_EMOJI[current.code] ?? '📋'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-3">
                    <h2 className="text-2xl leading-7 font-bold tracking-[-0.03em] text-neutral-900">
                      {current.name}
                    </h2>
                    <p className="text-center text-base leading-[1.4] text-neutral-500">
                      {current.descr}
                    </p>
                  </div>
                </div>

                <div className="flex w-full flex-col items-start gap-3">
                  {TIER_OPTIONS.map(({ tier, label }) => (
                    <button
                      key={tier}
                      onClick={() => pick(tier)}
                      disabled={saving}
                      className={`w-full rounded-full px-7 py-5 text-base font-bold transition-colors ${tierButtonClass(
                        pendingTier === tier
                      )}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-center text-sm text-red-600">{error}</p>}

              {results.length > 0 && (
                <div className="flex w-full flex-wrap justify-center gap-1.5 border-t border-neutral-200 pt-4">
                  {results.map((r) => (
                    <span
                      key={r.code}
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        r.tier === 'must'
                          ? 'bg-pink-50 text-pink-700'
                          : r.tier === 'nice'
                            ? 'bg-neutral-100 text-neutral-800'
                            : 'text-neutral-400'
                      }`}
                    >
                      {conditions.find((c) => c.code === r.code)?.name} · {TIER_LABEL[r.tier]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {!done && (
        <div className="shrink-0 px-4 pb-6">
          <div className="mb-4">
            <OnboardStepDots total={3} activeIndex={2} />
          </div>
          <Button
            onClick={handleNext}
            disabled={!pendingTier || saving}
            className="w-full font-montserrat text-mont-title-m"
          >
            {saving ? '저장하는 중...' : isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      )}
    </main>
  )
}
