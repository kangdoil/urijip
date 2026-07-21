'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { OnboardStepDots } from '@/components/onboard-step-dots'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { track, type Role } from '@/lib/mixpanel'

interface Condition {
  code: string
  name: string
  descr: string | null
}

const ICON_SRC: Record<string, string> = {
  area_size: '/asset/icon/m2.svg',
  build_year: '/asset/icon/calendar.svg',
  infra: '/asset/icon/infrastructure.svg',
}

// 1위 카드만 핑크 보더+그림자로 강조하고, 2·3위는 동일한 톤으로 묶는다
// (Figma: 무엇이 가장 중요한가요 프레임 — 순위별 크기 차등 없이 1위만 강조).
function badgeClass(rank: number) {
  return rank === 1
    ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-pink-500 text-[11.5px] font-extrabold text-white'
    : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-pink-100 text-[11.5px] font-extrabold text-pink-500'
}

function iconWrapClass(rank: number) {
  return rank === 1
    ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-pink-100'
    : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100'
}

function nameClass(rank: number) {
  return rank === 1
    ? 'text-base leading-6 font-bold text-neutral-900'
    : 'text-[15px] leading-[22.5px] font-bold text-neutral-900'
}

export default function ConditionsStepPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [participantId, setParticipantId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<Role | null>(null)
  const [myCreatedAt, setMyCreatedAt] = useState<string | null>(null)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragRef = useRef<{ code: string; startY: number } | null>(null)
  const [draggingCode, setDraggingCode] = useState<string | null>(null)

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
      setMyRole(me.role)
      setMyCreatedAt(me.created_at)

      const { data: condData } = await supabase
        .from('conditions')
        .select('code, name, descr')
        .order('sort_order')
      const list = condData ?? []
      setConditions(list)

      // 뒤로 돌아왔을 때 이미 매긴 순위가 있으면 그 순서를 그대로 보여준다.
      const { data: existing } = await supabase
        .from('participant_conditions')
        .select('condition_code, priority')
        .eq('participant_id', me.id)
        .order('priority')
      setOrder(
        existing && existing.length === list.length
          ? existing.map((r) => r.condition_code)
          : list.map((c) => c.code)
      )
      setReady(true)
    })()
  }, [sessionId, router])

  function moveIfCrossed(code: string, clientY: number) {
    const drag = dragRef.current
    if (!drag || drag.code !== code) return
    const el = cardRefs.current[code]
    if (!el) return
    const deltaY = clientY - drag.startY
    el.style.transform = `translateY(${deltaY}px)`

    const idx = order.indexOf(code)
    const rect = el.getBoundingClientRect()
    const mid = rect.top + rect.height / 2

    for (let i = 0; i < order.length; i++) {
      if (i === idx) continue
      const sibEl = cardRefs.current[order[i]]
      if (!sibEl) continue
      const sibMid = sibEl.getBoundingClientRect().top + sibEl.getBoundingClientRect().height / 2

      const crossedDown = deltaY > 0 && i > idx && mid > sibMid
      const crossedUp = deltaY < 0 && i < idx && mid < sibMid
      if (crossedDown || crossedUp) {
        const next = [...order]
        next.splice(idx, 1)
        next.splice(i, 0, code)
        setOrder(next)
        dragRef.current = { code, startY: clientY }
        el.style.transform = 'translateY(0px)'
        break
      }
    }
  }

  function handlePointerDown(code: string, e: ReactPointerEvent<HTMLDivElement>) {
    if (saving) return
    dragRef.current = { code, startY: e.clientY }
    setDraggingCode(code)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(code: string, e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.code !== code) return
    moveIfCrossed(code, e.clientY)
  }

  function endDrag(code: string) {
    const el = cardRefs.current[code]
    if (el) el.style.transform = ''
    dragRef.current = null
    setDraggingCode(null)
  }

  async function handleNext() {
    if (!participantId || saving || order.length !== conditions.length) return

    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: upsertError } = await supabase.from('participant_conditions').upsert(
        order.map((code, i) => ({
          participant_id: participantId,
          condition_code: code,
          priority: i + 1,
        })),
        { onConflict: 'participant_id,condition_code' }
      )
      if (upsertError) throw upsertError

      const { error: completeError } = await supabase
        .from('participants')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', participantId)
      if (completeError) throw completeError

      if (myRole && myCreatedAt) {
        const durationSec = Math.round((Date.now() - new Date(myCreatedAt).getTime()) / 1000)
        track('input_completed', { session_id: sessionId, role: myRole }, { duration_sec: durationSec })
      }

      router.push(`/s/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했어요')
      setSaving(false)
    }
  }

  if (!ready) return null

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col bg-neutral-50">
      <div className="sticky top-0 z-10 shrink-0 bg-neutral-50 px-4">
        <OnboardBackBar
          onBack={() => router.push(`/s/${sessionId}/onboard/budget`)}
          disabled={saving}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-[84px] pb-6">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
              무엇이 가장 중요한가요?
            </h1>
            <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
              위로 올릴수록 결과에 더 크게 반영돼요
            </p>
          </div>

          <div className="flex w-full flex-col gap-3">
            {order.map((code, i) => {
              const cond = conditions.find((c) => c.code === code)
              if (!cond) return null
              const rank = i + 1
              return (
                <div
                  key={code}
                  ref={(el) => {
                    cardRefs.current[code] = el
                  }}
                  onPointerDown={(e) => handlePointerDown(code, e)}
                  onPointerMove={(e) => handlePointerMove(code, e)}
                  onPointerUp={() => endDrag(code)}
                  onPointerCancel={() => endDrag(code)}
                  className={cn(
                    'flex touch-none items-center gap-3 rounded-xl border bg-white p-[15px] select-none',
                    draggingCode === code
                      ? 'z-20 cursor-grabbing shadow-[0_18px_36px_rgba(20,20,30,0.16)]'
                      : 'cursor-grab transition-[border-color,box-shadow,background-color] duration-300',
                    rank === 1
                      ? 'border-pink-500 drop-shadow-[0px_10px_10px_rgba(0,0,0,0.04)]'
                      : 'border-neutral-100'
                  )}
                >
                  <span className={badgeClass(rank)}>{rank}</span>
                  <span className={iconWrapClass(rank)} aria-hidden>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ICON_SRC[code]} alt="" className="size-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block', nameClass(rank))}>{cond.name}</span>
                    <span className="mt-0.5 block text-[13px] leading-[1.4] text-neutral-500">
                      {cond.descr}
                    </span>
                  </span>
                  <span className="shrink-0 p-1 text-lg tracking-[2px] text-neutral-300" aria-hidden>
                    ⠿
                  </span>
                </div>
              )
            })}
          </div>

          <div className="h-px w-[294px] bg-neutral-100" />

          <p className="text-center text-[13px] text-neutral-500">카드를 눌러서 위아래로 옮겨보세요</p>

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-6">
        <div className="mb-4">
          <OnboardStepDots total={3} activeIndex={2} />
        </div>
        <Button
          onClick={handleNext}
          disabled={saving || order.length !== conditions.length}
          className="w-full font-montserrat text-mont-title-m"
        >
          {saving ? '저장하는 중...' : 'Next'}
        </Button>
      </div>
    </main>
  )
}
