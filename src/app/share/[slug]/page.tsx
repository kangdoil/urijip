import type { Metadata } from 'next'
import Link from 'next/link'
import { getSharedResult } from '@/lib/shared-result'
import { formatEok } from '@/lib/condition-labels'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type Props = {
  params: Promise<{ slug: string }>
}

// 시군구별 추천 동네 상한(grouped-area-list.tsx의 "상위 최대 5곳" 규칙과 동일) —
// "총 N곳" 문구의 숫자를 시군구 수 × 5로 계산하는 기준값이다.
const RECOMMENDED_PER_SIGUNGU = 5

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const shared = await getSharedResult(slug)
  const title = shared
    ? `함께 살 수 있는 동네 ${new Set(shared.areas.map((a) => a.sigungu)).size * RECOMMENDED_PER_SIGUNGU}곳`
    : '우리집 — 결과 공유'

  return {
    title,
    description: '두 사람이 함께 조율한 주거 동네 결과예요',
    openGraph: {
      title,
      description: '우리집에서 조건을 맞춰보고 함께 살 동네를 찾아보세요',
    },
  }
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params
  const shared = await getSharedResult(slug)
  const count = shared
    ? new Set(shared.areas.map((a) => a.sigungu)).size * RECOMMENDED_PER_SIGUNGU
    : 0

  if (!shared) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-neutral-500">존재하지 않거나 만료된 공유 링크예요</p>
      </main>
    )
  }

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-[13px] text-neutral-500">우리집 · 결과 공유</p>
        <p className="mb-4 text-xl font-semibold text-neutral-900">
          {count > 0 ? `함께 살 수 있는 동네 ${count}곳` : '아직 함께 갈 동네를 찾는 중이에요'}
        </p>

        <div className="mb-5 flex flex-col gap-2">
          {shared.areas.length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-400">
              조건을 조율하는 중이에요 · 곧 결과가 나올 거예요
            </p>
          )}
          {shared.areas.map((a, i) => (
            <div
              key={i}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-neutral-900">
                  {a.sigungu} {a.name}
                </span>
                {a.avg_price_krw != null && (
                  <span className="text-sm font-medium text-neutral-700">
                    {formatEok(a.avg_price_krw)}
                  </span>
                )}
              </div>
              {a.built_year_avg != null && (
                <p className="mt-1 text-xs text-neutral-500">
                  준공 {a.built_year_avg}년 평균
                </p>
              )}
            </div>
          ))}
        </div>

        <Card className="border-primary-200 bg-primary-50">
          <CardHeader>
            <CardTitle className="text-primary-700">우리집</CardTitle>
            <CardDescription>
              두 사람이 주거 조건을 조율해 함께 살 동네를 찾아요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/?source=share_link"
              className="text-sm font-medium text-primary-700 underline"
            >
              나도 시작하기 →
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
