import mixpanel from 'mixpanel-browser'

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN

let initialized = false

function ensureInit() {
  if (initialized || !TOKEN || typeof window === 'undefined') return
  mixpanel.init(TOKEN, {
    persistence: 'localStorage',
    // 분석 단위는 세션(session_id)이지 유저가 아니라서 people/identify는 쓰지 않고
    // 이벤트 프로퍼티로만 session_id·role을 부착한다 (docs/metrics-events.md 기준).
    autocapture: false,
  })
  initialized = true
}

export type Role = 'A' | 'B' | '미참여'

function getDevice(): 'mobile' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop'
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
}

// docs/metrics-events.md §2의 MVP 10개 이벤트만 이 유니언에 존재한다 — 목록 밖
// 이벤트명은 타입 에러가 나도록 해서 "임의 이벤트 추가 금지"(§4 운영 원칙)를 강제한다.
interface EventMap {
  session_created: { source: 'organic' | 'share_link' }
  invite_sent: { channel: 'share' | 'copy' }
  invite_opened: { invite_code: string }
  b_started: Record<string, never>
  input_completed: { duration_sec: number }
  result_viewed: { is_first_view: boolean; candidate_count: number; had_conflict: boolean }
  result_saved: { is_joint_complete: boolean }
  result_retry: Record<string, never>
  feedback_submitted: { reaction: 'up' | 'down'; has_comment: boolean; trigger: 'resolved' | 'dwell' }
  result_exported: { format: 'image' | 'text' }
}

interface CommonProps {
  // invite_opened는 join 이전이라 실제 sessions.id를 모른다 — 그 경우 null.
  session_id: string | null
  role: Role
}

export function track<E extends keyof EventMap>(
  event: E,
  common: CommonProps,
  props: EventMap[E]
) {
  ensureInit()
  if (!TOKEN || typeof window === 'undefined') return
  mixpanel.track(event, {
    session_id: common.session_id,
    role: common.role,
    device: getDevice(),
    ...props,
  })
}

// Next.js App Router는 클라이언트 라우팅 시 풀 리로드가 없어 Mixpanel의 기본
// track_pageview 초기 1회 발화만으로는 이후 화면 전환을 못 잡는다 — 그래서
// pathname 변화를 감지하는 쪽(MixpanelPageview 컴포넌트)에서 매번 이 함수를 부른다.
export function trackPageview() {
  ensureInit()
  if (!TOKEN || typeof window === 'undefined') return
  mixpanel.track_pageview()
}
