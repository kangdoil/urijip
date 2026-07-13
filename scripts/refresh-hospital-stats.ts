/**
 * area_stats.hospital_ok 갱신 스크립트.
 *
 * 건강보험심사평가원 "병원정보서비스" 좌표 반경조회 API
 * (https://opendata.hira.or.kr, hospInfoServicev2/getHospBasisList)로
 * areas 테이블의 각 구역 대표 좌표에서 차량 20분 반경 이내에 종합병원(clCd=11)
 * 또는 상급종합병원(clCd=01)이 하나라도 있으면 hospital_ok = true로 판정한다.
 * 상급종합은 종합병원 요건을 상회하는 상위 등급이라 함께 인정한다 (사용자 확인).
 *
 * API가 clCd에 콤마 구분 다중값을 지원하지 않아(실측 확인 — totalCount 0으로
 * 무시됨) 등급별로 각각 조회한다.
 *
 * 차량 라우팅 API가 아직 없어(ODsay는 대중교통 전용 — commute.ts 참고)
 * 평균 차량속도 30km/h 가정의 직선거리로 근사한다 (사용자 확인):
 * 20분 → 10km 반경.
 *
 * 실행: npx tsx scripts/refresh-hospital-stats.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_DATA_API_KEY
 */
import { createClient } from '@supabase/supabase-js'

const CAR_RADIUS_M = 10000 // 차량 20분 ≈ 평균 30km/h 가정
const HOSPITAL_CL_CODES = ['01', '11'] // 01: 상급종합, 11: 종합병원
const REQUEST_DELAY_MS = 200

interface HospitalApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string }
    body?: { totalCount: number }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 요청 제한에 걸리면 잠깐 쉬었다가 재시도한다 (commute.ts의 ODsay 재시도 패턴과 동일한 이유).
async function countHospitalsNearby(
  apiKey: string,
  clCd: string,
  lat: number,
  lng: number,
  maxRetries = 3
): Promise<number> {
  const url = new URL('https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList')
  url.searchParams.set('serviceKey', apiKey)
  url.searchParams.set('clCd', clCd)
  url.searchParams.set('xPos', String(lng))
  url.searchParams.set('yPos', String(lat))
  url.searchParams.set('radius', String(CAR_RADIUS_M))
  url.searchParams.set('numOfRows', '1')
  url.searchParams.set('pageNo', '1')
  url.searchParams.set('_type', 'json')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as HospitalApiResponse
      if (data.response.header.resultCode === '00') {
        return data.response.body?.totalCount ?? 0
      }
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`병원정보 API 조회에 실패했어요 (clCd=${clCd}, lat=${lat}, lng=${lng})`)
}

async function hasHospitalNearby(apiKey: string, lat: number, lng: number) {
  for (const clCd of HOSPITAL_CL_CODES) {
    const count = await countHospitalsNearby(apiKey, clCd, lat, lng)
    if (count > 0) return true
    await sleep(REQUEST_DELAY_MS)
  }
  return false
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

  console.log(`구역 ${areas.length}곳의 병원 접근성 조회 중...`)
  const rows: { area_code: string; hospital_ok: boolean; refreshed_at: string }[] = []

  for (const area of areas) {
    const hospitalOk = await hasHospitalNearby(apiKey, area.lat, area.lng)
    rows.push({ area_code: area.code, hospital_ok: hospitalOk, refreshed_at: new Date().toISOString() })
    await sleep(REQUEST_DELAY_MS)
  }

  const { error: upsertError, count } = await supabase
    .from('area_stats')
    .upsert(rows, { onConflict: 'area_code', count: 'exact' })
  if (upsertError) throw upsertError

  const okCount = rows.filter((r) => r.hospital_ok).length
  console.log(`area_stats.hospital_ok 갱신 완료: ${count ?? rows.length}건 (충족 ${okCount}건 / 전체 ${rows.length}건)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
