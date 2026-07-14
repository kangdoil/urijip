'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardBackBar } from '@/components/onboard-back-bar'
import { OnboardStepDots } from '@/components/onboard-step-dots'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'

const EOK = 100_000_000 // 1억 = 원 단위

export default function BudgetStepPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [budgetEok, setBudgetEok] = useState(5)
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
      if (!me.anchor_label) {
        router.replace(`/s/${sessionId}/onboard/anchor`)
        return
      }
      if (me.budget_max_krw) setBudgetEok(me.budget_max_krw / EOK)
      setReady(true)
    })
  }, [sessionId, router])

  async function handleNext() {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('로그인이 필요해요')

      const { error: updateError } = await supabase
        .from('participants')
        .update({ budget_max_krw: Math.round(budgetEok * EOK) })
        .eq('session_id', sessionId)
        .eq('user_id', userData.user.id)
      if (updateError) throw updateError

      router.push(`/s/${sessionId}/onboard/conditions`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했어요')
      setLoading(false)
    }
  }

  if (!ready) return null

  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <div className="shrink-0 px-4">
        <OnboardBackBar onBack={() => router.push(`/s/${sessionId}/onboard/anchor`)} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-6">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
              예상 상한은 얼마인가요?
            </h1>
            <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
              예산은 나중에 언제든지 변경할 수 있어요
            </p>
          </div>

          <div className="flex w-full flex-col items-center gap-6 rounded-3xl bg-white p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
            <div className="flex size-20 items-center justify-center rounded-full bg-pink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/budget.svg" alt="" className="h-[25px] w-[27px]" />
            </div>

            <div className="flex items-baseline gap-1">
              <span className="font-montserrat text-[64px] leading-[64px] font-extrabold tracking-[-1.6px] text-pink-400">
                {budgetEok.toFixed(1)}
              </span>
              <span className="font-sans text-2xl leading-8 font-medium tracking-[-0.01em] text-pink-400">
                억
              </span>
            </div>

            <div className="flex w-full flex-col items-start gap-0">
              <Slider
                value={[budgetEok]}
                onValueChange={([v]) => setBudgetEok(v)}
                min={2}
                max={15}
                step={0.5}
              />
              <div className="mt-2 flex w-full items-center justify-between px-2">
                <span className="text-sm font-semibold text-neutral-900">2억</span>
                <span className="text-sm font-semibold text-neutral-900">15억</span>
              </div>
            </div>

            <div className="h-px w-full bg-neutral-100" />

            <p className="text-center text-body-s text-neutral-500">
              두 분의 상한이 다르면 낮은 쪽을 기본으로
              <br />
              동네를 추천해요
            </p>
          </div>
        </div>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>

      <div className="shrink-0 px-4 pb-6">
        <div className="mb-4">
          <OnboardStepDots total={3} activeIndex={1} />
        </div>
        <Button
          onClick={handleNext}
          disabled={loading}
          className="w-full font-montserrat text-mont-title-m"
        >
          {loading ? '저장하는 중...' : 'Next'}
        </Button>
      </div>
    </main>
  )
}
