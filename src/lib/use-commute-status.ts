import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CommuteStatus {
  aReady: boolean
  bReady: boolean
}

// 통근시간 배치(온보딩 ①에서 백그라운드로 흘려보낸 ODsay 호출)가 두 참여자
// 모두 끝났는지 폴링한다. 아직이면 결과/조율 화면이 "매칭 0건"과 "계산 중"을
// 구분해서 보여줄 수 있게 한다. 둘 다 끝나면 폴링을 멈춘다.
export function useCommuteStatus(sessionId: string) {
  const [status, setStatus] = useState<CommuteStatus | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function check() {
      const { data, error } = await supabase.rpc('get_commute_status', { sid: sessionId })
      if (cancelled || error || !data) return
      const next = { aReady: data.a_ready, bReady: data.b_ready }
      setStatus(next)
      if (next.aReady && next.bReady && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    check()
    intervalRef.current = setInterval(check, 3000)

    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [sessionId])

  const ready = status ? status.aReady && status.bReady : false
  return { ready, status }
}
