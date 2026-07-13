import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = 'http://localhost:3000'
const ORIGIN = { lat: 37.498, lng: 127.028 } // mode=car로 148/152 캐시된 origin

function decodeAccessToken(cookieValue) {
  const b64 = cookieValue.replace(/^base64-/, '')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')).access_token
}
async function getAccessTokenFromFreshContext(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const cookies = await context.cookies()
  const authCookie = cookies.find((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))
  return { context, page, token: decodeAccessToken(authCookie.value) }
}
async function rpc(token, fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${fn} 실패: ${JSON.stringify(data)}`)
  return data
}
async function restGet(token, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  return res.json()
}
async function restPatch(token, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} 실패: ${await res.text()}`)
}
async function restPost(token, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} 실패: ${await res.text()}`)
}

async function setupSession(browser, { aBudget, bBudget, aCommute, bCommute, musts }) {
  const a = await getAccessTokenFromFreshContext(browser)
  const session = await rpc(a.token, 'create_session', { name: '테스트A' })
  const b = await getAccessTokenFromFreshContext(browser)
  await rpc(b.token, 'join_session', { code: session.invite_code, name: '테스트B' })

  const [aP] = await restGet(a.token, `participants?session_id=eq.${session.id}&role=eq.A&select=id`)
  const [bP] = await restGet(b.token, `participants?session_id=eq.${session.id}&role=eq.B&select=id`)

  const now = new Date().toISOString()
  await restPatch(a.token, `participants?id=eq.${aP.id}`, {
    anchor_lat: ORIGIN.lat, anchor_lng: ORIGIN.lng, transport_mode: 'car',
    commute_max_min: aCommute, budget_max_krw: aBudget,
    completed_at: now, commute_batch_done_at: now,
  })
  await restPatch(b.token, `participants?id=eq.${bP.id}`, {
    anchor_lat: ORIGIN.lat, anchor_lng: ORIGIN.lng, transport_mode: 'car',
    commute_max_min: bCommute, budget_max_krw: bBudget,
    completed_at: now, commute_batch_done_at: now,
  })
  if (musts.a.length) {
    await restPost(a.token, 'participant_conditions', musts.a.map((code) => ({ participant_id: aP.id, condition_code: code, tier: 'must' })))
  }
  if (musts.b.length) {
    await restPost(b.token, 'participant_conditions', musts.b.map((code) => ({ participant_id: bP.id, condition_code: code, tier: 'must' })))
  }

  return { session, a, b }
}

async function main() {
  const browser = await chromium.launch()
  const consoleErrors = []

  console.log('=== 시나리오 1: 매칭 있음 (여러 시군구) ===')
  const { session: s1, a: a1 } = await setupSession(browser, {
    aBudget: 3_000_000_000, bBudget: 3_000_000_000, aCommute: 90, bCommute: 90,
    musts: { a: ['infra'], b: [] },
  })

  a1.page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  a1.page.on('response', (res) => {
    if (res.url().includes('dapi.kakao.com') && !res.ok()) {
      consoleErrors.push(`kakao ${res.status()}: ${res.url()}`)
    }
  })

  await a1.page.goto(`${APP_URL}/s/${s1.id}/result`, { waitUntil: 'networkidle' })
  await a1.page.waitForSelector('text=함께 갈 수 있는 구역', { timeout: 15000 })
  await a1.page.waitForTimeout(1500) // 지도 타일 로드 대기
  await a1.page.screenshot({ path: 'scripts/_out-map-1-initial.png' })
  console.log('초기 화면 스크린샷 저장')

  const chips = a1.page.locator('button:has-text("곳")')
  const chipCount = await chips.count()
  console.log('칩 개수:', chipCount)

  if (chipCount >= 2) {
    const firstChipText = await chips.nth(0).textContent()
    await chips.nth(1).click()
    await a1.page.waitForTimeout(800)
    await a1.page.screenshot({ path: 'scripts/_out-map-2-chip-switched.png' })
    const secondChipText = await chips.nth(1).textContent()
    console.log('칩 전환:', firstChipText?.trim(), '→', secondChipText?.trim())
  } else {
    console.log('경고: 칩이 2개 미만이라 전환 테스트 스킵')
  }

  // 지도 타일 이미지가 실제로 그려졌는지 확인 (kakao map canvas/img 존재)
  const mapTileCount = await a1.page.locator('img[src*="daumcdn"], img[src*="kakao"]').count()
  console.log('지도 타일 이미지 개수:', mapTileCount)

  console.log('콘솔/카카오 에러:', consoleErrors.length === 0 ? '없음' : consoleErrors)

  console.log('\n=== 시나리오 2: 매칭 0건 (폴백) ===')
  const { session: s2, a: a2 } = await setupSession(browser, {
    aBudget: 100_000_000, bBudget: 100_000_000, aCommute: 90, bCommute: 90,
    musts: { a: ['infra', 'area_size'], b: ['build_year'] },
  })
  await a2.page.goto(`${APP_URL}/s/${s2.id}/result`, { waitUntil: 'networkidle' })
  await a2.page.waitForSelector('text=필수 조건을 모두 만족하는 구역이 없어요', { timeout: 15000 }).catch(() => {})
  await a2.page.waitForTimeout(1200)
  await a2.page.screenshot({ path: 'scripts/_out-map-3-fallback.png' })
  const bodyText2 = await a2.page.textContent('body')
  console.log('폴백 화면 헤드라인 포함 여부:', bodyText2.includes('필수 조건을 모두 만족하는 구역이 없어요'))
  console.log('폴백 화면에 칩 없음 확인:', (await a2.page.locator('button:has-text("곳")').count()) === 0)

  await browser.close()

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  await svc.from('sessions').delete().eq('id', s1.id)
  await svc.from('sessions').delete().eq('id', s2.id)
  console.log('\n정리 완료:', s1.id, s2.id)
}

main().catch((e) => {
  console.error('실패:', e)
  process.exit(1)
})
