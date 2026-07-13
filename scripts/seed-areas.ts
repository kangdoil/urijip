/**
 * areas 테이블 시드 스크립트.
 *
 * 대상: 성남시(수정구·중원구·분당구), 하남시, 과천시, 의왕시,
 *       용인시(수지구·기흥구만 — 처인구 제외), 광주시(읍·면·동 전체) — PRD 초기 지원 지역.
 *       + 수원시(영통구·권선구), 화성시(동탄구) — 1차 확장 (분당선/신분당선/GTX·SRT로
 *       강남·판교 통근권과 이어지는 인접 신도시, PRD §8 확장 기준에 따른 추가).
 * PRD 근거: docs/PRD-우리집.md §8 "초기 지원 지역"
 *
 * 데이터 출처/산출 방식은 data/areas-seed.json 각 항목의 source_note에 남겨뒀다.
 * 초기 119개는 행정안전부 행정표준코드관리시스템 기준 코드 + 주민센터 주소 지오코딩.
 * 확장 33개(수원 영통·권선, 화성 동탄)는 SBIZ 상가정보 API 반경조회 응답의
 * 행정동코드(adongCd)·좌표를 그대로 썼다 — 실제 등록 상가 데이터 기반이라 코드
 * 정확도는 높지만, 좌표는 주민센터가 아니라 슈퍼마켓 업종 매장들의 평균 위치라
 * 기존 119개보다 대표성이 다소 느슨하다.
 * source_note가 "추정치"인 항목은 출처를 교차 확인하지 못한 값이니,
 * 실사용 전에 재검증이 필요하다.
 *
 * 지역 확장 시: data/areas-seed.json에 항목을 추가하고 이 스크립트를 다시 실행하면 된다
 * (CLAUDE.md 절대 규칙 — 지역 하드코딩 금지: 코드에는 지역명을 적지 않고 이 JSON만 늘린다).
 *
 * 실행: npx tsx scripts/seed-areas.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (areas 테이블은 RLS상 service role 쓰기만 허용되어 있어 anon 키로는 실행할 수 없다.)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface AreaSeed {
  code: string
  name: string
  sigungu: string
  lat: number
  lng: number
  source_note: string
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요해요'
    )
  }

  const dataPath = path.join(__dirname, '../data/areas-seed.json')
  const areas: AreaSeed[] = JSON.parse(readFileSync(dataPath, 'utf-8'))

  const rows = areas.map(({ code, name, sigungu, lat, lng }) => ({
    code,
    name,
    sigungu,
    lat,
    lng,
  }))

  const supabase = createClient(url, serviceKey)
  const { error, count } = await supabase
    .from('areas')
    .upsert(rows, { onConflict: 'code', count: 'exact' })

  if (error) throw error
  console.log(`areas 시드 완료: ${count ?? rows.length}건 (총 ${rows.length}건 중)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
