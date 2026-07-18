'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackPageview } from '@/lib/mixpanel'

function PageviewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    trackPageview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams.toString()])

  return null
}

// useSearchParams는 정적 렌더링 중 값을 알 수 없어 Suspense 경계가 필수다
// (없으면 페이지 전체가 강제로 클라이언트 렌더링으로 빠진다).
export function MixpanelPageview() {
  return (
    <Suspense fallback={null}>
      <PageviewTracker />
    </Suspense>
  )
}
