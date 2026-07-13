'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// 앱 최초 진입 시 익명 세션을 보장한다.
// B는 가입 없이 초대 링크만으로 참여해야 하므로, 로그인 화면 없이
// 백그라운드에서 signInAnonymously를 먼저 실행해둔다.
export function AuthBoot() {
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        supabase.auth.signInAnonymously()
      }
    })
  }, [])

  return null
}
