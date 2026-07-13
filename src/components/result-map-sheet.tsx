'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Drawer } from 'vaul'
import { Map, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { AreaCard, type GroupedAreaMatch } from '@/components/grouped-area-list'

export interface FallbackArea {
  code: string
  name: string
  sigungu: string
  lat: number
  lng: number
}

interface FallbackResult {
  a_only: FallbackArea[]
  b_only: FallbackArea[]
}

interface ResultMapSheetProps {
  areas: GroupedAreaMatch[]
  matchCount: number
  fallback: FallbackResult | null
  showConditionBadges?: boolean
  header?: ReactNode
  footer?: ReactNode
}

// 지원 지역(경기 동남부) 대략 중심 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.395, lng: 127.111 }

interface PinData {
  code: string
  name: string
  sigungu: string
  lat: number
  lng: number
  color: 'neutral' | 'a' | 'b'
}

function toPin(
  area: { code: string; name: string; sigungu: string; lat?: number; lng?: number },
  color: PinData['color']
): PinData | null {
  if (area.lat == null || area.lng == null) return null
  return { code: area.code, name: area.name, sigungu: area.sigungu, lat: area.lat, lng: area.lng, color }
}

function Pin({ color }: { color: 'neutral' | 'a' | 'b' }) {
  const bg = color === 'a' ? 'bg-primary-500' : color === 'b' ? 'bg-blue-500' : 'bg-primary-500'
  return <div className={`h-4 w-4 rounded-full border-2 border-white shadow-md ${bg}`} />
}

function FallbackLists({ aOnly, bOnly }: { aOnly: FallbackArea[]; bOnly: FallbackArea[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-neutral-500">
        대신, 한쪽 필수 조건만 반영했을 때의 후보를 보여드릴게요
      </p>
      <div>
        <p className="mb-2 text-sm font-medium text-primary-700">A의 필수만 반영 ({aOnly.length}곳)</p>
        <div className="flex flex-col gap-1.5">
          {aOnly.map((a) => (
            <div key={a.code} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700">
              {a.sigungu} {a.name}
            </div>
          ))}
          {aOnly.length === 0 && <p className="text-xs text-neutral-400">후보가 없어요</p>}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-blue-700">B의 필수만 반영 ({bOnly.length}곳)</p>
        <div className="flex flex-col gap-1.5">
          {bOnly.map((b) => (
            <div key={b.code} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700">
              {b.sigungu} {b.name}
            </div>
          ))}
          {bOnly.length === 0 && <p className="text-xs text-neutral-400">후보가 없어요</p>}
        </div>
      </div>
    </div>
  )
}

// 결과 화면 지도+바텀시트. 매칭 성공 시엔 시군구 칩 → 활성 칩의 상위 3곳만
// 지도/시트에 같이 보여준다(핀 탭 → 리스트 스크롤 연동은 v1 범위 밖 — TODO).
// 매칭 0건(폴백)일 땐 칩 없이 A/B 후보를 색으로 구분해 한 지도에 같이 보여준다.
export function ResultMapSheet({
  areas,
  matchCount,
  fallback,
  showConditionBadges = false,
  header,
  footer,
}: ResultMapSheetProps) {
  // react-kakao-maps-sdk 기본값이 프로토콜 상대경로("//dapi.kakao.com/...")라
  // 로컬 개발 서버(http://localhost:3000)에서는 http로 풀려서 브라우저 ORB에
  // 차단된다(실측: net::ERR_BLOCKED_BY_ORB). url을 https로 명시해서 우회한다.
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? '',
    url: 'https://dapi.kakao.com/v2/maps/sdk.js',
  })

  const isFallback = matchCount === 0
  const groups = useMemo(() => groupBySigungu(areas), [areas])
  // 칩을 직접 고르기 전까진 랭킹 1위 시군구를 활성으로 본다. groups가 바뀌어도
  // (예: 조율 후 재조회) 렌더 중에 파생값으로만 계산 — effect로 동기화하지 않는다.
  const [manualSigungu, setManualSigungu] = useState<string | null>(null)
  const activeSigungu =
    manualSigungu && groups.some((g) => g.sigungu === manualSigungu)
      ? manualSigungu
      : (groups[0]?.sigungu ?? null)
  const [snap, setSnap] = useState<number | string | null>(0.4)
  const mapRef = useRef<kakao.maps.Map | null>(null)

  const activeAreas = isFallback
    ? []
    : (groups.find((g) => g.sigungu === activeSigungu)?.list.slice(0, 3) ?? [])

  // get_matches/get_fallback_matches는 항상 lat/lng를 채워서 내려주지만(마이그레이션
  // 20260714000000), 타입 레벨에서는 GroupedAreaMatch.lat/lng가 optional이라
  // (adjust/page.tsx의 Candidate는 좌표가 없음 — 이 컴포넌트는 result 전용이라 무관)
  // 여기서 좁혀준다.
  const pins: PinData[] = isFallback
    ? [
        ...(fallback?.a_only ?? []).map((a) => toPin(a, 'a')),
        ...(fallback?.b_only ?? []).map((b) => toPin(b, 'b')),
      ].filter((p): p is PinData => p != null)
    : activeAreas.map((a) => toPin(a, 'neutral')).filter((p): p is PinData => p != null)

  useEffect(() => {
    if (loading || error || !mapRef.current) return
    const kakaoMap = mapRef.current
    if (pins.length === 0) return
    if (pins.length === 1) {
      kakaoMap.setCenter(new kakao.maps.LatLng(pins[0].lat, pins[0].lng))
      kakaoMap.setLevel(5)
      return
    }
    const bounds = new kakao.maps.LatLngBounds()
    for (const p of pins) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng))
    kakaoMap.setBounds(bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSigungu, loading, error])

  return (
    <div className="relative h-dvh w-full max-w-md mx-auto overflow-hidden">
      <div className="absolute inset-0">
        {loading || error ? (
          <div className="flex h-full items-center justify-center bg-neutral-100 text-sm text-neutral-400">
            {error ? '지도를 불러오지 못했어요' : '지도 불러오는 중...'}
          </div>
        ) : (
          <Map
            center={pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTER}
            style={{ width: '100%', height: '100%' }}
            level={7}
            onCreate={(map) => {
              mapRef.current = map
            }}
          >
            {pins.map((p) => (
              <CustomOverlayMap key={p.code} position={{ lat: p.lat, lng: p.lng }} yAnchor={0.5}>
                <Pin color={p.color} />
              </CustomOverlayMap>
            ))}
          </Map>
        )}
      </div>

      <Drawer.Root
        open
        modal={false}
        dismissible={false}
        snapPoints={[0.4, 0.9]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-10 mx-auto flex h-full max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-white outline-none">
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />
            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
              {header}

              {!isFallback && groups.length > 0 && (
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                  {groups.map(({ sigungu, list }) => (
                    <button
                      key={sigungu}
                      onClick={() => setManualSigungu(sigungu)}
                      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        sigungu === activeSigungu
                          ? 'bg-primary-500 text-white'
                          : 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {sigungu} · {list.length}곳
                    </button>
                  ))}
                </div>
              )}

              {isFallback ? (
                <FallbackLists aOnly={fallback?.a_only ?? []} bOnly={fallback?.b_only ?? []} />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {activeAreas.map((area) => (
                    <AreaCard key={area.code} area={area} showConditionBadges={showConditionBadges} />
                  ))}
                </div>
              )}

              {footer}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  )
}
