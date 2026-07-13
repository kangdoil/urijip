'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { Button } from '@/components/ui/button'

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
  // 아직 저장 전이어도 지금 고른 값이 필수면 슬롯에 바로 반영해서 보여준다.
  const mustCount = mustCountExcludingCurrent + (pendingTier === 'must' ? 1 : 0)

  function goBack() {
    if (idx > 0 && !done && !saving) {
      setError(null)
      setIdx(idx - 1)
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

  const progressPct = done ? 100 : conditions.length > 0 ? ((idx + (pendingTier ? 1 : 0)) / conditions.length) * 100 : 0

  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <div className="shrink-0 px-5 pt-4">
        <div className="mb-3 grid grid-cols-[32px_1fr_32px] items-center">
          <button
            onClick={goBack}
            disabled={done || idx === 0 || saving}
            aria-label="이전 조건으로"
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-neutral-500 transition-opacity disabled:opacity-0"
          >
            ←
          </button>
          <p className="truncate text-center text-[16px] font-semibold text-neutral-900">
            {done ? '분류 완료' : (current?.name ?? '')}
          </p>
          <span aria-hidden />
        </div>
        <div className="h-1 rounded-full bg-neutral-200">
          <div
            className="h-1 rounded-full bg-primary-500 transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-10 pb-6">
        {done ? (
          <div className="flex flex-col items-center pt-10 text-center">
            <div className="mb-3 text-3xl" aria-hidden>
              ✅
            </div>
            <p className="mb-1 text-lg font-semibold text-neutral-900">분류 완료</p>
            <p className="text-[13px] text-neutral-500">
              상대의 입력이 끝나면 결과를 보여드릴게요
            </p>
          </div>
        ) : (
          current && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="text-3xl" aria-hidden>
                  {ICON[current.code] ?? '📋'}
                </div>
                <p className="mt-3 mb-1 text-lg font-semibold text-neutral-900">
                  이 조건, 얼마나 중요해요?
                </p>
                <p className="text-[13px] text-neutral-500">{current.descr}</p>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-2">
                <button
                  onClick={() => pick('must')}
                  disabled={saving}
                  className={`rounded-[12px] border px-1 py-3 text-sm font-medium transition-colors ${
                    pendingTier === 'must'
                      ? 'border-2 border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-primary-200 bg-primary-50/60 text-primary-700'
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
                  className={`rounded-[12px] border px-1 py-3 text-sm font-medium transition-colors ${
                    pendingTier === 'nice'
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
                  className={`rounded-[12px] border px-1 py-3 text-sm font-medium transition-colors ${
                    pendingTier === 'skip'
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

              <div className="mt-5 flex items-center gap-1.5">
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
                <span className="ml-1 text-xs text-neutral-400">최대 {MUST_LIMIT}개</span>
              </div>
            </>
          )
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {results.length > 0 && !done && (
          <div className="mt-6 flex flex-wrap gap-1.5 border-t border-neutral-200 pt-4">
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
        )}
      </div>

      {!done && (
        <div className="shrink-0 px-5 pb-6 pt-2">
          <Button
            onClick={handleNext}
            disabled={!pendingTier || saving}
            className="h-11 w-full rounded-[12px] bg-primary-500 text-[14px] font-semibold hover:bg-primary-600"
          >
            {saving ? '저장하는 중...' : isLast ? '완료' : '다음'}
          </Button>
        </div>
      )}
    </main>
  )
}
