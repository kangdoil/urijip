import { NextRequest, NextResponse } from 'next/server'

interface KakaoDocument {
  place_name: string
  address_name: string
  road_address_name: string
  x: string // 경도 (lng)
  y: string // 위도 (lat)
}

// 카카오 로컬 키워드 검색 프록시. REST API 키는 서버에만 두고
// 클라이언트에는 절대 노출하지 않는다 (CLAUDE.md 절대 규칙).
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim()
  if (!query) {
    return NextResponse.json({ results: [] })
  }

  const apiKey = process.env.KAKAO_REST_API_KEY
  console.log("apiKey",apiKey)
  if (!apiKey) {
    
    return NextResponse.json({ error: '카카오 API 키가 설정되지 않았어요' }, { status: 500 })
  }


  const kakaoUrl = new URL('https://dapi.kakao.com/v2/local/search/keyword.json')
  kakaoUrl.searchParams.set('query', query)
  kakaoUrl.searchParams.set('size', '8')

  const res = await fetch(kakaoUrl, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  })
  if (!res.ok) {

    return NextResponse.json({ error: '검색에 실패했어요' }, { status: 502 })
  }

  const data = await res.json()
  const results = (data.documents as KakaoDocument[]).map((d) => ({
    label: d.place_name,
    address: d.road_address_name || d.address_name,
    lat: Number(d.y),
    lng: Number(d.x),
  }))

  return NextResponse.json({ results })
}
