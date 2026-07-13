'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMyParticipant } from '@/lib/get-my-participant'
import { OnboardStepHeader } from '@/components/onboard-step-header'
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
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[20px] border border-neutral-200 bg-white p-5 pb-6">
        <OnboardStepHeader step={2} total={3} label="예산 상한" />

        <p className="mb-1.5 text-lg font-medium text-neutral-900">
          예산 상한이 얼마예요?
        </p>
        <p className="mb-5 text-[13px] text-neutral-500">
          두 분의 상한이 다르면 낮은 쪽을 기본으로 맞추고, 충돌로 표시해드려요
        </p>

        <div className="mb-2 rounded-xl border border-neutral-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">
              <span aria-hidden>💰</span> 예산 상한
            </span>
            <span className="text-lg font-semibold text-primary-600">
              {budgetEok.toFixed(1)}억
            </span>
          </div>
          <input
            type="range"
            min={2}
            max={15}
            step={0.5}
            value={budgetEok}
            onChange={(e) => setBudgetEok(Number(e.target.value))}
            className="w-full accent-primary-500"
          />
          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
            <span>2억</span>
            <span>15억</span>
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <Button onClick={handleNext} disabled={loading} className="mt-3 w-full">
          {loading ? '저장하는 중...' : '다음'}
        </Button>
      </div>
    </main>
  )
}
