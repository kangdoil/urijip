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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const shared = await getSharedResult(slug)
  const title = shared
    ? `함께 살 수 있는 구역 ${shared.areas.length}곳`
    : '우리집 — 결과 공유'

  return {
    title,
    description: '신혼부부 2인이 함께 조율한 주거 구역 결과예요',
    openGraph: {
      title,
      description: '우리집에서 조건을 맞춰보고 함께 살 구역을 찾아보세요',
    },
  }
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params
  const shared = await getSharedResult(slug)

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
          {shared.areas.length > 0
            ? `함께 살 수 있는 구역 ${shared.areas.length}곳`
            : '아직 함께 갈 구역을 찾는 중이에요'}
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
              신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾아요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className="text-sm font-medium text-primary-700 underline">
              나도 시작하기 →
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
