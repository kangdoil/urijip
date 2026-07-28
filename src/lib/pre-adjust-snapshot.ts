// 조율(재조정)로 조건이 바뀌기 직전의 매칭 동네 코드를 세션스토리지에 남겨
// "새로 추가된 동네" New 뱃지를 판정하는 유일한 기준이다 — 서버는 매칭
// 이력을 남기지 않고(get_matches는 매번 새로 계산) 매번 그 순간의 결과만
// 돌려주기 때문이다.
//
// 조율을 시작하는 쪽(제안자, 결과 화면의 "조율하기" 클릭)과 조율을 받아
// 결정하는 쪽(피결정자, 조율 화면에서 "이 조건 수락하기") 양쪽 모두 조건이
// 바뀌기 직전에 이 스냅샷을 남겨야 한다 — 한쪽만 남기면(예: 제안자만) 상대는
// 자기 세션스토리지에 스냅샷이 없어 New 뱃지가 아예 안 뜨는 문제가 있었다
// (실측 확인: 제안자는 보이는데 결정자는 안 보임).
function preAdjustSnapshotKey(sessionId: string) {
  return `urijib:pre_adjust_codes:${sessionId}`
}

export function snapshotAreaCodesBeforeAdjust(sessionId: string, codes: string[]) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(preAdjustSnapshotKey(sessionId), JSON.stringify(codes))
}

// 조율 후 돌아와 get_matches를 다시 부른 직후 1회 호출 — 스냅샷이 있으면 거기
// 없던 코드만 "새로 추가됨"으로 판정하고, 다음 새로고침엔 다시 안 뜨도록
// 스냅샷을 지운다. 스냅샷이 없으면(조율을 거치지 않은 첫 방문 등) 빈 Set.
export function diffNewAreaCodes(sessionId: string, currentCodes: string[]): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const key = preAdjustSnapshotKey(sessionId)
  const prevRaw = window.sessionStorage.getItem(key)
  if (!prevRaw) return new Set()
  window.sessionStorage.removeItem(key)
  const prevCodes = new Set<string>(JSON.parse(prevRaw))
  return new Set(currentCodes.filter((code) => !prevCodes.has(code)))
}
