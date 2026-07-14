'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Drawer } from 'vaul'
import { Check, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface SessionRow {
  id: string
  invite_code: string
  status: string
}

interface MyParticipant {
  role: 'A' | 'B'
  display_name: string | null
}

interface PresenceParticipant {
  role: 'A' | 'B'
  display_name: string | null
  completed_at: string | null
}

interface Presence {
  participant_count: number
  roles: ('A' | 'B')[]
  participants: PresenceParticipant[]
}

// 시트를 드래그해서 접고 펼 수 있게 2단계 snap만 쓴다(콘텐츠 자체는 두
// 단계에서 동일 — 결과 화면처럼 내용을 숨기는 용도가 아니라 드래그 여지를
// 주기 위한 것).
const SNAP_POINTS = [0.68, 0.92]

function Avatar({
  src,
  alt,
  bg,
  border,
  faded = false,
  checked = false,
  checkBg,
}: {
  src: string
  alt: string
  bg: string
  border: string
  faded?: boolean
  checked?: boolean
  checkBg: string
}) {
  return (
    <div className={`relative shrink-0 ${faded ? 'opacity-20' : ''}`}>
      <div
        className={`flex size-20 items-center justify-center overflow-hidden rounded-full border-4 ${bg} ${border}`}
      >
        <Image src={src} alt={alt} width={70} height={70} className="size-[70px] object-cover" />
      </div>
      {checked && (
        <span
          className={`absolute top-0 right-0 flex size-6 items-center justify-center rounded-full text-neutral-0 ${checkBg}`}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </div>
  )
}

function NamePill({ label, bg, faded = false }: { label: string; bg: string; faded?: boolean }) {
  return (
    <span
      className={`flex h-10 w-[88px] shrink-0 items-center justify-center rounded-full text-sm font-semibold text-neutral-0 ${bg} ${faded ? 'opacity-20' : ''}`}
    >
      {label}
    </span>
  )
}

export default function SessionPage() {
  const params = useParams<{ id: string }>()
  const sessionId = params.id

  const [session, setSession] = useState<SessionRow | null>(null)
  const [me, setMe] = useState<MyParticipant | null>(null)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [bothReady, setBothReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0])

  const refresh = useCallback(async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return

    const { data: sessionRow, error: sessionError } = await supabase
      .from('sessions')
      .select('id, invite_code, status')
      .eq('id', sessionId)
      .single()
    if (sessionError) {
      setError('세션을 찾을 수 없어요')
      return
    }
    setSession(sessionRow)
    setInviteUrl(`${window.location.origin}/j/${sessionRow.invite_code}`)

    const { data: myRow } = await supabase
      .from('participants')
      .select('role, display_name')
      .eq('session_id', sessionId)
      .eq('user_id', userData.user.id)
      .single()
    setMe(myRow ?? null)

    const { data: presenceData, error: presenceError } = await supabase.rpc(
      'get_session_presence',
      { sid: sessionId }
    )
    if (!presenceError) setPresence(presenceData as Presence)

    const { data: readyData } = await supabase.rpc('session_is_ready', {
      sid: sessionId,
    })
    setBothReady(Boolean(readyData))
  }, [sessionId])

  useEffect(() => {
    refresh()
    const interval = setInterval(() => {
      setPresence((prev) => {
        if (prev && prev.participant_count >= 2) return prev
        refresh()
        return prev
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  function copyInviteUrl() {
    try {
      navigator.clipboard.writeText(inviteUrl)
    } catch {
      // 클립보드 접근이 막힌 환경(권한 거부 등)이어도 UI 피드백은 그대로 보여준다.
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center bg-neutral-50 p-6">
        <p className="text-red-600">{error}</p>
      </main>
    )
  }

  if (!session || !me || !presence) return null

  const aInfo = presence.participants.find((p) => p.role === 'A') ?? null
  const bInfo = presence.participants.find((p) => p.role === 'B') ?? null
  const partnerJoined = presence.participant_count >= 2

  const title = bothReady
    ? '모두 조건 입력을 완료했어요'
    : partnerJoined
      ? '상대방이 참여했어요'
      : '상대방에게 초대를 보냈어요'

  const description = bothReady ? (
    <>
      두 사람의 조건을 분석하여
      <br />
      가장 완벽한 동네를 추천할게요
    </>
  ) : partnerJoined ? (
    <>
      내 조건은 상대방이 입력을
      <br />
      마치지 전까지 공개되지 않아요
    </>
  ) : (
    '상대방이 참여해야 결과를 볼 수 있어요'
  )

  const footerNote = partnerJoined ? (
    <>
      조건 입력이 끝나면 아래 새로고침을 통해
      <br />
      결과를 확인할 수 있어요
    </>
  ) : (
    <>
      상대방이 접속하고 이름을 입력하면
      <br />
      상대방 쪽에도 불이 들어와요
    </>
  )

  return (
    <main className="relative mx-auto h-dvh w-full max-w-md overflow-hidden bg-neutral-50">
      <div className="absolute inset-x-0 top-[7%] px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
            {title}
          </h1>
          <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
            {description}
          </p>
        </div>
      </div>

      <Drawer.Root
        open
        dismissible={false}
        snapPoints={SNAP_POINTS}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-10 mx-auto flex h-full max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.1)] outline-none">
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />

            <div
              className="flex-1 overflow-y-auto px-4 pt-6"
              style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
            >
              <div className="flex flex-col items-center gap-8 rounded-[40px] bg-white p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-5">
                    <Avatar
                      src="/asset/urijip_A.png"
                      alt="A"
                      bg="bg-pink-100"
                      border="border-pink-500"
                      checked={Boolean(aInfo?.completed_at)}
                      checkBg="bg-pink-500"
                    />
                    <NamePill label={aInfo?.display_name ?? 'A'} bg="bg-pink-500" />
                  </div>

                  <div className="h-1 w-[92px] shrink-0 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full w-[58%] rounded-full bg-pink-500" />
                  </div>

                  <div className="flex flex-col items-center gap-5">
                    <Avatar
                      src="/asset/urijip_B.png"
                      alt="B"
                      bg="bg-accent-teal/10"
                      border="border-accent-teal"
                      faded={!partnerJoined}
                      checked={Boolean(bInfo?.completed_at)}
                      checkBg="bg-accent-teal"
                    />
                    <NamePill
                      label={bInfo?.display_name ?? '?'}
                      bg="bg-accent-teal"
                      faded={!partnerJoined}
                    />
                  </div>
                </div>

                <div className="h-px w-full bg-neutral-100" />

                <p className="text-center text-body-s text-neutral-500">{footerNote}</p>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md px-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        {bothReady ? (
          <Button asChild className="w-full font-montserrat text-mont-title-m">
            <Link href={`/s/${sessionId}/result`}>View results</Link>
          </Button>
        ) : partnerJoined ? (
          <button
            onClick={refresh}
            aria-label="새로고침"
            className="mx-auto flex size-16 items-center justify-center rounded-full bg-neutral-900 text-neutral-0 shadow-lg"
          >
            <RefreshCw className="size-5" />
          </button>
        ) : (
          <Button
            variant="outline"
            onClick={copyInviteUrl}
            className="w-full border-2 border-pink-500 text-pink-500 hover:bg-pink-50"
          >
            {copied ? '링크를 복사했어요' : '초대 링크 복사'}
          </Button>
        )}
      </div>
    </main>
  )
}
