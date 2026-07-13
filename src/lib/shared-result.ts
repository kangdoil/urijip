import { cache } from 'react'
import { createPublicClient } from '@/lib/supabase/server'

export interface SharedArea {
  name: string
  sigungu: string
  avg_price_krw: number | null
  built_year_avg: number | null
}

export interface SharedResult {
  areas: SharedArea[]
}

export const getSharedResult = cache(async (slug: string) => {
  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('get_shared_result', { slug })
  if (error || !data) return null
  return data as SharedResult
})
