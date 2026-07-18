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
    // mixpanel-browser 기본값(batch_requests: true)은 이벤트를 최대 5초까지
    // 모았다가 한 번에 보낸다 — 실측 확인: 초대 링크 열람(invite_opened) 같은
    // 이벤트가 발화는 되지만 네트워크 전송은 5~10초 뒤에야 일어났다. 이 앱은
    // 카카오톡 인앱 브라우저로 초대 링크를 열고 곧바로 다음 화면으로 넘어가는
    // 흐름이 많아, 그 사이 탭/인앱 브라우저가 닫히면 배치가 아직 안 나간 이벤트가
    // 유실된다. 배치를 끄고 이벤트마다 즉시 전송한다.
    batch_requests: false,
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
