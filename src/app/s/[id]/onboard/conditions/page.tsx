'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardStepHeader } from '@/components/onboard-step-header'

const MUST_LIMIT = 2

interface Condition {
  code: string
  name: string
  descr: string | null
}

const ICON: Record<string, string> = {
  area_size: '📐',
  build_year: '🏗️',
  infra: '🏥',
}

type Tier = 'must' | 'nice' | 'skip'
const TIER_LABEL: Record<Tier, string> = { must: '필수', nice: '선호', skip: '무관' }

export default function ConditionsStepPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [participantId, setParticipantId] = useState<string | null>(null)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState<{ code: string; tier: Tier }[]>([])
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
  const currentTier = results.find((r) => r.code === current?.code)?.tier ?? null
  const mustCountExcludingCurrent = results.filter(
    (r) => r.tier === 'must' && r.code !== current?.code
  ).length
  const mustCount = results.filter((r) => r.tier === 'must').length

  function goBack() {
    if (idx > 0 && !done && !saving) {
      setError(null)
      setIdx(idx - 1)
    }
  }

  async function pick(tier: Tier) {
    if (!participantId || !current || saving) return

    if (tier === 'must' && mustCountExcludingCurrent >= MUST_LIMIT) {
      setError(`필수는 ${MUST_LIMIT}개까지만 고를 수 있어요`)
      setTimeout(() => setError(null), 1800)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: upsertError } = await supabase
        .from('participant_conditions')
        .upsert(
          { participant_id: participantId, condition_code: current.code, tier },
          { onConflict: 'participant_id,condition_code' }
        )
      if (upsertError) throw upsertError

      setResults((prev) => {
        const existingIdx = prev.findIndex((r) => r.code === current.code)
        if (existingIdx >= 0) {
          const copy = [...prev]
          copy[existingIdx] = { code: current.code, tier }
          return copy
        }
        return [...prev, { code: current.code, tier }]
      })

      if (idx + 1 >= conditions.length) {
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
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[20px] border border-neutral-200 bg-white p-5 pb-6">
        <OnboardStepHeader step={3} total={3} label="조건 분류" />

        <div className="mb-3 flex items-center gap-2">
          {!done && idx > 0 && (
            <button
              onClick={goBack}
              disabled={saving}
              className="-ml-1 flex items-center gap-0.5 rounded-full px-1.5 py-1 text-sm text-neutral-500 hover:text-neutral-800"
              aria-label="이전 조건으로"
            >
              ←
            </button>
          )}
          <p className="text-[15px] font-medium text-neutral-900">
            이 조건, 얼마나 중요해요?
          </p>
          {!done && conditions.length > 0 && (
            <span className="ml-auto text-xs text-neutral-400">
              조건 {idx + 1}/{conditions.length}
            </span>
          )}
        </div>

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-5 py-6 text-center">
          {done ? (
            <>
              <div className="mb-2 text-2xl" aria-hidden>
                ✅
              </div>
              <p className="mb-1 text-lg font-medium text-neutral-900">분류 완료</p>
              <p className="text-[13px] text-neutral-500">
                상대의 입력이 끝나면 결과를 보여드릴게요
              </p>
            </>
          ) : (
            current && (
              <>
                <div className="text-2xl" aria-hidden>
                  {ICON[current.code] ?? '📋'}
                </div>
                <p className="mb-1 mt-2 text-lg font-medium text-neutral-900">
                  {current.name}
                </p>
                <p className="text-[13px] text-neutral-500">{current.descr}</p>
              </>
            )
          )}
        </div>

        {!done && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => pick('must')}
                disabled={saving}
                className={`rounded-[10px] border px-1 py-3 text-sm font-medium transition-colors ${
                  currentTier === 'must'
                    ? 'border-2 border-primary-400 bg-primary-50 text-primary-700'
                    : 'border-primary-200 bg-primary-50 text-primary-700'
                }`}
              >
                필수
                <br />
                <span className="text-[11px] font-normal text-primary-500">
                  포기 못 해요
                </span>
              </button>
              <button
                onClick={() => pick('nice')}
                disabled={saving}
                className={`rounded-[10px] border px-1 py-3 text-sm font-medium transition-colors ${
                  currentTier === 'nice'
                    ? 'border-2 border-neutral-400 text-neutral-900'
                    : 'border-neutral-200 text-neutral-800'
                }`}
              >
                선호
                <br />
                <span className="text-[11px] font-normal text-neutral-500">
                  있으면 좋아요
                </span>
              </button>
              <button
                onClick={() => pick('skip')}
                disabled={saving}
                className={`rounded-[10px] border px-1 py-3 text-sm font-medium transition-colors ${
                  currentTier === 'skip'
                    ? 'border-2 border-neutral-300 text-neutral-600'
                    : 'border-neutral-100 text-neutral-500'
                }`}
              >
                무관
                <br />
                <span className="text-[11px] font-normal text-neutral-400">
                  상관없어요
                </span>
              </button>
            </div>

            <div className="mb-3.5 flex items-center gap-1.5">
              <span className="text-xs text-neutral-500">필수 슬롯</span>
              {Array.from({ length: MUST_LIMIT }).map((_, i) => (
                <span
                  key={i}
                  className={`inline-flex h-5.5 w-5.5 items-center justify-center rounded-md border border-dashed text-xs ${
                    i < mustCount
                      ? 'border-primary-300 bg-primary-50 text-primary-600'
                      : 'border-neutral-300'
                  }`}
                >
                  {i < mustCount ? '✓' : ''}
                </span>
              ))}
              <span className="ml-1 text-xs text-neutral-400">
                최대 {MUST_LIMIT}개
              </span>
            </div>
          </>
        )}

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-1.5 border-t border-neutral-100 pt-3">
          {results.map((r) => (
            <span
              key={r.code}
              className={`rounded-full px-2.5 py-1 text-xs ${
                r.tier === 'must'
                  ? 'bg-primary-50 text-primary-700'
                  : r.tier === 'nice'
                    ? 'bg-neutral-100 text-neutral-800'
                    : 'text-neutral-400'
              }`}
            >
              {conditions.find((c) => c.code === r.code)?.name} · {TIER_LABEL[r.tier]}
            </span>
          ))}
        </div>
      </div>
    </main>
  )
}
