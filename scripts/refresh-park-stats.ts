/**
 * area_stats.park_ok 갱신 스크립트.
 *
 * 공공데이터포털 "전국도시공원정보표준데이터" API
 * (https://www.data.go.kr/data/15012890/standard.do) 전체를 페이지네이션으로
 * 내려받은 뒤, areas 테이블의 각 구역 대표 좌표에서 도보 10분(반경 800m) 이내에
 * 공원이 하나라도 있으면 park_ok = true로 판정해 area_stats에 저장한다.
 *
 * area_stats는 mart_ok/hospital_ok/park_ok를 각각 별도 API로 채우는 구조라
 * (ROADMAP "인프라 3항목" 참고) 이 스크립트는 park_ok만 갱신하고 나머지
 * 컬럼은 건드리지 않는다.
 *
 * 실행: npx tsx scripts/refresh-park-stats.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_DATA_API_KEY
 * (area_stats는 RLS상 service role 쓰기만 허용되어 있어 anon 키로는 실행할 수 없다.)
 */
import { createClient } from '@supabase/supabase-js'

const WALK_RADIUS_M = 800 // 도보 10분 ≈ 분속 80m 기준
const PAGE_SIZE = 1000
const REQUEST_DELAY_MS = 300

interface ParkRow {
  parkNm: string
  latitude: string
  longitude: string
}

interface ParkApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string }
    body?: { items: ParkRow[]; totalCount: string; numOfRows: string; pageNo: string }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 하버사인 거리(m). 두 좌표 간 대권 거리를 구해 도보 반경 판정에 쓴다.
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 요청 제한(LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS 등)에 걸리면
// 잠깐 쉬었다가 재시도한다. commute.ts의 ODsay 재시도 패턴과 동일한 이유.
async function fetchParkPage(
  apiKey: string,
  pageNo: number,
  maxRetries = 3
): Promise<{ items: ParkRow[]; totalCount: number }> {
  const url = new URL('https://api.data.go.kr/openapi/tn_pubr_public_cty_park_info_api')
  url.searchParams.set('serviceKey', apiKey)
  url.searchParams.set('pageNo', String(pageNo))
  url.searchParams.set('numOfRows', String(PAGE_SIZE))
  url.searchParams.set('type', 'json')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as ParkApiResponse
      if (data.response.header.resultCode === '00' && data.response.body) {
        return {
          items: data.response.body.items ?? [],
          totalCount: Number(data.response.body.totalCount),
        }
      }
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`도시공원 API ${pageNo}페이지 조회에 실패했어요`)
}

async function fetchAllParks(apiKey: string) {
  const first = await fetchParkPage(apiKey, 1)
  const parks = [...first.items]

  const totalPages = Math.ceil(first.totalCount / PAGE_SIZE)
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    await sleep(REQUEST_DELAY_MS)
    const page = await fetchParkPage(apiKey, pageNo)
    parks.push(...page.items)
  }

  return parks
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
  const { data: areas, error: areasError } = await supabase
    .from('areas')
    .select('code, lat, lng')
  if (areasError) throw areasError
  if (!areas || areas.length === 0) {
    console.log('areas 테이블이 비어있어요. scripts/seed-areas.ts를 먼저 실행하세요.')
    return
  }

  console.log('도시공원 데이터 전체 조회 중...')
  const rawParks = await fetchAllParks(apiKey)
  const parks = rawParks
    .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  console.log(`공원 ${rawParks.length}건 중 좌표 유효 ${parks.length}건`)

  const rows = areas.map((area) => {
    const parkOk = parks.some(
      (park) => distanceMeters(area.lat, area.lng, park.lat, park.lng) <= WALK_RADIUS_M
    )
    return { area_code: area.code, park_ok: parkOk, refreshed_at: new Date().toISOString() }
  })

  const { error: upsertError, count } = await supabase
    .from('area_stats')
    .upsert(rows, { onConflict: 'area_code', count: 'exact' })
  if (upsertError) throw upsertError

  const okCount = rows.filter((r) => r.park_ok).length
  console.log(`area_stats.park_ok 갱신 완료: ${count ?? rows.length}건 (충족 ${okCount}건 / 전체 ${rows.length}건)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
