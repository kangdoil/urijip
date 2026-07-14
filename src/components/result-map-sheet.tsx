'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Drawer } from 'vaul'
import { ChevronDown, ChevronRight, CirclePlus } from 'lucide-react'
import { Map, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { CONDITION_LABEL } from '@/lib/condition-labels'
import { Chip } from '@/components/ui/chip'
import { ResultHeaderPill } from '@/components/result-header-pill'
import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'
import { SigunguFilterSheet } from '@/components/sigungu-filter-sheet'
import { MustConditionSheet, type ParticipantConditionSummary } from '@/components/must-condition-sheet'

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
  areas: ResultAreaData[]
  matchCount: number
  fallback: FallbackResult | null
  resolved: boolean
  mustConditions: string[]
  budgetLabel: string
  conflict: boolean
  participants: ParticipantConditionSummary[] | null
  // 리스트를 아무리 스크롤해도 화면(뷰포트) 하단에 항상 고정으로 보여줄 액션
  // 영역 — 시트 안에 두지 않고 별도로 렌더링된다.
  actions?: ReactNode
}

// 지원 지역(경기 동남부) 대략 중심 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.395, lng: 127.111 }

// 시트를 끝까지 내리면 핸들+필터 칩 줄+액션 버튼만 보이고(요구사항 #3), 기본은
// 카드가 보이는 높이로 편다. vaul snapPoints는 뷰포트 대비 비율이다. 액션
// 버튼이 시트 레이아웃 안(항상 렌더)에 들어있으므로, 접힌 높이는 핸들+칩
// 줄+액션 버튼이 다 들어갈 만큼은 돼야 한다.
const SNAP_COLLAPSED = 0.3
const SNAP_DEFAULT = 0.6
const SNAP_POINTS = [SNAP_COLLAPSED, SNAP_DEFAULT]

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
  const bg = color === 'a' ? 'bg-pink-500' : color === 'b' ? 'bg-accent-teal' : 'bg-pink-500'
  return <div className={`h-4 w-4 rounded-full border-2 border-white shadow-md ${bg}`} />
}

function FallbackLists({ aOnly, bOnly }: { aOnly: FallbackArea[]; bOnly: FallbackArea[] }) {
  return (
    <div className="flex flex-col gap-4 px-4">
      <p className="text-body-s text-neutral-500">
        대신, 한쪽 필수 조건만 반영했을 때의 후보를 보여드릴게요
      </p>
      <div>
        <p className="mb-2 text-sm font-medium text-pink-500">A의 필수만 반영 ({aOnly.length}곳)</p>
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
        <p className="mb-2 text-sm font-medium text-accent-teal">B의 필수만 반영 ({bOnly.length}곳)</p>
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
  resolved,
  mustConditions,
  budgetLabel,
  conflict,
  participants,
  actions,
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
  const [snap, setSnap] = useState<number | string | null>(SNAP_DEFAULT)
  const [sigunguSheetOpen, setSigunguSheetOpen] = useState(false)
  const [conditionSheetOpen, setConditionSheetOpen] = useState(false)
  const mapRef = useRef<kakao.maps.Map | null>(null)

  const activeAreas = isFallback
    ? []
    : (groups.find((g) => g.sigungu === activeSigungu)?.list.slice(0, 3) ?? [])

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

  const title = resolved
    ? '결정 완료'
    : isFallback
      ? '필수 조건을 모두 만족하는 구역이 없어요'
      : '우리가 함께 할 수 있는 동네'

  const mustNames = mustConditions.map((c) => CONDITION_LABEL[c] ?? c)
  const mustSummary = mustNames.length > 0 ? mustNames.join(', ') : '없음'

  const isCollapsed = snap === SNAP_COLLAPSED

  return (
    <div className="relative mx-auto h-dvh w-full max-w-md overflow-hidden">
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

      <div className="absolute inset-x-4 top-14 z-10">
        <ResultHeaderPill title={title} count={isFallback ? undefined : matchCount} />
      </div>

      <Drawer.Root
        open
        modal={false}
        dismissible={false}
        snapPoints={SNAP_POINTS}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-10 mx-auto flex h-full max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl border border-pink-100 bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.1)] outline-none">
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />

            {/* 요구사항 #3: 시트를 끝까지 내려도 이 칩 줄만은 항상 보인다.
                트리거 칩은 고정, 개별 시군구 칩 영역만 가로 스크롤된다. */}
            {!isFallback && groups.length > 0 && (
              <div className="flex shrink-0 items-center gap-1.5 px-4 pt-2 pb-3">
                <button
                  onClick={() => setSigunguSheetOpen(true)}
                  className="flex shrink-0 items-center gap-1 rounded-full border-[1.2px] border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900"
                >
                  {groups.length}개 시군구
                  <ChevronDown className="size-4" />
                </button>
                <span className="h-7 w-0.5 shrink-0 bg-neutral-100" />
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                  {groups.map(({ sigungu }) => (
                    <Chip
                      key={sigungu}
                      selected={sigungu === activeSigungu}
                      onClick={() => setManualSigungu(sigungu)}
                      className="shrink-0"
                    >
                      {sigungu}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {!isCollapsed && (
              <div
                className="flex-1 overflow-y-auto"
                style={{
                  paddingBottom: actions ? 'calc(96px + env(safe-area-inset-bottom))' : '16px',
                }}
              >
                {isFallback ? (
                  <FallbackLists aOnly={fallback?.a_only ?? []} bOnly={fallback?.b_only ?? []} />
                ) : (
                  <>
                    {/* 요구사항 #5: 이 줄을 누르면 풀페이지 시트로 A/B 조건 + 추천 이유 */}
                    <button
                      onClick={() => setConditionSheetOpen(true)}
                      className="flex w-full items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-pink-50">
                          <CirclePlus className="size-5 text-pink-500" />
                        </span>
                        <span className="truncate text-body-m font-semibold text-pink-500">
                          필수 조건 : {mustSummary} / {budgetLabel}
                        </span>
                      </span>
                      <ChevronRight className="size-6 shrink-0 text-neutral-400" />
                    </button>

                    <div className="flex snap-x gap-3 overflow-x-auto px-4 py-4">
                      {activeAreas.map((area) => (
                        <ResultAreaCard key={area.code} area={area} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Drawer.Content는 snap과 무관하게 항상 h-full(90vh) 박스라 시트
          레이아웃 안에 두면 접힌 상태에선 뷰포트 밖으로 밀려난다. 그래서
          뷰포트 기준 fixed로 따로 띄우되, 접힌 스냅(SNAP_COLLAPSED)을 칩
          줄+액션 바 높이보다 넉넉하게 잡아서 칩 줄이 액션 바에 가리지
          않게 한다. */}
      {actions && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md border-t border-neutral-100 bg-white px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          {actions}
        </div>
      )}

      <SigunguFilterSheet
        open={sigunguSheetOpen}
        onOpenChange={setSigunguSheetOpen}
        sigungus={groups.map((g) => g.sigungu)}
        active={activeSigungu}
        onSelect={setManualSigungu}
      />

      <MustConditionSheet
        open={conditionSheetOpen}
        onOpenChange={setConditionSheetOpen}
        participants={participants}
        mustConditions={mustConditions}
        budgetLabel={budgetLabel}
        conflict={conflict}
        matchCount={matchCount}
      />
    </div>
  )
}
