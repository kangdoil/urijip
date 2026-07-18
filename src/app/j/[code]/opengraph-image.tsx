import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ImageResponse } from 'next/og'
import { getInvitePreview } from '@/lib/invite-preview'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// next/og(Satori)는 브라우저의 next/font 설정을 그대로 못 쓰고 폰트 바이트를
// 직접 넘겨야 하며, WOFF2는 지원하지 않는다(TTF/OTF만 가능 — 실측 확인:
// "Unsupported OpenType signature wOF2"). Montserrat는 로컬에 정적 웨이트
// 파일이 없어 요청 시점에 Google Fonts에서 받아온다(Vercel 공식 예제와 동일한
// 패턴 — UA를 안 보내면 Google이 TTF로 응답한다).
async function loadGoogleFont(family: string, weight: number, text: string) {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`
    )
  ).text()
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/)
  if (!match) throw new Error(`${family} 폰트를 불러오지 못했어요`)
  const res = await fetch(match[1])
  return res.arrayBuffer()
}

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const preview = await getInvitePreview(code)
  const inviterName = preview?.inviter_name ?? '배우자'
  const heading = `${inviterName}님이 우리집 찾기에 초대했어요`

  // fetch(new URL(path, import.meta.url))는 웹팩 문서에 나오는 패턴이지만
  // Turbopack(next dev 기본값)의 Node 런타임에선 file: URL을 fetch가 못 읽는다
  // ("not implemented... yet..." 오류, 실측 확인) — fs로 직접 읽는다.
  const [pretendardSemiBold, montserratExtraBold, illustration] = await Promise.all([
    readFile(fileURLToPath(new URL('../../../../public/fonts/Pretendard-SemiBold.otf', import.meta.url))),
    loadGoogleFont('Montserrat', 800, 'URIJIP'),
    readFile(fileURLToPath(new URL('../../../../public/asset/invite-og-illustration.png', import.meta.url))),
  ])
  const illustrationSrc = `data:image/png;base64,${illustration.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: '#fff0f5',
        }}
      >
        <img
          src={illustrationSrc}
          alt=""
          width={948}
          height={533}
          style={{ position: 'absolute', left: 126, top: 66, objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 86,
            display: 'flex',
            justifyContent: 'center',
            fontFamily: 'Montserrat',
            fontWeight: 800,
            fontSize: 96,
            lineHeight: 1.2,
            color: '#0f172a',
          }}
        >
          URIJIP
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 201,
            display: 'flex',
            justifyContent: 'center',
            fontFamily: 'Pretendard',
            fontWeight: 600,
            fontSize: 32,
            letterSpacing: -0.96,
            color: '#0f172a',
          }}
        >
          {heading}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Pretendard', data: pretendardSemiBold, weight: 600, style: 'normal' },
        { name: 'Montserrat', data: montserratExtraBold, weight: 800, style: 'normal' },
      ],
    }
  )
}
