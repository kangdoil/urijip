// 랭킹순으로 정렬된 목록을 시군구별로 묶는다. Map 삽입 순서를 그대로 쓰면
// 그룹 자체도 1위 항목이 속한 그룹부터, 그룹 내부도 랭킹순으로 자연히 정렬된다
// (grouped-area-list.tsx, result-map-sheet.tsx가 공유).
export function groupBySigungu<T extends { sigungu: string }>(
  items: T[]
): { sigungu: string; list: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(item.sigungu) ?? []
    list.push(item)
    map.set(item.sigungu, list)
  }
  return Array.from(map.entries()).map(([sigungu, list]) => ({ sigungu, list }))
}
