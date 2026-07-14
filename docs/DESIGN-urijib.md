# 우리집 — 디자인 토큰 & 컴포넌트 가이드

이 문서는 실제 코드에 반영된 색상·타이포·radius 토큰과, 그 토큰으로 만들어진 컴포넌트 패턴을 정리한다.
Source of truth는 이 문서가 아니라 아래 파일들이다 — 값이 바뀌면 이 문서도 같이 갱신할 것.

- 색상·타이포·radius 토큰: `src/app/globals.css`
- 폰트 로딩: `src/app/layout.tsx`
- 공용 컴포넌트: `src/components/ui/*`
- 온보딩 전용 컴포넌트: `src/components/onboard-*.tsx`
- 기준 화면: `src/app/s/[id]/onboard/budget/page.tsx`, `src/app/s/[id]/onboard/conditions/page.tsx` (Figma 그대로 구현된 현재 기준 디자인)

## 1. Colors

### Pink (primary)
| 토큰 | 값 |
|---|---|
| pink-50 | #fff0f5 |
| pink-100 | #ffe1e9 |
| pink-200 | #ffc2d3 |
| pink-300 | #ff99b3 |
| pink-400 | #ff7096 |
| pink-500 (primary) | #ff4d8b |
| pink-600 | #e63973 |
| pink-700 | #c21a56 |
| pink-800 | #8f0d3c |
| pink-900 | #400418 |

### Neutral (cool-blue tinted)
| 토큰 | 값 |
|---|---|
| neutral-0 | #ffffff |
| neutral-50 | #f6f7f9 |
| neutral-100 | #eceef3 |
| neutral-200 | #dfe3ec |
| neutral-300 | #ccd2e0 |
| neutral-400 | #a8b0c4 |
| neutral-500 | #8e98b4 |
| neutral-600 | #6b7694 |
| neutral-700 | #4d5570 |
| neutral-800 | #33384a |
| neutral-900 | #1f2024 |

### Accent
- teal `#3edad8`, coral `#ff8a71`, lavender `#d0c3ff` — 포인트로만 쓰고 아직 넓은 면적 사용처는 없음

### Blue (secondary/info)
50~900 스케일 존재 (`#eef2ff` ~ `#0d1a47`), 현재 UI에서 실사용처는 없음 — 정보성 배지/알림용으로 예약

### 시맨틱 매핑
- `--background`: #ffffff, `--foreground`: neutral-900
- `--primary`: pink-500, `--primary-foreground`: #ffffff
- `--secondary` / `--muted`: neutral-50, `--accent`: neutral-100
- `--border` / `--input`: neutral-200, `--ring`: primary-300

### 기본 배경 규칙
- **페이지 배경**: `bg-neutral-50`
- **카드·컨트롤 면**: `bg-white` (= neutral-0)
- **아이콘 배지 면**: `bg-pink-100`

## 2. Typography

### 폰트 패밀리
| 용도 | 패밀리 | CSS 변수 | 비고 |
|---|---|---|---|
| 본문·제목 기본 | Pretendard Variable | `--font-sans` | 로컬 가변 폰트(`public/fonts/PretendardVariable.woff2`) |
| 영문 CTA·숫자 강조 | Montserrat | `--font-montserrat` | weight 700/800만 로드 |
| 예비 | Geist Mono | `--font-mono` | 현재 UI 실사용처 없음 |

### Pretendard 스케일
line-height 1.4, **자간 = 폰트 크기의 -3%** 고정.

| 토큰 | 크기 | 자간 |
|---|---|---|
| headline-l | 42px | -1.26px |
| headline-m | 32px | -0.96px |
| title-l | 28px | -0.84px |
| title-m | 22px | -0.66px |
| title-sb | 20px | -0.6px |
| body-l | 18px | -0.54px |
| body-m | 16px | -0.48px |
| body-sb | 14px | -0.42px |
| body-s | 14px | -0.42px |
| caption-l | 12px | -0.36px |
| caption-m | 10px | -0.3px |

### Montserrat 스케일
line-height 1, **자간 = 0%(트래킹 없음)**.

| 토큰 | 크기 |
|---|---|
| mont-headline-l | 56px |
| mont-headline-m | 48px |
| mont-title-l | 24px |
| mont-title-m | 20px |

두 스케일의 자간 기준이 다른 이유: Pretendard는 압축된 -3% 트래킹이 브랜드 톤이지만, Montserrat은 영문 대문자·숫자 위주라 기본 트래킹을 그대로 쓴다. 새 사이즈를 추가할 때도 이 규칙을 따른다.

## 3. Radius

| 토큰 | 값 |
|---|---|
| radius-xs | 6px |
| radius-sm | 8px |
| radius-md | 12px |
| radius-lg | 16px |
| radius-xl | 24px |
| radius-2xl | 32px |
| radius-3xl | 40px |
| radius-4xl | 48px |
| radius-5xl | 60px |

- pill류(버튼, input, tier 선택 버튼, 스텝 도트, 배지)는 스케일과 무관하게 전부 `rounded-full`
- 실사용 매핑: 공용 `<Card>` = `rounded-2xl`(32px), 온보딩 Feature Card = `rounded-3xl`(40px)

## 4. Surface & Fill 규칙

**카드는 스트로크가 아니라 면으로 구분한다.** 온보딩 Feature Card(budget/conditions)는 테두리·ring 없이 `bg-white` + `shadow-[0_10px_20px_rgba(0,0,0,0.04)]`만으로 배경과 분리된다.

> 참고: 기존 공용 `<Card>`(`ui/card.tsx`)는 아직 `ring-1 ring-pink-100`을 쓰고 있어 이 규칙과 어긋난다. 지금 당장 고치는 범위는 아니지만, 다음에 Card를 만질 일이 있으면 면 채움 방식으로 맞추는 걸 고려할 것.

아이콘 배지는 `size-20 rounded-full bg-pink-100` 원형 안에 아이콘을 얹는 패턴을 쓴다(`budget.svg`, `infra.svg` 참고).

## 5. Components

### Button (`ui/button.tsx`)
- variant: `default`(primary) / `outline` / `secondary` / `ghost` / `destructive` / `link`
- size: `default` / `sm` / `lg` / `icon` / `icon-sm`
- 모양: `rounded-full`, `font-bold`
- **primary 규칙**: 배경 `bg-primary`(pink-500), 텍스트는 항상 `text-neutral-0`(흰색) — `text-primary-foreground`가 아니라 `text-neutral-0`을 직접 쓴다(이유: 커스텀 텍스트 크기 토큰과 twMerge가 충돌하는 문제가 있어 `lib/utils.ts`의 `cn()`을 `extendTailwindMerge`로 확장해 해결함)
- 기본 폰트는 Pretendard bold. 영문 CTA(Next/Done처럼 라벨이 영문일 때)는 `font-montserrat text-mont-title-m`로 오버라이드

### Slider (`ui/slider.tsx`)
- track 배경 `bg-neutral-100`, 채워진 range `bg-primary`
- thumb: `border-4 border-white bg-primary shadow-md`

### Input (`ui/input.tsx`)
- `rounded-full border border-neutral-300 bg-white`, 포커스 시 `border-2 border-primary`

### Badge (`ui/badge.tsx`)
- variant: `default`(pink) / `secondary`(pink-100 면) / `accent`(teal) / `destructive` / `outline` / `ghost` / `link`
- `rounded-full`, `text-body-sb`

### OnboardBackBar (`components/onboard-back-bar.tsx`)
- 온보딩 화면 상단 뒤로가기 바. lucide-react `ChevronLeft` 아이콘, `disabled`일 때 `opacity-0`으로 자리만 차지
- 사용처: anchor/budget/conditions 온보딩 3단계 전부

### OnboardStepDots (`components/onboard-step-dots.tsx`)
- 3세그먼트 pill 스텝 인디케이터. 활성 `bg-pink-500`(그림자 포함), 비활성 `bg-pink-200`
- 사용처: anchor(0) → budget(1) → conditions(2), `activeIndex`로 현재 단계 표시. 이름 입력 페이지(`app/page.tsx`)는 온보딩 3단계 이전 진입 화면이라 이 인디케이터를 넣지 않는다.

### Feature Card 패턴 (인라인, 공용 컴포넌트 아님)
`bg-white rounded-3xl p-8 shadow-[0_10px_20px_rgba(0,0,0,0.04)]` 카드 안에:
1. 아이콘 배지(`size-20 rounded-full bg-pink-100`, 선택)
2. 콘텐츠(값 표시, 조건 이름·설명, 또는 이름 입력/거점 검색 같은 폼)
3. 필요 시 구분선(`h-px bg-neutral-100`) + 하단 안내 문구

사용처: 이름 입력(`app/page.tsx`), anchor/budget/conditions 온보딩 페이지 전부. 아직 공용 컴포넌트로 추출되지 않아, 다른 화면에서 재사용하려면 클래스를 그대로 옮겨야 한다.

### Tier 선택 버튼 패턴 (conditions 페이지)
세로로 쌓은 전체 너비 pill 버튼 3개(`필수`/`선호`/`무관`):
- 미선택: `bg-neutral-100 text-neutral-900`
- 선택: `border-2 border-pink-500 bg-white text-pink-500` — tier 종류(필수/선호/무관)와 무관하게 동일한 스타일

## 6. 주의사항 / Known Gaps

- `public/icons/budget.svg`, `public/icons/infra.svg`는 Figma에서 내려받은 정적 SVG로 `fill="#FF4D8B"`가 하드코딩돼 있다. pink-500 토큰 값이 바뀌면 이 두 파일도 수동으로 맞춰야 한다.
- Feature Card, Tier 선택 버튼 모두 아직 공용 컴포넌트로 추출되지 않았다.
- 공용 `<Card>`의 스트로크(ring) 방식은 4장의 면 채움 규칙과 다르다(위 각주 참고).
