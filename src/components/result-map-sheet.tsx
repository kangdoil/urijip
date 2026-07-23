'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { Check, ChevronDown, ChevronRight, CirclePlus } from 'lucide-react'
import { Map, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk'
import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { CONDITION_LABEL } from '@/lib/condition-labels'
import { cn } from '@/lib/utils'
import { ResultHeaderPill } from '@/components/result-header-pill'
import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'
import { SigunguFilterSheet } from '@/components/sigungu-filter-sheet'
import { ConditionSummarySheet, type ParticipantConditionSummary } from '@/components/condition-summary-sheet'
import { SaveOptionsSheet } from '@/components/save-options-sheet'
import { ResultConcessionPanel } from '@/components/result-concession-panel'
import type { ConcessionAreaData } from '@/components/concession-area-card'
import { computeBenefitTags } from '@/lib/concession-benefit-tags'
import { buildConcessionCopy, type ConcessionMatchResult } from '@/lib/concession-copy'

interface ResultMapSheetProps {
  sessionId: string
  myParticipantId: string | null
  areas: ResultAreaData[]
  matchCount: number
  // 통근·예산 조건에 맞는 후보 0건(콜드 스테이션)일 때 get_concession_matches가 계산한
  // "서로 양보(AB)" 단일 추천안 — hoods/giveDetail/진단 문구를 여기서 뽑는다.
  concession: ConcessionMatchResult | null
  // get_matches가 내려주는 순위 순서(코드 배열, 1위부터) — A/B 각각.
  priorities: { a: string[]; b: string[] }
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
  // "먼저 둘러보기" 모드 — B 온보딩 전 A 조건만으로 미리 본 결과. 조율/저장은
  // 상대가 없어 의미가 없으므로 액션바를 "대기 화면으로 돌아가기" 하나로 바꾼다.
  solo?: boolean
  onBackToWaiting?: () => void
}

// 지원 지역 전체(경기 동남부~서북부)를 아우르는 서울 중심 근사 좌표 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }

// 핀이나 카드를 선택했을 때 확대할 레벨 — 호갱노노처럼 클릭 시 바로 줌인.
const PIN_FOCUS_LEVEL = 3

// 시군구별로 보여줄 상위 동네 상한 — grouped-area-list.tsx의 MAX_PER_GROUP과
// 동일한 기준(5)을 결과 화면 카드 리스트에도 그대로 적용한다.
const MAX_PER_GROUP = 5

// 시트를 끝까지 내리면 핸들+우선순위 요약줄+액션 버튼만 보이고(요구사항),
// 기본은 컨텐츠 자연 높이만큼만 펼쳐진다.
// vaul의 snapPoint 오프셋은 `containerHeight - snapPoint * containerHeight`로
// 계산된다 — snapPoint가 1이면 오프셋이 항상 0이라 화면 크기와 무관하게
// Drawer.Content의 실제(자연) 높이가 그대로 펼쳐진 높이가 된다. 예전에
// ResizeObserver로 픽셀 단위 스냅 높이를 직접 계산하려던 시도는 지도를 거의
// 가려버리는 버그로 이어졌는데, snapPoint=1은 그 계산을 vaul에 맡기면서도
// 같은 효과(컨텐츠만큼만 높이)를 얻는 방법이다.
const SNAP_COLLAPSED = 0.3
const SNAP_DEFAULT = 1
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

// 호갱노노 스타일 말풍선 핀 — 이름표 아래 작은 꼬리(포인터)가 좌표를 정확히
// 가리킨다. CustomOverlayMap의 yAnchor=1과 짝을 이뤄 꼬리 끝이 좌표에 온다.
function Pin({
  name,
  color,
  onClick,
}: {
  name: string
  color: 'neutral' | 'a' | 'b'
  onClick?: () => void
}) {
  const bg = color === 'a' ? 'bg-pink-500' : color === 'b' ? 'bg-accent-teal' : 'bg-pink-500'
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center">
      <span
        className={cn(
          'whitespace-nowrap rounded-full border-2 border-white px-3 py-1.5 text-xs font-bold text-white shadow-[0_4px_10px_rgba(0,0,0,0.25)]',
          bg
        )}
      >
        {name}
      </span>
      <span className={cn('-mt-1.5 size-2.5 rotate-45 border-r-2 border-b-2 border-white', bg)} />
    </button>
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
// 매칭 0건(폴백)일 땐 서로 양보(AB) 단일안 하나만 ResultConcessionPanel로 보여준다
// (A만/B만 개별 안은 없음 — 설계 결정).
export function ResultMapSheet({
  sessionId,
  myParticipantId,
  areas,
  matchCount,
  concession,
  priorities,
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
  solo = false,
  onBackToWaiting,
}: ResultMapSheetProps) {
  // react-kakao-maps-sdk 기본값이 프로토콜 상대경로("//dapi.kakao.com/...")라
  // 로컬 개발 서버(http://localhost:3000)에서는 http로 풀려서 브라우저 ORB에
  // 차단된다(실측: net::ERR_BLOCKED_BY_ORB). url을 https로 명시해서 우회한다.
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? '',
    url: 'https://dapi.kakao.com/v2/maps/sdk.js',
  })

  const isFallback = matchCount === 0
  // areas는 이미 랭킹순으로 정렬돼 들어오므로, 그룹별 상위 MAX_PER_GROUP개만
  // 남기면 곧 랭킹 상위 동네만 남는다(grouped-area-list.tsx와 동일한 방식).
  const groups = useMemo(
    () =>
      groupBySigungu(areas).map((g) => ({ ...g, list: g.list.slice(0, MAX_PER_GROUP) })),
    [areas]
  )

  // 여러 시군구를 동시에 선택할 수 있다(요구사항: 중복 선택 가능). 아직 직접
  // 고르기 전엔 전체 시군구가 기본으로 선택돼 있다 — groups가 바뀌어도(예:
  // 조율 후 재조회) effect 없이 렌더 중 파생값으로만 계산한다. manualSigungus를
  // 건드린 뒤엔(빈 Set 포함) 현재 groups에 남아있는 것만 걸러서 쓴다 — "모두
  // 선택 취소"로 0개를 명시적으로 고른 상태도 유효해야 하기 때문.
  const [manualSigungus, setManualSigungus] = useState<Set<string> | null>(null)
  const selectedSigungus = manualSigungus
    ? new Set(Array.from(manualSigungus).filter((s) => groups.some((g) => g.sigungu === s)))
    : new Set(groups.map((g) => g.sigungu))

  // 카드의 X 버튼으로 뺀 구역 — area_exclusions 테이블에 저장되는 세션 공유
  // 상태다. 한쪽이 제외/복구하면 Realtime으로 상대방 화면에도 반영되고,
  // 새로고침해도 유지된다. 낙관적 업데이트로 먼저 반영하고 실패하면 되돌린다.
  const [excludedCodes, setExcludedCodes] = useState<Set<string>>(new Set())
  const [exclusionError, setExclusionError] = useState<string | null>(null)

  useEffect(() => {
    if (!exclusionError) return
    const timer = setTimeout(() => setExclusionError(null), 2500)
    return () => clearTimeout(timer)
  }, [exclusionError])
  // 필터 칩이 3개(시군구/구역필터/체크박스)로 늘어나면서 한 줄에 안 들어가
  // 잘리는 문제가 있어 "구역 필터" 시트는 제거하고 체크박스 하나로 정리했다.
  // 디폴트는 꺼짐(선택된 동네만 노출) — 체크하면 제외된 동네도 같이 보여준다.
  const [includeExcluded, setIncludeExcluded] = useState(false)

  const [snap, setSnap] = useState<number | string | null>(SNAP_DEFAULT)
  const [sigunguSheetOpen, setSigunguSheetOpen] = useState(false)
  const [conditionSheetOpen, setConditionSheetOpen] = useState(false)
  const mapRef = useRef<kakao.maps.Map | null>(null)
  // 핀 클릭 시 바텀시트 안 해당 카드로 스크롤하기 위한 DOM 참조.
  // (이 파일은 react-kakao-maps-sdk의 `Map` 컴포넌트를 이미 import해서 전역
  // Map 클래스 이름이 가려지므로 Record로 대체한다.)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
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

  function toggleAllSigungus() {
    const allSigungus = groups.map((g) => g.sigungu)
    const allSelected = allSigungus.length > 0 && allSigungus.every((s) => selectedSigungus.has(s))
    setManualSigungus(allSelected ? new Set() : new Set(allSigungus))
  }

  async function excludeArea(code: string) {
    if (!myParticipantId) return
    setExcludedCodes((prev) => new Set(prev).add(code))
    const supabase = createClient()
    const { error } = await supabase.from('area_exclusions').insert({
      session_id: sessionId,
      area_code: code,
      excluded_by: myParticipantId,
    })
    if (error) {
      setExcludedCodes((prev) => {
        const next = new Set(prev)
        next.delete(code)
        return next
      })
      setExclusionError('제외에 실패했어요')
    }
  }

  async function restoreArea(code: string) {
    if (!myParticipantId) return
    setExcludedCodes((prev) => {
      const next = new Set(prev)
      next.delete(code)
      return next
    })
    const supabase = createClient()
    const { error } = await supabase
      .from('area_exclusions')
      .update({ restored_by: myParticipantId, restored_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('area_code', code)
      .is('restored_at', null)
    if (error) {
      setExcludedCodes((prev) => new Set(prev).add(code))
      setExclusionError('복구에 실패했어요')
    }
  }

  // 세션의 현재 제외 목록을 불러온 뒤, Realtime으로 상대방의 제외/복구를
  // 조용히(토스트 없이) 반영한다 — 제외는 자주 일어나는 행동이라 매번
  // 알림을 띄우면 소음이 커진다는 판단.
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const { data } = await supabase
        .from('area_exclusions')
        .select('area_code')
        .eq('session_id', sessionId)
        .is('restored_at', null)
      if (!cancelled && data) {
        setExcludedCodes(new Set(data.map((row) => row.area_code as string)))
      }

      await ensureRealtimeAuth(supabase)
      if (cancelled) return

      // 개발 모드 StrictMode/HMR로 effect가 겹쳐 실행되면 같은 이름의 채널이
      // 이미 subscribe된 채로 남아있을 수 있다 — 그 상태에서 .on()을 다시
      // 호출하면 "cannot add callbacks after subscribe()" 에러가 난다
      // (실측 확인). 새로 만들기 전에 동일 토픽의 기존 채널을 정리한다.
      const channelName = `area-exclusions:${sessionId}`
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`)
      if (stale) await supabase.removeChannel(stale)
      if (cancelled) return

      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'area_exclusions', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const areaCode = payload.new.area_code as string
            setExcludedCodes((prev) => new Set(prev).add(areaCode))
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'area_exclusions', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const row = payload.new as { area_code: string; restored_at: string | null }
            if (row.restored_at == null) return
            setExcludedCodes((prev) => {
              const next = new Set(prev)
              next.delete(row.area_code)
              return next
            })
          }
        )
        .subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [sessionId])

  const activeAreas = isFallback
    ? []
    : groups
        .filter((g) => selectedSigungus.has(g.sigungu))
        .flatMap((g) => g.list)
        .filter((a) => includeExcluded || !excludedCodes.has(a.code))

  // 서로 양보(AB) 단일안 후보 — get_concession_matches가 계산해둔 순위 그대로 쓴다.
  const aBudgetMaxKrw = participants?.find((p) => p.role === 'A')?.budget_max_krw ?? null
  const bBudgetMaxKrw = participants?.find((p) => p.role === 'B')?.budget_max_krw ?? null
  const concessionHoods: ConcessionAreaData[] = (concession?.main.areas ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    sigungu: a.sigungu,
    lat: a.lat ?? undefined,
    lng: a.lng ?? undefined,
    benefitTags: computeBenefitTags(
      { avg_price_krw: a.avg_price_krw, satisfied: a.satisfied },
      { aBudgetMaxKrw, bBudgetMaxKrw }
    ),
  }))
  const concessionCopy = concession ? buildConcessionCopy(concession) : null
  const extraHoods: ConcessionAreaData[] = (concession?.extra?.areas ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    sigungu: a.sigungu,
    lat: a.lat ?? undefined,
    lng: a.lng ?? undefined,
    benefitTags: computeBenefitTags(
      { avg_price_krw: a.avg_price_krw, satisfied: a.satisfied },
      { aBudgetMaxKrw, bBudgetMaxKrw }
    ),
  }))

  const pins: PinData[] = isFallback
    ? concessionHoods.map((a) => toPin(a, 'neutral')).filter((p): p is PinData => p != null)
    : activeAreas.map((a) => toPin(a, 'neutral')).filter((p): p is PinData => p != null)

  // 핀을 클릭하거나(호갱노노처럼) 바텀시트에서 카드를 선택했을 때 지도를
  // 그 좌표로 확대·이동한다.
  function focusPin(lat: number, lng: number) {
    const kakaoMap = mapRef.current
    if (!kakaoMap) return
    kakaoMap.setLevel(PIN_FOCUS_LEVEL)
    kakaoMap.setCenter(new kakao.maps.LatLng(lat, lng))
  }

  // 지도 핀을 클릭하면 그 좌표로 확대하는 것과 동시에, 시트가 접혀있으면
  // 펼치고 바텀시트 안 해당 카드로 스크롤해 정보를 보여준다.
  function focusArea(code: string, lat: number, lng: number) {
    focusPin(lat, lng)
    setSnap((prev) => (prev === SNAP_COLLAPSED ? SNAP_DEFAULT : prev))
    requestAnimationFrame(() => {
      cardRefs.current[code]?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    })
  }

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

  const title = solo
    ? '먼저 둘러보기'
    : isFallback
      ? '통근·예산 조건에 맞는 구역이 없어요'
      : '추천 동네'

  const priorityTopLabel = (codes: string[]) =>
    codes[0] ? (CONDITION_LABEL[codes[0]] ?? codes[0]) : null
  const aTop = priorityTopLabel(priorities.a)
  const bTop = priorityTopLabel(priorities.b)
  const prioritySummary = [aTop && `A ${aTop}`, bTop && `B ${bTop}`].filter(Boolean).join(' · ') || '없음'

  const isCollapsed = snap === SNAP_COLLAPSED

  // 시군구별 상위 MAX_PER_GROUP개로 캡한 전체 목록 — 저장·안내 문구 모두 이
  // 캡이 반영된 수를 기준으로 한다("총 N곳"이 실제 보여주는/저장되는 개수와
  // 어긋나지 않도록).
  const cappedAreas = groups.flatMap((g) => g.list)

  // 저장 리스트는 지금 보이는 시군구 필터와 무관하게, 캡 반영 후 제외하지
  // 않은(X 안 누른) 구역 전부를 기준으로 한다.
  const savedAreaCodes = cappedAreas.filter((a) => !excludedCodes.has(a.code)).map((a) => a.code)

  // 캡 반영 후 전체 후보 수 — 시군구 뷰 필터·제외와 무관하게 "조건에 맞는
  // 구역이 몇 곳인지"를 그대로 설명할 때 쓴다(우선순위 시트 문구).
  const totalMatchCount = cappedAreas.length
  // 실제로 저장될 개수 — 제외 반영, 시군구 뷰 필터와는 무관하다.
  const remainingMatchCount = savedAreaCodes.length

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
              <CustomOverlayMap key={p.code} position={{ lat: p.lat, lng: p.lng }} yAnchor={1}>
                <Pin name={p.name} color={p.color} onClick={() => focusArea(p.code, p.lat, p.lng)} />
              </CustomOverlayMap>
            ))}
          </Map>
        )}
      </div>

      <div
        className="absolute inset-x-4 z-10"
        style={{ top: 'calc(env(safe-area-inset-top) + 16px)' }}
      >
        <ResultHeaderPill
          title={title}
          count={isFallback ? undefined : activeAreas.length}
          partnerConfirmed={isFallback ? undefined : partnerConfirmed ?? undefined}
        />
      </div>

     {!isCollapsed && (
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
          {/* 액션바(조율하기/저장하기)는 Drawer.Content 안 일반 흐름의 마지막
              자식으로 둬서 카드-버튼 간격이 항상 0이 되도록 한다. Content는
              max-h만 안전장치로 두고 나머지는 컨텐츠 자연 높이를 그대로
              따른다(SNAP_DEFAULT=1이라 vaul 오프셋이 항상 0 — 위 주석 참고).
              내부 스크롤은 원치 않아 overflow-hidden으로 넘치는 부분은
              스크롤 대신 그냥 잘리게 둔다(카드 줄 자체의 가로 스크롤은
              별도 요소에 있어 영향 없음). */}
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-pink-100 bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.1)] outline-none">
            <button className="h-7">
              <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />
            </button>

            {!isCollapsed && (
              <div
              >
                {isFallback ? (
                  solo ? (
                    <div className="flex flex-col gap-4 pt-4">
                      <p className="px-4 text-center text-body-s text-neutral-400">
                        내 조건만으로는 만족하는 구역이 없어요
                      </p>
                      <div className="px-4 pb-2.5">
                        <button
                          onClick={onBackToWaiting}
                          className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
                        >
                          대기 화면으로 돌아가기
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 결과 화면(펼쳐진 캐러셀+지도)과 비슷한 비중으로 시트를 채우기
                    // 위해 내용 높이를 따라가는 대신 고정 높이를 준다 — MustConditionSheet의
                    // "거의 풀페이지" 패턴과 동일한 의도.
                    <div className="flex h-[70dvh] flex-col pt-3">
                      <ResultConcessionPanel
                        message={concessionCopy?.message ?? '두 분 조건에 맞는 동네를 찾는 중이에요'}
                        giveDetail={concessionCopy?.giveDetail ?? ''}
                        giveTag={concessionCopy?.giveTag ?? null}
                        hoods={concessionHoods}
                        extraHoods={extraHoods}
                        extraCount={concession?.extra?.total_count ?? 0}
                        extraGiveDetail={concessionCopy?.extraGiveDetail ?? ''}
                        totalCount={concession?.main.total_count ?? 0}
                        tipTitle={concessionCopy?.tipTitle ?? '이렇게 조정해보세요'}
                        tipBody={concessionCopy?.tipBody ?? ''}
                        onAdjust={onRetry}
                        onSelectHood={(hood) => {
                          if (hood.lat != null && hood.lng != null) focusPin(hood.lat, hood.lng)
                        }}
                        onViewMap={
                          concessionHoods.length > 0 ? () => setSnap(SNAP_COLLAPSED) : undefined
                        }
                      />
                    </div>
                  )
                ) : (
                  <>
                    {/* 시트가 펼쳐진 동안은 이전 디자인(큰 사이즈)으로 시트 맨 위에 보여주고,
                        시트를 끝까지 내리면 위 축약 버전으로 바뀐다. */}
                    <button
                      onClick={() => setConditionSheetOpen(true)}
                      className="flex w-full items-center justify-between gap-2 border-b border-neutral-100 px-4 mt-3 pb-3" 
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pink-50">
                          <CirclePlus className="size-4 text-pink-500" />
                        </span>
                        <span className="truncate text-body-sb font-semibold text-pink-500">
                          우선순위 : {prioritySummary} / {budgetLabel}
                        </span>
                      </span>
                      <ChevronRight className="size-6 shrink-0 text-neutral-400" />
                    </button>

                    {groups.length > 0 && (
                      <div className="flex items-center gap-1.5 px-4 pt-2 pb-1">
                        <button
                          onClick={() => setSigunguSheetOpen(true)}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-4 py-2 text-body-sb font-medium text-white"
                        >
                          {sigunguTriggerLabel(selectedSigungus)}
                          <ChevronDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncludeExcluded((v) => !v)}
                          aria-pressed={includeExcluded}
                          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full pl-4 py-2 text-body-sb font-medium text-neutral-500"
                        >
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded border',
                              includeExcluded
                                ? 'border-neutral-900 bg-neutral-900'
                                : 'border-neutral-300 bg-white'
                            )}
                          >
                            {includeExcluded && <Check className="size-3 text-white" strokeWidth={3} />}
                          </span>
                          제외된 동네 포함
                        </button>
                      </div>
                    )}

                    <div className="flex snap-x gap-3 overflow-x-auto px-4 pt-1.5 pb-3 scroll-pl-4">
                      {activeAreas.map((area) => (
                        <div
                          key={area.code}
                          ref={(el) => {
                            cardRefs.current[area.code] = el
                          }}
                          className="shrink-0"
                        >
                          <ResultAreaCard
                            area={area}
                            excluded={excludedCodes.has(area.code)}
                            onExclude={excludeArea}
                            onRestore={restoreArea}
                            onSelect={
                              area.lat != null && area.lng != null
                                ? () => focusPin(area.lat!, area.lng!)
                                : undefined
                            }
                          />
                        </div>
                      ))}
                      {activeAreas.length === 0 && (
                        <p className="py-4 text-center text-body-s text-neutral-400">
                          이 조건을 만족하는 구역이 없어요
                        </p>
                      )}
                    </div>

                    <div className="flex w-full flex-col items-center gap-3 px-4 pt-2.5 pb-2.5">
          {solo ? (
            <button
              onClick={onBackToWaiting}
              className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
            >
              대기 화면으로 돌아가기
            </button>
          ) : (
            <>
              <div className="flex w-full items-center gap-3">
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="flex flex-1 items-center justify-center rounded-full border-2 border-pink-500 px-10 py-4 text-body-m font-bold text-pink-500 disabled:opacity-50"
                >
                  조율하기
                </button>
                <button
                  onClick={() => onSave(savedAreaCodes)}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white disabled:opacity-50"
                >
                  저장하기
                </button>
              </div>
              <p className="text-center text-caption-l font-medium text-neutral-500">
                저장하기를 누르면 상대방에게 확정되었다고 뜨고, 동네 리스트도 저장할 수 있어요
              </p>
            </>
          )}
        </div>
                  </>
                )}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
     )}

      {/* Drawer.Content는 스냅과 무관하게 항상 h-full(90vh) 박스이고, vaul은
          접힌(또는 좁은) 스냅에서 그걸 translateY로 아래로 밀 뿐이라 시트
          레이아웃 안에 두면 화면 밖으로 밀려난다. 그래서 뷰포트 기준 fixed로
          따로 띄워 항상 보이게 한다. */}
            {!isFallback && isCollapsed && (
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md flex-col items-center bg-white rounded-t-3xl border-2 border-pink-100">
        {/* Drawer.Content의 핸들은 접힌 스냅에서 이 fixed 블록에 가려 안 보이므로,
            접혔을 때 다시 펼 수 있도록 여기에도 탭/드래그 가능한 핸들을 따로 둔다. */}
      
          <button
            type="button"
            onClick={() => setSnap(SNAP_DEFAULT)}
            onPointerDown={handleCollapsedHandlePointerDown}
            onPointerMove={handleCollapsedHandlePointerMove}
            onPointerUp={handleCollapsedHandlePointerUp}
            onPointerCancel={handleCollapsedHandlePointerUp}
            aria-label="바텀시트 펼치기"
            className="flex h-7 w-full shrink-0 items-center justify-center touch-none "
          >
            <span className="h-1 w-10 rounded-full bg-neutral-300" />
          </button>
      
        {/* 시트를 끝까지 내렸을 때만 이 축약 버전이 버튼 바로 위에 보인다.
            펼쳐져 있을 땐 시트 안(이전 디자인)에서 대신 보여준다. */}
        {!isFallback && isCollapsed && (
          <>
          <button
            onClick={() => setConditionSheetOpen(true)}
            className="flex w-full shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pink-50">
                <CirclePlus className="size-4 text-pink-500" />
              </span>
              <span className="truncate text-body-sb font-semibold text-pink-500">
                우선순위 : {prioritySummary} / {budgetLabel}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-neutral-400" />
          </button>
          <div className="flex w-full items-center gap-3 px-4 pt-2.5 pb-2.5">
            {solo ? (
              <button
                onClick={onBackToWaiting}
                className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
              >
                대기 화면으로 돌아가기
              </button>
            ) : (
              <>
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="flex flex-1 items-center justify-center rounded-full border-2 border-pink-500 px-10 py-4 text-body-m font-bold text-pink-500 disabled:opacity-50"
                >
                  조율하기
                </button>
                <button
                  onClick={() => onSave(savedAreaCodes)}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white disabled:opacity-50"
                >
                  저장하기
                </button>
              </>
            )}
          </div>
          </>
        )}
      </div>
        )}

      <SigunguFilterSheet
        open={sigunguSheetOpen}
        onOpenChange={setSigunguSheetOpen}
        sigungus={groups.map((g) => g.sigungu)}
        selected={selectedSigungus}
        onToggle={toggleSigungu}
        onToggleAll={toggleAllSigungus}
      />

      <ConditionSummarySheet
        open={conditionSheetOpen}
        onOpenChange={setConditionSheetOpen}
        participants={participants}
        priorities={priorities}
        budgetLabel={budgetLabel}
        conflict={conflict}
        count={totalMatchCount}
      />

      <SaveOptionsSheet
        open={saveSheetOpen}
        onOpenChange={onSaveSheetOpenChange}
        count={remainingMatchCount}
        onSaveImage={onSaveImage}
        onSaveText={onSaveText}
      />

      {exclusionError && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
          <span className="rounded-full bg-red-600 px-5 py-3 text-body-sb font-semibold text-white shadow-lg">
            {exclusionError}
          </span>
        </div>
      )}

      {/* html-to-image로 캡처할 내보내기용 카드 — 화면 밖에 렌더링해둔다. */}
      {exportRef && (
        <div className="pointer-events-none fixed top-0 left-[-9999px]">
          <div ref={exportRef} className="flex w-[360px] flex-col gap-4 bg-white p-8">
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-body-m text-neutral-500">우리가 함께 할 수 있는 동네</p>
              <p className="text-title-l font-bold text-neutral-900">
                총 <span className="font-montserrat text-mont-title-l text-pink-500">
                  {activeAreas.length}
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
