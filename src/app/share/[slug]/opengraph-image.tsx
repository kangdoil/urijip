import { ImageResponse } from 'next/og'
import { getSharedResult } from '@/lib/shared-result'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const shared = await getSharedResult(slug)
  const count = shared?.areas.length ?? 0
  const topNames = (shared?.areas ?? [])
    .slice(0, 3)
    .map((a) => a.name)
    .join(' · ')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.85, marginBottom: 24 }}>
          우리집
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, textAlign: 'center' }}>
          {count > 0 ? `함께 살 수 있는 구역 ${count}곳` : '아직 함께 갈 구역을 찾는 중이에요'}
        </div>
        {topNames && (
          <div style={{ fontSize: 32, opacity: 0.85, marginTop: 24 }}>{topNames}</div>
        )}
      </div>
    ),
    size
  )
}
