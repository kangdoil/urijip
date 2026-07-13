import type { SupabaseClient } from '@supabase/supabase-js'

// 익명 세션이 없으면 새로 만든다. AuthBoot가 대부분 미리 처리해두지만,
// 페이지 진입 직후처럼 레이스가 발생할 수 있는 지점에서 안전장치로 다시 호출한다.
export async function ensureAnonSession(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session

  const { data: signInData, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return signInData.session
}
