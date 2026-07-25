'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Map, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk'
import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'
import { groupBySigungu } from '@/lib/group-by-sigungu'
import { cn } from '@/lib/utils'
import { ResultHeaderPill } from '@/components/result-header-pill'
import { ResultAreaCard, type ResultAreaData } from '@/components/result-area-card'
import { ResultAreaGroupList } from '@/components/result-area-group-list'
import { SigunguFilterSheet } from '@/components/sigungu-filter-sheet'
import { ConditionSummarySheet, type ParticipantConditionSummary } from '@/components/condition-summary-sheet'
import { SaveOptionsSheet } from '@/components/save-options-sheet'
import { ResultConcessionPanel } from '@/components/result-concession-panel'
import { buildConcessionCopy, buildStatsComparisonProps, type ConcessionMatchResult } from '@/lib/concession-copy'

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
  // 콜드 스테이션 팁 카드의 "이 조건으로 바꾸고 동네 보러 가기" 전용 —
  // onRetry(그냥 /adjust로 이동)와 달리 apply_concession RPC로 두 참여자의
  // 조건을 실제로 반영한 뒤 이동한다.
  applyingConcession: boolean
  onApplyConcession: () => void
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

// 바텀시트 3단 스냅(Figma 기준, 844px 프레임 대비 비율):
// 접힘(161px) / 중간(480px) / 전체(뷰포트 풀). vaul의 오프셋 공식은
// `containerHeight - snapPoint*containerHeight`이고 containerHeight는
// window.innerHeight를 쓴다 — Drawer.Content 박스 자체 높이가 뷰포트와
// 같아야(h-dvh) SNAP_FULL(offset=0)이 실제 전체화면이 되고, 세 스냅이
// 같은 박스 안에서 위치만 바뀌므로 중간/전체가 같은 콘텐츠를 공유하며
// 리스트 스크롤 영역만 커진다.
// 중간 스냅에서 리스트가 너무 조금 보인다는 피드백으로 399px(0.47)에서
// 480px(0.57)로 올렸다(844px 프레임 기준 비율 유지).
const SNAP_COLLAPSED = 0.19
const SNAP_MID = 0.57
const SNAP_FULL = 1

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

// 시군구 선택 칩 + "제외된 동네 포함" 체크박스 — 펼친 상태와 접힌 상태(요구사항:
// 접혔을 때도 핸들/필터칩/버튼은 보여줄 것) 양쪽에서 재사용한다.
function FilterChipRow({
  label,
  onOpenSigunguSheet,
  includeExcluded,
  onToggleIncludeExcluded,
}: {
  label: string
  onOpenSigunguSheet: () => void
  includeExcluded: boolean
  onToggleIncludeExcluded: () => void
}) {
  return (
    <div className="flex w-full items-center justify-between gap-1.5 px-4 pt-0 pb-3">
      <button
        onClick={onOpenSigunguSheet}
        className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-[12px] py-[6px] text-[12px] font-medium tracking-[-0.3px] text-white"
      >
        {label}
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggleIncludeExcluded}
        aria-pressed={includeExcluded}
        className="flex shrink-0 items-center gap-1.5 rounded-full pl-4 py-2 text-[12px] font-medium tracking-[-0.3px] text-neutral-500"
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded border',
            includeExcluded ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300 bg-white'
          )}
        >
          {includeExcluded && <Check className="size-3 text-white" strokeWidth={3} />}
        </span>
        제외된 동네 포함
      </button>
    </div>
  )
}

// 조율하기/저장하기(또는 solo의 단일 버튼) 액션바 — 리스트 위에 겹쳐서(absolute)
// 쓸 때 그라디언트로 아래 콘텐츠가 자연스럽게 페이드아웃되도록 fill 대신
// bg-gradient-to-t를 쓴다(요구사항: 패딩 영역에 fill 말고 그라디언트).
function ActionButtonsFooter({
  solo,
  retrying,
  saving,
  onRetry,
  onSave,
  onBackToWaiting,
  className,
}: {
  solo: boolean
  retrying: boolean
  saving: boolean
  onRetry: () => void
  onSave: () => void
  onBackToWaiting?: () => void
  className?: string
}) {
  // 버튼 자체는 배경이 불투명해 그라디언트 위에 있어도 상관없다 — 그라디언트
  // (페이드)는 버튼 위 여백에만 짧게 주고, 버튼은 불투명한 흰 배경 블록에 둔다.
  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="h-6 w-full bg-gradient-to-t from-white to-white/0" />
      <div className="flex w-full flex-col items-center justify-between gap-3 bg-white px-5 py-[10px]">
        {solo ? (
          <button
            onClick={onBackToWaiting}
            className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
          >
            대기 화면으로 돌아가기
          </button>
        ) : (
          <div className="flex w-full items-center gap-3">
            <button
              onClick={onRetry}
              disabled={retrying}
              className="flex flex-1 items-center justify-center rounded-full border-2 border-pink-500 bg-neutral-0 px-[42px] py-[18px] text-body-m font-bold text-pink-500 disabled:opacity-50"
            >
              조율하기
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-[40px] py-[16px] text-body-m font-bold text-white disabled:opacity-50"
            >
              저장하기
            </button>
          </div>
        )}
      </div>
    </div>
  )
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
  applyingConcession,
  onApplyConcession,
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
  // useMemo로 감싸 manualSigungus/groups가 실제로 바뀔 때만 새 Set을 만든다 —
  // 이전엔 매 렌더 새 Set을 만들어서, 이 값을 deps로 쓰는 지도 bounds-fit
  // effect가 카드 클릭 등 무관한 상태 변경에도 매번 재실행되며 focusPin의
  // 줌인을 곧바로 덮어써버리는 버그가 있었다(실측 확인).
  const selectedSigungus = useMemo(
    () =>
      manualSigungus
        ? new Set(Array.from(manualSigungus).filter((s) => groups.some((g) => g.sigungu === s)))
        : new Set(groups.map((g) => g.sigungu)),
    [manualSigungus, groups]
  )

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

  // 리스트를 스크롤하면 필터 영역을 접어 카드가 보이는 공간을 넓히고, 맨
  // 위로 돌아오면 다시 펼친다(ResultAreaGroupList의 onAtTopChange가 알려줌).
  const [filterVisible, setFilterVisible] = useState(true)

  // 매칭 성공 분기만 3단 스냅(접힘/중간/전체)을 쓴다 — fallback·solo는 그 콘텐츠에
  // 맞춘 자연 높이(접힘/전체 2단)를 그대로 유지한다(범위 밖).
  const snapPoints = useMemo(
    () => (isFallback || solo ? [SNAP_COLLAPSED, SNAP_FULL] : [SNAP_COLLAPSED, SNAP_MID, SNAP_FULL]),
    [isFallback, solo]
  )
  const [snap, setSnap] = useState<number | string | null>(() =>
    isFallback || solo ? SNAP_FULL : SNAP_MID
  )
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

  // 스크롤로 포커스된 시군구(핑크 60% 배경 틴트)와 클릭으로 선택된 카드(핑크
  // 테두리)는 서로 독립적인 두 상태다 — ResultAreaGroupList의 스크롤스파이와
  // 카드 클릭이 각각 갱신한다.
  const [focusedSigungu, setFocusedSigungu] = useState<string | null>(null)
  const [selectedAreaCode, setSelectedAreaCode] = useState<string | null>(null)

  function handleCollapsedHandlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    collapsedDragStartY.current = e.clientY
  }

  function handleCollapsedHandlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (collapsedDragStartY.current === null) return
    if (collapsedDragStartY.current - e.clientY > 24) {
      setSnap(isFallback || solo ? SNAP_FULL : SNAP_MID)
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

  // 세로 그룹 리스트(ResultAreaGroupList)용 — activeAreas와 같은 필터를 시군구
  // 그룹 구조를 유지한 채 적용한다. selectedSigungus는 매 렌더 새로 파생되는
  // Set이라 deps에 넣으면 매번 재계산되므로, 실제 의존은 groups/manualSigungus다
  // (파일 전반에 이미 쓰인 패턴 — 아래 bounds-fit effect와 동일).
  const visibleGroups = useMemo(
    () =>
      groups
        .filter((g) => selectedSigungus.has(g.sigungu))
        .map((g) => ({
          sigungu: g.sigungu,
          list: g.list.filter((a) => includeExcluded || !excludedCodes.has(a.code)),
        }))
        .filter((g) => g.list.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, manualSigungus, includeExcluded, excludedCodes]
  )

  // 필터 변경으로 포커스 중인 시군구가 화면에서 사라지면(예: 그 시군구를
  // 선택 해제하거나 "제외된 동네 포함"을 꺼서 그룹이 비면) 첫 번째로 보이는
  // 그룹으로 대체해 렌더링한다 — effect로 상태를 되맞추는 대신, 렌더 중
  // 파생값으로 계산해 불필요한 재렌더를 피한다.
  const effectiveFocusedSigungu =
    focusedSigungu && visibleGroups.some((g) => g.sigungu === focusedSigungu)
      ? focusedSigungu
      : (visibleGroups[0]?.sigungu ?? null)

  // 서로 양보(AB) 단일안 후보 — get_concession_matches가 계산해둔 순위 그대로
  // 지도 핀만 찍는다(카드 리스트는 더 이상 이 화면에서 보여주지 않음).
  const concessionCopy = concession ? buildConcessionCopy(concession) : null
  const concessionStats = concession
    ? buildStatsComparisonProps(concession.main)
    : { rows: [], benefit: null }

  const pins: PinData[] = isFallback
    ? (concession?.main.areas ?? [])
        .map((a) => toPin({ ...a, lat: a.lat ?? undefined, lng: a.lng ?? undefined }, 'neutral'))
        .filter((p): p is PinData => p != null)
    : activeAreas.map((a) => toPin(a, 'neutral')).filter((p): p is PinData => p != null)

  // 핀을 클릭하거나(호갱노노처럼) 바텀시트에서 카드를 선택했을 때 지도를
  // 그 좌표로 확대·이동한다.
  function focusPin(lat: number, lng: number) {
    const kakaoMap = mapRef.current
    if (!kakaoMap) return
    kakaoMap.setLevel(PIN_FOCUS_LEVEL)
    kakaoMap.setCenter(new kakao.maps.LatLng(lat, lng))
  }

  // 리스트 스크롤로 포커스된 시군구를 따라가는 약한 이동 — 줌 레벨은 바꾸지
  // 않는다. 스크롤할 때마다 확대까지 하면 산만하고, 사용자가 직접 축소해둔
  // 지도를 자꾸 되돌리게 되므로 pan만 한다(명시적 클릭 시엔 focusPin으로 줌인).
  function panPin(lat: number, lng: number) {
    const kakaoMap = mapRef.current
    if (!kakaoMap) return
    kakaoMap.setCenter(new kakao.maps.LatLng(lat, lng))
  }

  // 지도 핀을 클릭하면 그 좌표로 확대하는 것과 동시에, 시트가 접혀있으면
  // 펼치고 바텀시트 안 해당 카드로 스크롤해 정보를 보여준다.
  function focusArea(code: string, lat: number, lng: number) {
    focusPin(lat, lng)
    setSnap((prev) => (prev === SNAP_COLLAPSED ? SNAP_MID : prev))
    requestAnimationFrame(() => {
      cardRefs.current[code]?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    })
  }

  // 카드를 클릭한 직후 짧은 시간 동안은 스크롤스파이의 pan을 무시한다 —
  // 클릭이 (완전히 보이지 않던 카드라) 리스트를 살짝 스크롤시키면 그 스크롤이
  // 곧바로 IntersectionObserver 콜백을 유발해 방금 focusPin으로 줌인한 지도를
  // 다른 그룹으로 되돌려버리는 경합이 실측 확인됐다 — 클릭이라는 명시적
  // 의도가 스크롤 추적보다 우선해야 한다.
  const suppressPanUntilRef = useRef(0)

  // ResultAreaGroupList의 스크롤스파이가 통지하는 "현재 화면 중간에 걸린
  // 시군구" — 배경 틴트 + 지도 pan(줌 유지).
  function handleGroupFocusChange(sigungu: string | null) {
    setFocusedSigungu(sigungu)
    // 이벤트 콜백(스크롤스파이 통지)에서만 호출되는 함수라 렌더 중 실행되지
    // 않는다 — Date.now()는 여기선 순수성 문제가 없다.
    // eslint-disable-next-line react-hooks/purity
    if (!sigungu || Date.now() < suppressPanUntilRef.current) return
    const rep = visibleGroups
      .find((g) => g.sigungu === sigungu)
      ?.list.find((a) => a.lat != null && a.lng != null)
    if (rep) panPin(rep.lat!, rep.lng!)
  }

  // 카드를 직접 클릭했을 때 — 테두리 강조 + 지도 줌인(기존 focusPin 그대로).
  function handleCardSelect(area: ResultAreaData) {
    setSelectedAreaCode(area.code)
    // 클릭 이벤트 핸들러에서만 호출된다 — 렌더 중 실행되지 않으므로 안전하다.
    // eslint-disable-next-line react-hooks/purity
    suppressPanUntilRef.current = Date.now() + 600
    if (area.lat != null && area.lng != null) focusPin(area.lat, area.lng)
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

  // 폴백(매칭 0건)일 때도 "추천 동네" 타이틀은 그대로 두고, 진단 문구는
  // 옆에 subtitle로 나란히 붙인다(Figma: 추천 동네 + 통근·예산 조건에 맞는
  // 구역이 없어요).
  const title = solo ? '먼저 둘러보기' : '추천 동네'
  const subtitle = !solo && isFallback ? '통근·예산 조건에 맞는 구역이 없어요' : undefined

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
          subtitle={subtitle}
          count={isFallback ? undefined : activeAreas.length}
          partnerConfirmed={isFallback ? undefined : partnerConfirmed ?? undefined}
        />
      </div>

     {!isCollapsed && (
      <Drawer.Root
        open
        modal={false}
        dismissible={false}
        snapPoints={snapPoints}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="pointer-events-none fixed inset-0 bg-black/40" />
          {/* 매칭 성공 분기는 h-dvh로 고정해 SNAP_FULL(offset=0)이 실제
              전체화면이 되도록 하고(요구사항 4), fallback·solo는 기존처럼
              max-h만 안전장치로 둔 자연 높이를 유지한다(범위 밖 — 그대로). */}
          <Drawer.Content
            className={cn(
              'fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-pink-100 bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.1)] outline-none',
              isFallback || solo ? 'max-h-[92dvh]' : 'h-dvh'
            )}
          >
            <button className="h-7 shrink-0">
              <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />
            </button>

            {!isCollapsed && (
              <div
                className="flex min-h-0 flex-1 flex-col"
                // Drawer.Content 박스 자체는 h-dvh로 고정돼 있어(요구사항 4를 위해)
                // flex-1만으로는 지금 스냅에서 실제로 "보이는" 높이를 알 수 없다
                // (vaul이 translateY로 박스를 가릴 뿐, 박스 자신은 항상 뷰포트
                // 전체 높이라 flex 계산은 항상 그 기준으로 이뤄진다). vaul이
                // Drawer.Content에 심어주는 --snap-point-height(현재 스냅의
                // translateY 오프셋)로 실제 보이는 높이를 역산해 캡을 걸어야
                // 안의 리스트가 "보이는 만큼만" 스크롤 영역을 갖는다(요구사항 5).
                style={{ maxHeight: 'calc(100dvh - var(--snap-point-height, 0px) - 28px)' }}
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
                        totalCount={concession?.main.total_count ?? 0}
                        tipTitle={concessionCopy?.tipTitle ?? '이렇게 조율해봤어요'}
                        tipBody={concessionCopy?.tipBody ?? ''}
                        giveChips={concessionCopy?.giveChips ?? []}
                        stats={concessionStats}
                        applying={applyingConcession}
                        onApply={onApplyConcession}
                      />
                    </div>
                  )
                ) : (
                  <>
                    {/* Figma: 힌트 메시지가 위, 그 아래 필터 영역이 온다 — "왜 이
                        동네들이 추천됐을까요?"는 우선순위 근거 시트(ConditionSummarySheet)를
                        여는 트리거로, 예전 "우선순위 : ..." 요약 버튼을 대체한다. */}
                    <button
                      onClick={() => setConditionSheetOpen(true)}
                      className="flex w-full shrink-0 items-center justify-between px-5 py-4"
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/asset/icon/message-fill.svg" alt="" className="size-5 shrink-0" />
                        <span className="truncate text-[14px] font-medium tracking-[-0.35px] text-neutral-900">
                          왜 이 동네들이 추천됐을까요?
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-neutral-400" />
                    </button>

                    {groups.length > 0 && (
                      <div
                        className={cn(
                          'grid shrink-0 overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out',
                          filterVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                        )}
                      >
                        <div className="min-h-0">
                          <FilterChipRow
                            label={sigunguTriggerLabel(selectedSigungus)}
                            onOpenSigunguSheet={() => setSigunguSheetOpen(true)}
                            includeExcluded={includeExcluded}
                            onToggleIncludeExcluded={() => setIncludeExcluded((v) => !v)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="min-h-0 flex-1">
                      <ResultAreaGroupList
                        groups={visibleGroups}
                        excludedCodes={excludedCodes}
                        onExclude={excludeArea}
                        onRestore={restoreArea}
                        selectedAreaCode={selectedAreaCode}
                        focusedSigungu={effectiveFocusedSigungu}
                        onCardSelect={handleCardSelect}
                        onGroupFocusChange={handleGroupFocusChange}
                        registerCardRef={(code, el) => {
                          cardRefs.current[code] = el
                        }}
                        onAtTopChange={setFilterVisible}
                        emptyLabel="이 조건을 만족하는 구역이 없어요"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
     )}

      {/* vaul이 snapPoint 오프셋을 Drawer.Content 자체에 transform으로 적용하는데,
          CSS상 transform이 걸린 조상은 그 안의 fixed/absolute 자손의 containing
          block이 된다 — 즉 Drawer.Content 안에 action bar를 absolute bottom-0로
          두면 "화면 하단"이 아니라 "h-dvh 박스(내용보다 훨씬 큼)의 바닥"에 붙어
          버려서 중간 스냅에서는 화면 밖으로 밀려난다. 그래서 접힘 상태와 동일하게
          Drawer.Content 밖, 뷰포트 기준 fixed로 따로 띄운다(중간/전체 스냅
          공통 — 어느 스냅이든 시트의 시각적 바닥은 항상 화면 맨 아래와 일치한다). */}
      {!isFallback && !isCollapsed && (
        <ActionButtonsFooter
          className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md"
          solo={solo}
          retrying={retrying}
          saving={saving}
          onRetry={onRetry}
          onSave={() => onSave(savedAreaCodes)}
          onBackToWaiting={onBackToWaiting}
        />
      )}

            {!isFallback && isCollapsed && (
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md flex-col items-center bg-white rounded-t-3xl border-2 border-pink-100">
        {/* Drawer.Content의 핸들은 접힌 스냅에서 이 fixed 블록에 가려 안 보이므로,
            접혔을 때 다시 펼 수 있도록 여기에도 탭/드래그 가능한 핸들을 따로 둔다. */}

          <button
            type="button"
            onClick={() => setSnap(isFallback || solo ? SNAP_FULL : SNAP_MID)}
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
            펼쳐져 있을 땐 시트 안(이전 디자인)에서 대신 보여준다. Figma
            State A(접힘)는 우선순위 요약 대신 필터칩 영역을 보여준다. */}
        {!isFallback && isCollapsed && (
          <>
          {groups.length > 0 && (
            <FilterChipRow
              label={sigunguTriggerLabel(selectedSigungus)}
              onOpenSigunguSheet={() => setSigunguSheetOpen(true)}
              includeExcluded={includeExcluded}
              onToggleIncludeExcluded={() => setIncludeExcluded((v) => !v)}
            />
          )}
          <ActionButtonsFooter
            className="w-full"
            solo={solo}
            retrying={retrying}
            saving={saving}
            onRetry={onRetry}
            onSave={() => onSave(savedAreaCodes)}
            onBackToWaiting={onBackToWaiting}
          />
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
                  <ResultAreaCard key={area.code} area={area} fullWidth />
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
