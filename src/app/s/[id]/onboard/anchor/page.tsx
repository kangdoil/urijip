'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardStepHeader } from '@/components/onboard-step-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CATEGORIES = [
  { key: 'work', label: '직장' },
  { key: 'school', label: '학교' },
  { key: 'parents', label: '부모님 집' },
  { key: 'custom', label: '직접 입력' },
] as const

interface SearchResult {
  label: string
  address: string
  lat: number
  lng: number
}

export default function AnchorStepPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]['key']>('work')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  // 대중교통(ODsay)은 API 키 인증 문제로 당장 못 쓴다 — 자동차(카카오모빌리티)
  // 기준으로 전환했다 (commute.ts 주석 참고, PRD §5·§8도 함께 갱신).
  const mode = 'car' as const
  const [commuteMin, setCommuteMin] = useState(40)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    getMyParticipant(supabase, sessionId).then((me) => {
      if (!me) {
        router.replace('/')
        return
      }
      if (me.completed_at) {
        router.replace(`/s/${sessionId}`)
        return
      }
      if (me.anchor_label) {
        setQuery(me.anchor_label)
        if (me.anchor_lat != null && me.anchor_lng != null) {
          setSelected({
            label: me.anchor_label,
            address: '',
            lat: me.anchor_lat,
            lng: me.anchor_lng,
          })
        }
      }
      if (me.commute_max_min) setCommuteMin(me.commute_max_min)
      setReady(true)
    })
  }, [sessionId, router])

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([])
      return
    }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/kakao/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [query, selected])

  function pickResult(r: SearchResult) {
    setSelected(r)
    setQuery(r.label)
    setResults([])
  }

  async function handleNext() {
    if (!selected) {
      setError('목록에서 위치를 선택해주세요')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('로그인이 필요해요')

      const { error: updateError } = await supabase
        .from('participants')
        .update({
          anchor_label: selected.label,
          anchor_lat: selected.lat,
          anchor_lng: selected.lng,
          transport_mode: mode,
          commute_max_min: commuteMin,
        })
        .eq('session_id', sessionId)
        .eq('user_id', userData.user.id)
      if (updateError) throw updateError

      // 통근시간 배치(구역 수만큼 ODsay 순차 호출 — 152개 기준 실측 최대 141분)는
      // 서버가 응답을 보낸 뒤에도 after()로 계속 실행한다 (route.ts 참고) — 이
      // fetch 자체는 즉시 끝나므로 온보딩 진행을 막지 않는다. 완료 시각은
      // 서버가 participants.commute_batch_done_at에 직접 기록하고, 결과/조율
      // 화면이 그 값을 폴링해서 "아직 계산 중"과 "매칭 0건"을 구분한다.
      fetch('/api/odsay/batch-commute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originLat: selected.lat,
          originLng: selected.lng,
          mode,
          sessionId,
        }),
      }).catch(() => {
        // best-effort — 실패해도 온보딩은 막지 않는다.
      })

      router.push(`/s/${sessionId}/onboard/budget`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했어요')
      setLoading(false)
    }
  }

  if (!ready) return null

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[20px] border border-neutral-200 bg-white p-5 pb-6">
        <OnboardStepHeader step={1} total={3} label="거점·통근" />

        <p className="mb-1.5 text-lg font-medium text-neutral-900">
          자주 가는 곳이 어디예요?
        </p>
        <p className="mb-3.5 text-[13px] text-neutral-500">
          여기서 가까운 순서로 구역을 찾아드려요
        </p>

        <div className="mb-3 flex gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                category === c.key
                  ? 'border-2 border-primary-300 bg-primary-50 text-primary-600'
                  : 'border border-neutral-200 text-neutral-600'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="relative mb-3">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
            placeholder="예: 판교역 테크노밸리"
            className="rounded-[10px]"
          />
          {selected && (
            <p className="mt-1.5 text-[11px] text-primary-600">
              ✓ 위치를 선택했어요
            </p>
          )}
          {!selected && query.trim() && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[10px] border border-neutral-200 bg-white shadow-md">
              {searching && (
                <p className="px-3 py-2 text-xs text-neutral-400">검색 중...</p>
              )}
              {!searching && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-neutral-400">검색 결과가 없어요</p>
              )}
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => pickResult(r)}
                  className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                >
                  <p className="text-sm font-medium text-neutral-900">{r.label}</p>
                  <p className="text-xs text-neutral-500">{r.address}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-1 flex items-center gap-2.5">
          <span className="shrink-0 text-[13px] text-neutral-600">통근 상한</span>
          <input
            type="range"
            min={20}
            max={90}
            step={5}
            value={commuteMin}
            onChange={(e) => setCommuteMin(Number(e.target.value))}
            className="flex-1 accent-primary-500"
          />
          <span className="min-w-11 text-right text-sm font-medium text-neutral-900">
            {commuteMin}분
          </span>
        </div>
        <p className="mb-4 text-[11px] text-neutral-500">
          문에서 문까지, 자동차 기준이에요
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <Button onClick={handleNext} disabled={loading} className="w-full">
          {loading ? '저장하는 중...' : '다음'}
        </Button>
      </div>
    </main>
  )
}
