/**
 * area_stats.mart_ok 갱신 스크립트.
 *
 * 소상공인시장진흥공단 "상가(상권)정보" 반경조회 API
 * (https://www.data.go.kr/data/15012005/openapi.do storeListInRadius)로
 * areas 테이블의 각 구역 대표 좌표에서 차량 10분 반경 이내에 마트(슈퍼마켓
 * 소분류, 대형마트 포함)가 하나라도 있으면 mart_ok = true로 판정한다.
 *
 * 상권업종 소분류에는 "대형마트"가 별도로 없고 이마트/홈플러스/롯데마트 같은
 * 대형마트와 동네 슈퍼가 모두 "슈퍼마켓"(indsSclsCd=G20404)으로 묶여있어,
 * 이 소분류 전체를 마트로 인정한다 (사용자 확인).
 *
 * 차량 라우팅 API가 아직 없어(ODsay는 대중교통 전용 — commute.ts 참고)
 * 직선거리로 근사한다. 애초 평균 차량속도 30km/h 가정으로 5km를 썼으나
 * "슈퍼마켓" 소분류가 대형마트 외 동네 슈퍼까지 넓게 잡혀 119개 구역 전부
 * 충족으로 나올 만큼 관대했다 — 판정력을 높이기 위해 3km로 좁혔다 (사용자 확인).
 *
 * 실행: npx tsx scripts/refresh-mart-stats.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_DATA_API_KEY
 */
import { createClient } from '@supabase/supabase-js'

const CAR_RADIUS_M = 3000 // 차량 10분 근사(직선거리), 5km 대비 판정력 강화
const MART_INDS_SCLS_CD = 'G20404' // 상권업종 소분류: 슈퍼마켓(대형마트 포함)
const REQUEST_DELAY_MS = 200

interface StoreApiResponse {
  header: { resultCode: string; resultMsg: string }
  body?: { totalCount: number }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 요청 제한에 걸리면 잠깐 쉬었다가 재시도한다 (commute.ts의 ODsay 재시도 패턴과 동일한 이유).
async function hasMartNearby(apiKey: string, lat: number, lng: number, maxRetries = 3): Promise<boolean> {
  const url = new URL('https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius')
  url.searchParams.set('serviceKey', apiKey)
  url.searchParams.set('cx', String(lng))
  url.searchParams.set('cy', String(lat))
  url.searchParams.set('radius', String(CAR_RADIUS_M))
  url.searchParams.set('indsSclsCd', MART_INDS_SCLS_CD)
  url.searchParams.set('numOfRows', '1')
  url.searchParams.set('type', 'json')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as StoreApiResponse
      if (data.header.resultCode === '00') {
        return (data.body?.totalCount ?? 0) > 0
      }
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`상가정보 API 조회에 실패했어요 (lat=${lat}, lng=${lng})`)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.PUBLIC_DATA_API_KEY
  if (!url || !serviceKey || !apiKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PUBLIC_DATA_API_KEY 환경변수가 필요해요'
    )
  }

  const supabase = createClient(url, serviceKey)
  const { data: areas, error: areasError } = await supabase.from('areas').select('code, lat, lng')
  if (areasError) throw areasError
  if (!areas || areas.length === 0) {
    console.log('areas 테이블이 비어있어요. scripts/seed-areas.ts를 먼저 실행하세요.')
    return
  }

  console.log(`구역 ${areas.length}곳의 마트 접근성 조회 중...`)
  const rows: { area_code: string; mart_ok: boolean; refreshed_at: string }[] = []

  for (const area of areas) {
    const martOk = await hasMartNearby(apiKey, area.lat, area.lng)
    rows.push({ area_code: area.code, mart_ok: martOk, refreshed_at: new Date().toISOString() })
    await sleep(REQUEST_DELAY_MS)
  }

  const { error: upsertError, count } = await supabase
    .from('area_stats')
    .upsert(rows, { onConflict: 'area_code', count: 'exact' })
  if (upsertError) throw upsertError

  const okCount = rows.filter((r) => r.mart_ok).length
  console.log(`area_stats.mart_ok 갱신 완료: ${count ?? rows.length}건 (충족 ${okCount}건 / 전체 ${rows.length}건)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
