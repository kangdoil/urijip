import { ImageResponse } from 'next/og'
import { getInvitePreview } from '@/lib/invite-preview'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'

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
          {`${inviterName}님이`}
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, textAlign: 'center' }}>
          신혼집 찾기에 초대했어요
        </div>
      </div>
    ),
    size
  )
}
