import type { SupabaseClient } from '@supabase/supabase-js'

export interface MyParticipant {
  id: string
  role: 'A' | 'B'
  display_name: string | null
  anchor_label: string | null
  anchor_lat: number | null
  anchor_lng: number | null
  transport_mode: 'transit' | 'car' | null
  commute_max_min: number | null
  budget_max_krw: number | null
  completed_at: string | null
}

export async function getMyParticipant(
  supabase: SupabaseClient,
  sessionId: string
): Promise<MyParticipant | null> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('participants')
    .select(
      'id, role, display_name, anchor_label, anchor_lat, anchor_lng, transport_mode, commute_max_min, budget_max_krw, completed_at'
    )
    .eq('session_id', sessionId)
    .eq('user_id', userData.user.id)
    .single()

  return data
}
