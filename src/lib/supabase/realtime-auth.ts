import type { SupabaseClient } from '@supabase/supabase-js'

// @supabase/ssr의 브라우저 클라이언트는 Realtime 소켓에 사용자 JWT를 자동으로
// 연결해주지 않는다 — RLS가 걸린 테이블의 postgres_changes를 구독하기 전에
// 반드시 이 함수로 인증을 붙여야 한다. 안 붙이면 채널 상태는 SUBSCRIBED로
// 뜨지만 이벤트가 조용히(에러 없이) 전달되지 않는다 (실측으로 확인됨).
export async function ensureRealtimeAuth(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    supabase.realtime.setAuth(data.session.access_token)
  }
}
