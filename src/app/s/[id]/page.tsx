'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Check, Copy, RefreshCw } from 'lucide-react'
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
    // 상대방이 참여한 뒤에도 조건 입력을 마쳤는지(bothReady)는 계속 폴링해야
    // "새로고침" 없이 자동으로 다음 화면(결과 보기)으로 넘어간다.
    const interval = setInterval(() => {
      setBothReady((ready) => {
        if (!ready) refresh()
        return ready
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  function copyInviteUrl() {
    // writeText는 동기적으로도, Promise reject로도 실패할 수 있다 — 클립보드
    // 접근이 막힌 환경(권한 거부 등)이어도 UI 피드백(토스트)은 그대로 보여준다.
    try {
      navigator.clipboard.writeText(inviteUrl)?.catch(() => {})
    } catch {
      // ignore
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function shareInviteUrl() {
    if (navigator.share) {
      try {
        await navigator.share({ title: '우리집에 초대할게요', url: inviteUrl })
        return
      } catch {
        // 사용자가 공유를 취소했거나 미지원 — 클립보드 복사로 대체한다.
      }
    }
    copyInviteUrl()
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
    ? '상대방이 조건 입력을 완료했어요'
    : partnerJoined
      ? '상대방이 참여했어요'
      : '상대방에게 초대를 보냈어요'

  const description = bothReady
    ? '아래 버튼을 눌러 동네를 확인해보세요'
    : partnerJoined
      ? '조건 입력을 완료하면 알려드릴게요'
      : '상대방이 참여해야 결과를 볼 수 있어요'

  const footerNote = bothReady ? (
    <>
      두 사람의 조건을 분석하여
      <br />
      가장 완벽한 동네들을 선정했어요
    </>
  ) : partnerJoined ? (
    <>
      내 조건은 상대방이 입력을
      <br />
      마치지 전까지 공개되지 않아요
    </>
  ) : (
    <>
      상대방이 접속하고 이름을 입력하면
      <br />
      상대방 쪽에도 불이 들어와요
    </>
  )

  return (
    <main
      className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-y-auto bg-neutral-50 px-4 pt-16"
      style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.03em] text-neutral-900">
          {title}
        </h1>
        <p className="text-base leading-[1.4] tracking-[-0.015em] text-neutral-500">
          {description}
        </p>
      </div>

      {/* 드래그 가능한 바텀시트가 아니라, 일반 문서 흐름 안에 놓인 정적 카드 */}
      <div className="mt-6 flex flex-col items-center gap-8 rounded-[40px] bg-white p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]">
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

      {copied && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[108px] z-30 flex justify-center px-4">
          <span className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-full bg-neutral-900 px-5 py-3 text-body-sb font-semibold text-neutral-0 shadow-lg">
            클립보드에 복사되었어요
          </span>
        </div>
      )}

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
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-[2] items-center justify-between gap-2 rounded-full border border-neutral-200 bg-white px-4 py-3">
              <span className="truncate text-body-s text-neutral-500">{inviteUrl}</span>
              <button
                onClick={copyInviteUrl}
                aria-label="초대 링크 복사"
                className="shrink-0 text-neutral-400 transition-colors hover:text-neutral-600"
              >
                <Copy className="size-4" />
              </button>
            </div>
            <Button onClick={shareInviteUrl} className="flex-1 font-montserrat text-mont-title-m">
              Share
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
