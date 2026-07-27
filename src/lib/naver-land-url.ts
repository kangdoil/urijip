/**
 * 네이버부동산 "매물 보기" 딥링크 생성.
 *
 * areas 테이블의 code는 행정동코드라 네이버가 요구하는 cortarNo(법정동코드)와
 * 다르다(실측 확인: 경안동 areas.code=4161051000 vs 네이버 cortarNo=4161010100).
 * 반면 lat/lng 좌표만으로도 PC·모바일 모두 정확한 동을 열 수 있음을 실측
 * 검증했다(2026-07-27, 경안동·대치동·과천동 교차확인) — 그래서 cortarNo 없이
 * 좌표만 쓴다.
 *
 * 네이버가 URL 구조를 바꾸면 이 파일만 고치면 된다.
 */

export type NaverLandPlatform = 'naver_pc' | 'naver_mobile'

// 동 하나가 화면에 적당히 차는 줌 레벨. PC 기준 약 2.4km x 1.2km 뷰포트로
// 렌더되고, 네이버 자체 UI가 지역 선택 시 자동으로 고르는 줌과도 일치한다
// (실측 확인). PC·모바일 동일하게 적용.
const ZOOM_LEVEL = 16

// PC 매물 필터 — 아파트/분양권/재건축만. 가격·거래방식 필터(b/f/g)는 넣지
// 않는다(유저가 네이버에서 직접 조정).
const PC_REALTY_TYPE = 'APT:ABYG:JGC'

export function detectNaverLandPlatform(userAgent: string): NaverLandPlatform {
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? 'naver_mobile' : 'naver_pc'
}

export function buildNaverLandUrl(
  coords: { lat: number; lng: number },
  platform: NaverLandPlatform
): string {
  const { lat, lng } = coords
  if (platform === 'naver_mobile') {
    return `https://fin.land.naver.com/map/redirect?center=${lng}-${lat}&zoom=${ZOOM_LEVEL}`
  }
  // 루트 경로(new.land.naver.com?ms=...)도 동작하지만 /complexes로 바로
  // 보내는 쪽이 리다이렉트 홉이 하나 적어 더 안전하다(실측 확인).
  return `https://new.land.naver.com/complexes?ms=${lat},${lng},${ZOOM_LEVEL}&a=${PC_REALTY_TYPE}&e=RETAIL`
}

// 클릭 시점(브라우저 환경)에서만 호출한다 — navigator.userAgent를 쓰므로
// 서버 렌더 중에는 호출하면 안 된다. 좌표가 없는 동네는 null.
export function getNaverLandLink(area: {
  lat?: number | null
  lng?: number | null
}): { url: string; platform: NaverLandPlatform } | null {
  if (area.lat == null || area.lng == null) return null
  const platform = detectNaverLandPlatform(navigator.userAgent)
  return { url: buildNaverLandUrl({ lat: area.lat, lng: area.lng }, platform), platform }
}
