import { cache } from 'react'
import { createPublicClient } from '@/lib/supabase/server'

export interface InvitePreview {
  inviter_name: string | null
  status: string | null
}

// generateMetadata와 페이지 본문이 같은 초대 코드를 두 번 조회하지 않도록 메모이즈한다.
export const getInvitePreview = cache(async (code: string) => {
  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('get_invite_preview', { code })
  if (error || !data) return null
  return data as InvitePreview
})
