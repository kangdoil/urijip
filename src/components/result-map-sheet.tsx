'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ChevronDown, ChevronRight, CirclePlus } from 'lucide-react'
import { Map, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { CONDITION_LABEL } from '@/lib/condition-labels'
import { cn } from '@/lib/utils'
import { ResultHeaderPill } from '@/components/result-header-pill'
import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'
import { SigunguFilterSheet } from '@/components/sigungu-filter-sheet'
import {
  SelectedAreaFilterSheet,
  type AreaVisibility,
} from '@/components/selected-area-filter-sheet'
import { MustConditionSheet, type ParticipantConditionSummary } from '@/components/must-condition-sheet'
import { SaveOptionsSheet } from '@/components/save-options-sheet'

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
  mustConditions: string[]
  budgetLabel: string
  conflict: boolean
  participants: ParticipantConditionSummary[] | null
  partnerConfirmed: boolean | null
  retrying: boolean
  onRetry: () => void
  saving: boolean
  onSave: (visibleAreaCodes: string[]) => void
  onSaveImage: () => void
  onSaveText: () => void
  // 저장 시트 열림 상태는 부모가 들고 있다 — Save 확정 처리(handleSave)가
  // 끝난 뒤에 열어야 순서가 맞기 때문.
  saveSheetOpen: boolean
  onSaveSheetOpenChange: (open: boolean) => void
  exportRef?: React.RefObject<HTMLDivElement | null>
}

// 지원 지역(경기 동남부) 대략 중심 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.395, lng: 127.111 }

// 시트를 끝까지 내리면 핸들+필수조건 요약줄+액션 버튼만 보이고(요구사항),
// 기본은 필터+카드가 보이는 높이로 편다.
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

function sigunguTriggerLabel(selected: Set<string>) {
  const list = Array.from(selected)
  if (list.length === 0) return '시군구 선택'
  if (list.length === 1) return list[0]
  return `${list[0]} 외 ${list.length - 1}`
}

// 결과 화면 지도+바텀시트. 매칭 성공 시엔 시군구 다중 선택 + 선택/제외 필터로
// 카드를 걸러 보여준다(핀 탭 → 리스트 스크롤 연동은 v1 범위 밖 — TODO).
// 매칭 0건(폴백)일 땐 칩 없이 A/B 후보를 색으로 구분해 한 지도에 같이 보여준다.
export function ResultMapSheet({
  areas,
  matchCount,
  fallback,
  mustConditions,
  budgetLabel,
  conflict,
  participants,
  partnerConfirmed,
  retrying,
  onRetry,
  saving,
  onSave,
  onSaveImage,
  onSaveText,
  saveSheetOpen,
  onSaveSheetOpenChange,
  exportRef,
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

  // 여러 시군구를 동시에 선택할 수 있다(요구사항: 중복 선택 가능). 아직 직접
  // 고르기 전엔 전체 시군구가 기본으로 선택돼 있다 — groups가 바뀌어도(예:
  // 조율 후 재조회) effect 없이 렌더 중 파생값으로만 계산한다.
  const [manualSigungus, setManualSigungus] = useState<Set<string> | null>(null)
  const selectedSigungus =
    manualSigungus && Array.from(manualSigungus).some((s) => groups.some((g) => g.sigungu === s))
      ? manualSigungus
      : new Set(groups.map((g) => g.sigungu))

  // 카드의 X 버튼으로 뺀 구역 — Save를 누르기 전까진 이 화면 안에서만 유지된다.
  const [excludedCodes, setExcludedCodes] = useState<Set<string>>(new Set())
  // 기본은 "전체"가 선택된 상태 — 트리거 칩은 필터 안 된 모양(뉴트럴50)을
  // 유지하고, 실제로 "선택된/제외된 구역만"을 고를 때만 활성(뉴트럴900)으로 바뀐다.
  const [areaVisibility, setAreaVisibility] = useState<Set<AreaVisibility>>(new Set(['all']))

  const [snap, setSnap] = useState<number | string | null>(SNAP_DEFAULT)
  const [sigunguSheetOpen, setSigunguSheetOpen] = useState(false)
  const [areaFilterSheetOpen, setAreaFilterSheetOpen] = useState(false)
  const [conditionSheetOpen, setConditionSheetOpen] = useState(false)
  const mapRef = useRef<kakao.maps.Map | null>(null)
  // 접힌 상태의 핸들은 vaul Drawer.Content 밖(fixed 블록)에 있어 vaul의
  // 드래그가 인식하지 못한다 — 위로 스와이프하면 직접 스냅을 올려준다.
  const collapsedDragStartY = useRef<number | null>(null)

  function handleCollapsedHandlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    collapsedDragStartY.current = e.clientY
  }

  function handleCollapsedHandlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (collapsedDragStartY.current === null) return
    if (collapsedDragStartY.current - e.clientY > 24) {
      setSnap(SNAP_DEFAULT)
      collapsedDragStartY.current = null
    }
  }

  function handleCollapsedHandlePointerUp() {
    collapsedDragStartY.current = null
  }

  function toggleSigungu(sigungu: string) {
    const next = new Set(selectedSigungus)
    if (next.has(sigungu)) next.delete(sigungu)
    else next.add(sigungu)
    setManualSigungus(next)
  }

  function toggleAreaVisibility(value: AreaVisibility) {
    setAreaVisibility((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function excludeArea(code: string) {
    setExcludedCodes((prev) => new Set(prev).add(code))
  }

  // '전체'는 "아직 따로 거르지 않음"이라는 기본값 취급이다 — X로 뺀 구역은
  // 이 상태에서도 바로 숨긴다. '선택된/제외된 구역만'을 명시적으로 골라야
  // 그 기준대로 걸러 보여준다(둘 다 고르면 합집합 = 전부 보여준다).
  function passesAreaVisibility(code: string) {
    const excluded = excludedCodes.has(code)
    const wantSelected = areaVisibility.has('selected')
    const wantExcluded = areaVisibility.has('excluded')
    if (wantSelected && wantExcluded) return true
    if (wantExcluded) return excluded
    if (wantSelected) return !excluded
    return !excluded
  }

  const activeAreas = isFallback
    ? []
    : groups
        .filter((g) => selectedSigungus.has(g.sigungu))
        .flatMap((g) => g.list.slice(0, 3))
        .filter((a) => passesAreaVisibility(a.code))

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
  }, [selectedSigungus, loading, error])

  const title = isFallback ? '필수 조건을 모두 만족하는 구역이 없어요' : '함께 할 수 있는 동네'

  const mustNames = mustConditions.map((c) => CONDITION_LABEL[c] ?? c)
  const mustSummary = mustNames.length > 0 ? mustNames.join(', ') : '없음'

  const isCollapsed = snap === SNAP_COLLAPSED

  // 저장 리스트는 지금 보이는 필터와 무관하게, 전체 매칭 결과에서 제외하지
  // 않은(X 안 누른) 구역 전부를 기준으로 한다.
  const savedAreaCodes = areas.filter((a) => !excludedCodes.has(a.code)).map((a) => a.code)

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
        <ResultHeaderPill
          title={title}
          count={isFallback ? undefined : matchCount}
          partnerConfirmed={isFallback ? undefined : partnerConfirmed ?? undefined}
        />
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
          <Drawer.Overlay className="pointer-events-none fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-10 mx-auto flex h-full max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl border border-pink-100 bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.1)] outline-none">
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />

            {!isCollapsed && (
              <div
                className="flex-1 overflow-y-auto"
                style={{ paddingBottom: 'calc(164px + env(safe-area-inset-bottom))' }}
              >
                {isFallback ? (
                  <div className="pt-4">
                    <FallbackLists aOnly={fallback?.a_only ?? []} bOnly={fallback?.b_only ?? []} />
                  </div>
                ) : (
                  <>
                    {/* 시트가 펼쳐진 동안은 이전 디자인(큰 사이즈)으로 시트 맨 위에 보여주고,
                        시트를 끝까지 내리면 아래 고정 블록의 축약 버전으로 바뀐다. */}
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

                    {groups.length > 0 && (
                      <div className="flex items-center gap-1.5 px-4 py-2">
                        <button
                          onClick={() => setSigunguSheetOpen(true)}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-4 py-2 text-body-sb font-medium text-white"
                        >
                          {sigunguTriggerLabel(selectedSigungus)}
                          <ChevronDown className="size-4" />
                        </button>
                        <button
                          onClick={() => setAreaFilterSheetOpen(true)}
                          className={cn(
                            'flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-body-sb font-medium',
                            areaVisibility.has('selected') || areaVisibility.has('excluded')
                              ? 'bg-neutral-900 text-white'
                              : 'bg-neutral-50 text-neutral-500'
                          )}
                        >
                          전체
                          <ChevronDown className="size-4" />
                        </button>
                      </div>
                    )}

                    <div className="flex snap-x gap-3 overflow-x-auto px-4 py-3">
                      {activeAreas.map((area) => (
                        <ResultAreaCard key={area.code} area={area} onExclude={excludeArea} />
                      ))}
                      {activeAreas.length === 0 && (
                        <p className="py-4 text-center text-body-s text-neutral-400">
                          이 조건을 만족하는 구역이 없어요
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Drawer.Content는 snap과 무관하게 항상 h-full(90vh) 박스이고, vaul은
          접힌 스냅에서 그걸 translateY로 아래로 밀 뿐이라 시트 레이아웃 안에
          두면 접힌 상태에서 뷰포트 밖으로 밀려난다. 그래서 뷰포트 기준
          fixed로 따로 띄워 항상 보이게 한다. */}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md flex-col items-center bg-white">
        {/* Drawer.Content의 핸들은 접힌 스냅에서 이 fixed 블록에 가려 안 보이므로,
            접혔을 때 다시 펼 수 있도록 여기에도 탭 가능한 핸들을 따로 둔다. */}
        {!isFallback && isCollapsed && (
          <button
            type="button"
            onClick={() => setSnap(SNAP_DEFAULT)}
            onPointerDown={handleCollapsedHandlePointerDown}
            onPointerMove={handleCollapsedHandlePointerMove}
            onPointerUp={handleCollapsedHandlePointerUp}
            onPointerCancel={handleCollapsedHandlePointerUp}
            aria-label="바텀시트 펼치기"
            className="flex h-7 w-full shrink-0 items-center justify-center touch-none"
          >
            <span className="h-1 w-10 rounded-full bg-neutral-300" />
          </button>
        )}
        {/* 시트를 끝까지 내렸을 때만 이 축약 버전이 버튼 바로 위에 보인다.
            펼쳐져 있을 땐 시트 안(이전 디자인)에서 대신 보여준다. */}
        {!isFallback && isCollapsed && (
          <button
            onClick={() => setConditionSheetOpen(true)}
            className="flex w-full shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pink-50">
                <CirclePlus className="size-4 text-pink-500" />
              </span>
              <span className="truncate text-body-sb font-semibold text-pink-500">
                필수 조건 : {mustSummary} / {budgetLabel}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-neutral-400" />
          </button>
        )}

        <div className="flex w-full flex-col items-center gap-4 px-4 py-5">
          <div className="flex w-full items-center gap-3">
            <button
              onClick={onRetry}
              disabled={retrying}
              className="flex w-[105px] shrink-0 items-center justify-center rounded-full border-2 border-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-pink-500 disabled:opacity-50"
            >
              Retry
            </button>
            {!isFallback && (
              <button
                onClick={() => onSave(savedAreaCodes)}
                disabled={saving}
                className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-white disabled:opacity-50"
              >
                Save
              </button>
            )}
          </div>
          {!isFallback && (
            <p className="text-center text-caption-l font-medium text-neutral-500">
              Save를 누르면 확정되고, 동네 리스트를 저장할 수 있어요
            </p>
          )}
        </div>
      </div>

      <SigunguFilterSheet
        open={sigunguSheetOpen}
        onOpenChange={setSigunguSheetOpen}
        sigungus={groups.map((g) => g.sigungu)}
        selected={selectedSigungus}
        onToggle={toggleSigungu}
      />

      <SelectedAreaFilterSheet
        open={areaFilterSheetOpen}
        onOpenChange={setAreaFilterSheetOpen}
        selected={areaVisibility}
        onToggle={toggleAreaVisibility}
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

      <SaveOptionsSheet
        open={saveSheetOpen}
        onOpenChange={onSaveSheetOpenChange}
        matchCount={savedAreaCodes.length}
        onSaveImage={onSaveImage}
        onSaveText={onSaveText}
      />

      {/* html-to-image로 캡처할 내보내기용 카드 — 화면 밖에 렌더링해둔다. */}
      {exportRef && (
        <div className="pointer-events-none fixed top-0 left-[-9999px]">
          <div ref={exportRef} className="flex w-[360px] flex-col gap-4 bg-white p-8">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-body-m text-neutral-500">우리가 함께 할 수 있는 동네</p>
              <p className="text-title-l font-bold text-neutral-900">
                총 <span className="font-montserrat text-mont-title-l text-pink-500">
                  {savedAreaCodes.length}
                </span>
                곳
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {areas
                .filter((a) => savedAreaCodes.includes(a.code))
                .map((area) => (
                  <ResultAreaCard key={area.code} area={area} />
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
