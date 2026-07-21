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

// 순위가 위로 갈수록(1위) 더 크고 진하게 — "위로 올릴수록 더 크게 반영돼요"를
// 카드 자체의 시각적 무게로도 보여준다(목업에서 확정한 시그니처 인터랙션).
function badgeClass(rank: number) {
  if (rank === 1) {
    return 'flex size-[30px] shrink-0 items-center justify-center rounded-full bg-pink-500 text-sm font-extrabold text-white'
  }
  if (rank === 2) {
    return 'flex size-[26px] shrink-0 items-center justify-center rounded-full bg-pink-100 text-[12.5px] font-extrabold text-pink-500'
  }
  return 'flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11.5px] font-extrabold text-neutral-600'
}

function iconWrapClass(rank: number) {
  if (rank === 1) return 'flex size-11 shrink-0 items-center justify-center rounded-full bg-pink-100'
  if (rank === 2) return 'flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100'
  return 'flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200'
}

function iconImgClass(rank: number) {
  if (rank === 1) return 'size-6'
  if (rank === 2) return 'size-[22px]'
  return 'size-5'
}

function nameClass(rank: number) {
  if (rank === 1) return 'text-base font-bold text-neutral-900'
  if (rank === 2) return 'text-[15px] font-bold text-neutral-900'
  return 'text-[14.5px] font-bold text-neutral-600'
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
  const [done, setDone] = useState(false)
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

      setDone(true)
      setTimeout(() => router.push(`/s/${sessionId}`), 1200)
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
          disabled={done || saving}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {done ? (
          <div className="flex flex-col items-center pt-16 text-center">
            <div className="mb-3 text-3xl" aria-hidden>
              ✅
            </div>
            <p className="mb-1 text-lg font-semibold text-neutral-900">분류 완료</p>
            <p className="text-sm text-neutral-500">상대의 입력이 끝나면 결과를 보여드릴게요</p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
                무엇이 더 중요한가요?
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
                      'flex touch-none items-center gap-3 rounded-3xl border-[1.5px] border-neutral-100 bg-white p-3.5 shadow-[0_10px_20px_rgba(0,0,0,0.04)] select-none',
                      draggingCode === code
                        ? 'z-20 cursor-grabbing shadow-[0_18px_36px_rgba(20,20,30,0.16)]'
                        : 'cursor-grab transition-[border-color,box-shadow,background-color] duration-300',
                      rank === 1 && 'border-pink-500 shadow-[0_12px_24px_rgba(255,77,139,0.14)]',
                      rank === 3 && 'bg-neutral-50'
                    )}
                  >
                    <span className={badgeClass(rank)}>{rank}</span>
                    <span className={iconWrapClass(rank)} aria-hidden>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ICON_SRC[code]} alt="" className={iconImgClass(rank)} />
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

            <p className="text-center text-[13px] text-neutral-500">카드를 눌러서 위아래로 옮겨보세요</p>

            {error && <p className="text-center text-sm text-red-600">{error}</p>}
          </div>
        )}
      </div>

      {!done && (
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
      )}
    </main>
  )
}
