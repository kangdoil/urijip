export const CONDITION_LABEL: Record<string, string> = {
  area_size: '평형',
  build_year: '년식',
  infra: '인프라',
}

export function formatEok(krw: number | null) {
  if (krw == null) return '-'
  return `${(krw / 100_000_000).toFixed(1)}억`
}
