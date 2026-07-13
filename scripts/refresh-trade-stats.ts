/**
 * area_stats.{avg_price_krw, built_year_avg, size_59_ok} 갱신 스크립트.
 *
 * 국토교통부 "아파트매매 실거래자료" API(RTMSDataSvcAptTradeDev)로 최근 6개월
 * 거래를 모아 예산·년식·평형 세 조건을 한 번에 채운다. 응답에 거래금액
 * (dealAmount)·건축년도(buildYear)·전용면적(excluUseAr)이 모두 들어있어,
 * 년식은 별도 건축물대장 API(지번 단위 개별 조회라 구역 전체 집계에 비효율적)
 * 없이 이 API만으로 처리한다 (사용자 확인).
 *
 * area_stats.size_59_ok는 matching_engine.sql이 이미 참조하고 있었지만 채우는
 * 배치가 없었다 (컬럼만 존재). 판정 기준: 최근 6개월 거래 중 전용면적 59㎡
 * 이상 비중이 과반(50%) 이상이면 충족 (사용자 확인).
 *
 * 데이터 해상도 한계: 이 API는 법정동(umdNm) 단위까지만 구분되고 행정동
 * 단위가 아니다. "정자1동/정자2동/정자3동" 같은 행정동은 모두 법정동
 * "정자동"의 거래로 근사한다 (행정동명 끝의 숫자를 제거해 법정동명을 추정 —
 * 일반적인 행정동 명명 규칙이라 지역 하드코딩이 아니다). 해당 법정동에
 * 거래가 없으면 시군구 전체 평균으로 폴백한다.
 *
 * LAWD_CD(시군구 코드) 매핑은 data/sigungu-lawd-codes.json에서 가져온다
 * (CLAUDE.md 절대 규칙 — 지역 하드코딩 금지: 코드에는 지역명을 적지 않는다).
 *
 * 실행: npx tsx scripts/refresh-trade-stats.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_DATA_API_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TRADE_MONTHS = 6
const SIZE_THRESHOLD_M2 = 59
const REQUEST_DELAY_MS = 200

interface TradeItem {
  umdNm: string
  dealAmount: string
  excluUseAr: number
  buildYear: number
}

interface TradeApiResponse {
  response: {
    header: { resultCode: string; resultMsg: string }
    body?: { items: { item?: TradeItem[] | TradeItem }; totalCount: number; numOfRows: number }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 최근 6개월(현재월 포함) YYYYMM 목록. 매번 실행 시점 기준으로 계산해
// 특정 날짜를 코드에 박아두지 않는다.
function recentMonths(count: number): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

// 요청 제한에 걸리면 잠깐 쉬었다가 재시도한다 (commute.ts의 ODsay 재시도 패턴과 동일한 이유).
async function fetchTradePage(
  apiKey: string,
  lawdCd: string,
  dealYmd: string,
  pageNo: number,
  maxRetries = 3
): Promise<{ items: TradeItem[]; totalCount: number }> {
  const url = new URL('https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev')
  url.searchParams.set('serviceKey', apiKey)
  url.searchParams.set('LAWD_CD', lawdCd)
  url.searchParams.set('DEAL_YMD', dealYmd)
  url.searchParams.set('pageNo', String(pageNo))
  url.searchParams.set('numOfRows', '1000')
  url.searchParams.set('_type', 'json')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.ok) {
      const data = (await res.json()) as TradeApiResponse
      if (data.response.header.resultCode === '000') {
        const raw = data.response.body?.items.item ?? []
        const items = Array.isArray(raw) ? raw : [raw]
        return { items, totalCount: data.response.body?.totalCount ?? items.length }
      }
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`실거래가 API 조회에 실패했어요 (LAWD_CD=${lawdCd}, DEAL_YMD=${dealYmd})`)
}

async function fetchAllTrades(apiKey: string, lawdCd: string, dealYmd: string): Promise<TradeItem[]> {
  const first = await fetchTradePage(apiKey, lawdCd, dealYmd, 1)
  const trades = [...first.items]

  const totalPages = Math.ceil(first.totalCount / 1000)
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    await sleep(REQUEST_DELAY_MS)
    const page = await fetchTradePage(apiKey, lawdCd, dealYmd, pageNo)
    trades.push(...page.items)
  }

  return trades
}

// 행정동명 끝의 숫자를 제거해 대응 법정동명을 추정한다.
// 예: "정자1동" → "정자동", "구미동" → "구미동"(변화 없음)
function toLegalDongName(dongName: string): string {
  return dongName.replace(/\d+동$/, '동')
}

function summarize(trades: TradeItem[]) {
  const priceManwonSum = trades.reduce((sum, t) => sum + Number(t.dealAmount.replace(/,/g, '')), 0)
  const buildYearSum = trades.reduce((sum, t) => sum + t.buildYear, 0)
  const largeCount = trades.filter((t) => t.excluUseAr >= SIZE_THRESHOLD_M2).length

  return {
    avg_price_krw: Math.round((priceManwonSum / trades.length) * 10000),
    built_year_avg: Math.round(buildYearSum / trades.length),
    size_59_ok: largeCount / trades.length >= 0.5,
  }
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

  const lawdCodes: Record<string, string> = JSON.parse(
    readFileSync(path.join(__dirname, '../data/sigungu-lawd-codes.json'), 'utf-8')
  )

  const supabase = createClient(url, serviceKey)
  const { data: areas, error: areasError } = await supabase.from('areas').select('code, name, sigungu')
  if (areasError) throw areasError
  if (!areas || areas.length === 0) {
    console.log('areas 테이블이 비어있어요. scripts/seed-areas.ts를 먼저 실행하세요.')
    return
  }

  const months = recentMonths(TRADE_MONTHS)
  const sigunguList = [...new Set(areas.map((a) => a.sigungu))]

  // sigungu -> 법정동명 -> 거래 목록, sigungu -> 전체 거래 목록(폴백용)
  const dongTrades = new Map<string, Map<string, TradeItem[]>>()
  const sigunguTrades = new Map<string, TradeItem[]>()

  for (const sigungu of sigunguList) {
    const lawdCd = lawdCodes[sigungu]
    if (!lawdCd) {
      console.warn(`LAWD_CD 매핑이 없어요: ${sigungu} — data/sigungu-lawd-codes.json에 추가하세요.`)
      continue
    }

    console.log(`${sigungu}(${lawdCd}) 최근 ${TRADE_MONTHS}개월 거래 조회 중...`)
    const allTrades: TradeItem[] = []
    for (const ymd of months) {
      const trades = await fetchAllTrades(apiKey, lawdCd, ymd)
      allTrades.push(...trades)
      await sleep(REQUEST_DELAY_MS)
    }

    sigunguTrades.set(sigungu, allTrades)
    const byDong = new Map<string, TradeItem[]>()
    for (const trade of allTrades) {
      const list = byDong.get(trade.umdNm) ?? []
      list.push(trade)
      byDong.set(trade.umdNm, list)
    }
    dongTrades.set(sigungu, byDong)
  }

  const rows: {
    area_code: string
    avg_price_krw: number
    built_year_avg: number
    size_59_ok: boolean
    refreshed_at: string
  }[] = []
  let fallbackCount = 0
  let skippedCount = 0

  for (const area of areas) {
    const legalDong = toLegalDongName(area.name)
    const trades =
      dongTrades.get(area.sigungu)?.get(legalDong) ?? sigunguTrades.get(area.sigungu) ?? []

    if (trades.length === 0) {
      skippedCount += 1
      continue
    }
    if (!dongTrades.get(area.sigungu)?.get(legalDong)) {
      fallbackCount += 1
    }

    rows.push({
      area_code: area.code,
      ...summarize(trades),
      refreshed_at: new Date().toISOString(),
    })
  }

  const { error: upsertError, count } = await supabase
    .from('area_stats')
    .upsert(rows, { onConflict: 'area_code', count: 'exact' })
  if (upsertError) throw upsertError

  console.log(
    `area_stats 예산/년식/평형 갱신 완료: ${count ?? rows.length}건 ` +
      `(법정동 거래 없어 시군구 평균으로 대체 ${fallbackCount}건, 거래 자체 없어 스킵 ${skippedCount}건)`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
