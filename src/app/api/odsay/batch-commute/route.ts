import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { ensureCommuteForOrigin } from '@/lib/commute'
import { createClient } from '@/lib/supabase/server'

// 참여자가 거점을 확정하면 호출한다. 대중교통 기준 모든 구역까지의
// 통근시간을 commute_cache에 채워서, 이후 매칭 계산이 캐시만으로 끝나게 한다.
//
// 이 배치는 구역 수만큼 ODsay를 순차 호출해 수 분~수십 분 걸릴 수 있다
// (실측: 152개 기준 평균 38분, 최악 141분). 예전엔 클라이언트가 이 응답을
// 그대로 기다렸다가 온보딩 다음 화면으로 넘어가서, 그 시간 동안 화면이
// 멈춘 것처럼 보였다. 이제는 응답을 즉시 돌려주고, 실제 계산은 after()로
// 응답 전송 이후에도 서버에서 계속 실행한다 — 클라이언트 탭을 닫거나
// 다른 화면으로 이동해도(모바일 백그라운드 포함) 서버 쪽 작업은 끝까지
// 진행된다. 완료 시각은 participants.commute_batch_done_at에 기록하고,
// 결과/조율 화면은 이 값을 폴링해서 "매칭 0건"과 "아직 계산 중"을 구분한다.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { originLat, originLng, mode, sessionId } = body ?? {}

  if (typeof originLat !== 'number' || typeof originLng !== 'number' || !sessionId) {
    return NextResponse.json({ error: '좌표와 세션 정보가 필요해요' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return NextResponse.json({ error: '로그인이 필요해요' }, { status: 401 })
  }
  const userId = userData.user.id

  after(async () => {
    try {
      await ensureCommuteForOrigin(originLat, originLng, mode ?? 'car')
    } catch (e) {
      console.error('통근시간 배치 실패', e)
    } finally {
      await supabase
        .from('participants')
        .update({ commute_batch_done_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('user_id', userId)
    }
  })

  return NextResponse.json({ status: 'accepted' })
}
