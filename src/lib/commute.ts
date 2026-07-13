import { createClient } from '@supabase/supabase-js'

type Mode = 'transit' | 'car'

function originKey(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

// commute_cache는 service role만 쓸 수 있다 (RLS에 select 정책만 있음 —
// schema.sql 설계상 배치/서버에서만 갱신). 이 클라이언트는 절대 브라우저로
// 넘기지 않는다 (API Route 서버 코드에서만 사용).
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callOdsayOnce(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ minutes: number | null; reason?: string; rateLimited?: boolean }> {
  const apiKey = process.env.ODSAY_API_KEY
  if (!apiKey) throw new Error('ODsay API 키가 설정되지 않았어요')

  const url = new URL('https://api.odsay.com/v1/api/searchPubTransPathT')
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('SX', String(originLng))
  url.searchParams.set('SY', String(originLat))
  url.searchParams.set('EX', String(destLng))
  url.searchParams.set('EY', String(destLat))

  const res = await fetch(url)
  if (res.status === 429) return { minutes: null, reason: '429', rateLimited: true }
  if (!res.ok) return { minutes: null, reason: `http_${res.status}` }
  const data = await res.json()

  // ODsay는 에러를 error 배열([{code, message}])로 내려준다 (단일 객체가 아님 —
  // 실측으로 확인). 이전엔 단일 객체로 가정해서 아래 -98/429 분기가 실제로는
  // 한 번도 매칭되지 않았었다.
  const err = Array.isArray(data?.error) ? data.error[0] : data?.error

  // ODsay 요청 제한도 HTTP 429가 아니라 200 응답의 error 필드로 온다.
  if (String(err?.code) === '429') {
    return { minutes: null, reason: '429', rateLimited: true }
  }
  // 출발/도착지가 700m 이내면 대중교통 경로 계산을 거부한다(code -98).
  // 실패가 아니라 도보 수준의 짧은 통근시간으로 처리한다.
  if (err?.code === '-98') return { minutes: 5 }
  if (err) return { minutes: null, reason: `${err.code}:${err.message ?? err.msg}` }

  const paths = data?.result?.path
  if (!Array.isArray(paths) || paths.length === 0) {
    return { minutes: null, reason: 'no_path' }
  }

  // 여러 경로 중 총 소요시간이 가장 짧은 것을 채택한다.
  const minutes = Math.min(...paths.map((p: { info: { totalTime: number } }) => p.info.totalTime))
  return { minutes }
}

// 429(요청 제한)를 만나면 잠깐 쉬었다가 재시도한다. ODsay는 이 제한을
// HTTP 상태코드가 아니라 200 응답의 error.code로 내려주는 걸 실측으로 확인했다.
async function callOdsayWithRetry(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  maxRetries = 3
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callOdsayOnce(originLat, originLng, destLat, destLng)
    if (!result.rateLimited) return result
    await sleep(2000 * (attempt + 1))
  }
  return { minutes: null, reason: '429_exhausted' }
}

// ODsay는 API 키가 IP/URI 등록 방식이라 서버 배포 환경마다 계속 인증이 막혀서
// (실측: ApiKeyAuthFailed) 자차 기준 카카오모빌리티 길찾기로 전환했다. 카카오는
// 대중교통 REST API를 제공하지 않아 "대중교통만 v1 지원"이라는 원래 PRD 결정을
// 자동차 기준으로 바꿨다 (PRD §5, §8 참고). 일일 무료 호출 한도가 10,000건으로
// 넉넉해 ODsay만큼 공격적인 재시도 백오프는 필요 없다.
async function callKakaoOnce(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ minutes: number | null; reason?: string; rateLimited?: boolean }> {
  const apiKey = process.env.KAKAO_REST_API_KEY
  if (!apiKey) throw new Error('카카오 API 키가 설정되지 않았어요')

  const url = new URL('https://apis-navi.kakaomobility.com/v1/directions')
  url.searchParams.set('origin', `${originLng},${originLat}`)
  url.searchParams.set('destination', `${destLng},${destLat}`)

  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` } })
  if (res.status === 429) return { minutes: null, reason: '429', rateLimited: true }
  if (!res.ok) return { minutes: null, reason: `http_${res.status}` }
  const data = await res.json()

  const route = data?.routes?.[0]
  if (!route) return { minutes: null, reason: 'no_route' }

  // 출발/도착지가 5m 이내면 경로 탐색을 거부한다(code 104). 실패가 아니라
  // 도보 수준의 짧은 통근시간으로 처리한다 (ODsay -98 처리와 동일한 이유).
  if (route.result_code === 104) return { minutes: 1 }
  if (route.result_code !== 0) {
    return { minutes: null, reason: `${route.result_code}:${route.result_msg}` }
  }

  const seconds = route.summary?.duration
  if (typeof seconds !== 'number') return { minutes: null, reason: 'no_duration' }
  return { minutes: Math.round(seconds / 60) }
}

async function callKakaoWithRetry(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  maxRetries = 3
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callKakaoOnce(originLat, originLng, destLat, destLng)
    if (!result.rateLimited) return result
    await sleep(1000 * (attempt + 1))
  }
  return { minutes: null, reason: '429_exhausted' }
}

// origin(참여자 거점)에서 모든 구역까지의 통근시간을 캐시 우선으로 채운다.
// CLAUDE.md 절대 규칙: API 호출 전 반드시 commute_cache를 먼저 조회한다.
// 카카오모빌리티는 일일 무료 호출 한도가 10,000건이라 ODsay(짧은 시간에 약
// 30건 내외 제한)만큼 보수적인 딜레이가 필요 없다 — 150ms면 충분히 안전하다.
export async function ensureCommuteForOrigin(
  originLat: number,
  originLng: number,
  mode: Mode
) {
  const supabase = serviceClient()
  const key = originKey(originLat, originLng)

  const { data: areas } = await supabase.from('areas').select('code, lat, lng')
  if (!areas) return { computed: 0, cached: 0, failed: 0, reasons: {} }

  const { data: cached } = await supabase
    .from('commute_cache')
    .select('area_code')
    .eq('origin_key', key)
    .eq('mode', mode)

  const cachedCodes = new Set((cached ?? []).map((c) => c.area_code))
  const missing = areas.filter((a) => !cachedCodes.has(a.code))

  let computed = 0
  let failed = 0
  const reasons: Record<string, number> = {}
  const REQUEST_DELAY_MS = mode === 'car' ? 150 : 400

  for (const area of missing) {
    let minutes: number | null = null
    let reason: string | undefined

    try {
      if (mode === 'car') {
        const result = await callKakaoWithRetry(originLat, originLng, area.lat, area.lng)
        minutes = result.minutes
        reason = result.reason
      } else {
        const result = await callOdsayWithRetry(originLat, originLng, area.lat, area.lng)
        minutes = result.minutes
        reason = result.reason
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : 'unknown'
    }

    if (minutes != null) {
      await supabase.from('commute_cache').upsert(
        [{ origin_key: key, area_code: area.code, mode, minutes }],
        { onConflict: 'origin_key,area_code,mode' }
      )
      computed += 1
    } else {
      failed += 1
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1
    }

    await sleep(REQUEST_DELAY_MS)
  }

  return { computed, cached: cachedCodes.size, failed, reasons }
}
