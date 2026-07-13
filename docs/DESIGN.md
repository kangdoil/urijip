# 디자인 가이드

출처: [가는집 Figma — Color Palette](https://www.figma.com/design/zfreMt8vFZLzUdnvJBxzLd/%EA%B0%80%EB%8A%94%EC%A7%91?node-id=53-2)
"가는 집"(1인용 비교·제외 서비스)과 조건 프레임워크뿐 아니라 디자인 시스템도 공유한다 (PRD §0 관련 프로젝트 참조).
색상 토큰은 `src/app/globals.css`에 CSS 변수로 등록되어 있다 (`--primary-*`, `--neutral-*`, `--blue-*`, Tailwind 유틸리티로 `bg-primary-500` 등 사용 가능).

## Brand & Style
전체 무드는 거의 무채색에 가까운 화이트 캔버스, 선명한 단일 primary color 강조색으로 요약된다. 중성색(`neutral-900`부터 `neutral-100`까지)이 표면 전체를 차지하고, 채도가 높은 브랜드 컬러(`pink-500`)는 화면당 하나의 가장 중요한 액션에만 예약된다. 모서리는 공격적으로 둥글지만 결코 귀엽지 않다 — 버튼·카드·hero 블록에 16~32px 라운드, chips·primary CTA에 999px full pill을 쓰며, iOS류 squircle/blob 라운드는 `Templates/Squircle` 전용 페이지를 제외하면 명시적으로 회피된다. 배경은 평면이 기본이며, 그라디언트는 (1) bottom CTA 위쪽 `white → transparent` 보호 그라디언트, (2) 로딩 버튼 내부의 미세한 pressed-blue radial glow, (3) yellow→orange 일러스트 그라디언트 — 세 가지 문서화된 예외만 허용된다. 텍스처·노이즈·전면 사진은 chrome에 사용되지 않는다.

Voice는 해요체(대화형 존댓말) + 위임형 + 일상어로 요약된다. 종결어미 `-요`로 통일되며 격식체(~니다/~합니다)도, 방송 헤드라인의 단정형 `-다`도 사용하지 않는다 — 한 문장은 목적을 말하고, 다음 한 문장은 언제 쓰는지를 말하는 패턴이 표준이다.

### primary (pink — illustration warms)

| 단계 | HEX | CSS 변수 | 비고 |
|---|---|---|---|
| 50 | `#FEF0F7` | `--primary-50` | 옅은 배경 tint |
| 100 | `#FCDCEE` | `--primary-100` | |
| 200 | `#F5B9DD` | `--primary-200` | |
| 300 | `#EB73BB` | `--primary-300` | `--ring` (focus) |
| 400 | `#E52696` | `--primary-400` | 다크모드 `--primary` |
| 500 | `#DE0082` | `--primary-500` | 라이트모드 `--primary` — 화면당 핵심 액션 1곳 전용 |
| 600 | `#B2006A` | `--primary-600` | hover/pressed |
| 700 | `#880051` | `--primary-700` | |
| 800 | `#5E0038` | `--primary-800` | |
| 900 | `#3A0023` | `--primary-900` | |

### neutral (cool-blue tinted neutrals)

| 단계 | HEX | CSS 변수 | 비고 |
|---|---|---|---|
| 50 | `#F6F7F9` | `--neutral-50` | 페이지 배경 tint / `--muted` |
| 100 | `#ECEEF3` | `--neutral-100` | `--accent` |
| 200 | `#DFE3EC` | `--neutral-200` | `--border`, `--input` |
| 300 | `#CCD2E0` | `--neutral-300` | |
| 400 | `#A8B0C4` | `--neutral-400` | 다크모드 `--muted-foreground` |
| 500 | `#8E98B4` | `--neutral-500` | |
| 600 | `#6B7694` | `--neutral-600` | `--muted-foreground` |
| 700 | `#4D5570` | `--neutral-700` | 다크모드 `--card`/`--secondary` |
| 800 | `#33384A` | `--neutral-800` | 다크모드 `--background` 근접 |
| 900 | `#1F2024` | `--neutral-900` | `--foreground`, 다크모드 `--background` |

### blue (secondary / info)

| 단계 | HEX | CSS 변수 |
|---|---|---|
| 50 | `#EEF2FF` | `--blue-50` |
| 100 | `#DBE4FF` | `--blue-100` |
| 200 | `#B8C9FF` | `--blue-200` |
| 300 | `#8AABFF` | `--blue-300` |
| 400 | `#5B88FF` | `--blue-400` |
| 500 | `#3B6BF5` | `--blue-500` |
| 600 | `#2C53CC` | `--blue-600` |
| 700 | `#1F3D9E` | `--blue-700` |
| 800 | `#152A70` | `--blue-800` |
| 900 | `#0D1A47` | `--blue-900` |

> **우리집 전용 메모**: CLAUDE.md의 "컬러 시스템: A=보라, B=청록" 규칙은 이 팔레트와 별개로 유지한다 — 참여자 역할(A/B) 식별용 배지·아바타 색이지, 화면의 핵심 액션 색은 아니다. "primary는 화면당 하나"라는 브랜드 규칙에 따라 CTA 버튼은 앞으로 `primary`(pink) 토큰으로 통일하고, violet/teal은 역할 식별 배지·보더 등 보조 용도로만 좁혀 쓸 예정이다 (Phase 1 화면 작업 시 반영).

### Type ramp (모든 값 `colors_and_type.css`에서 직접 추출)

font에서 정보성 텍스트는 Pretendard Variable만을 사용한다. 꾸밈용 텍스트에만 Montserrat를 사용한다.

```yaml
display-1:  { size: 56, line-height: 1.30, tracking: -0.005em, weight: 700 }
display-2:  { size: 40, line-height: 1.20, tracking: -0.020em, weight: 700 }
h1:         { size: 28, line-height: 1.30, tracking: -0.020em, weight: 700 }
h2:         { size: 24, line-height: 1.30, tracking: -0.020em, weight: 700 }
h3:         { size: 22, line-height: 1.30, tracking: -0.015em, weight: 700 }
h4:         { size: 20, line-height: 1.35, tracking: -0.015em, weight: 700 }
title-1:    { size: 18, line-height: 1.45, tracking: -0.010em, weight: 600 }
title-2:    { size: 17, line-height: 1.45, tracking: -0.010em, weight: 600 }
body-1:     { size: 17, line-height: 1.50, tracking: -0.005em, weight: 400 }
body-2:     { size: 15, line-height: 1.50, tracking: -0.005em, weight: 400 }
body-3:     { size: 13, line-height: 1.50, tracking: 0,         weight: 400 }
label-l:    { size: 17, line-height: 1.25, tracking: -0.005em, weight: 700 }
label-m:    { size: 15, line-height: 1.25, tracking: -0.005em, weight: 600 }
label-s:    { size: 13, line-height: 1.25, tracking: 0,         weight: 600 }
caption:    { size: 12, line-height: 1.40, tracking: 0,         weight: 500 }
caption-s:  { size: 11, line-height: 1.40, tracking: 0,         weight: 500 }
```

display 웨이트는 Bold 700에 tight -1.5%~-2% 트래킹으로 무게감을 잡고, 본문은 15px Regular + 1.5 line-height — 한글 가독성을 위해 1.5가 표준이다. 버튼은 XL/L에서 Bold 700 17px, M/S에서 Semibold 15~13px을 쓴다 — "버튼은 장식이 아니라 문장처럼 읽힌다". 카드 타이틀은 `title-1`(18/600), 카드 본문은 `body-2`(15/400)다.

## Spacing

베이스 단위는 4px이며, 토큰 사다리는 4~80px 12단계로 정의된다:

```yaml
space-1:   4
space-2:   8
space-3:  12
space-4:  16
space-5:  20
space-6:  24
space-7:  28
space-8:  32
space-10: 40
space-12: 48
space-16: 64
space-20: 80
```

작은 영역(4~32)에서는 모든 4의 배수 단계를 갖고 있으며, 큰 영역(40 이상)은 섹션 구분을 위한 generous한 간격으로 운영된다. 시스템 룰 오브 섬: 24px 화면 outer padding, 16px list-row 간 간격, 8px 밀접 결합 요소(label + input) 사이.

## Rounded

라운드 토큰은 4~32px 8단계 + `full`(999px) 한 단계로 정의되며 "프로덕션에서 가장 둥근 모바일 시스템 중 하나"로 분류된다:

```yaml
radius-xs:    4     # small badges
radius-s:     8     # inline tags
radius-m:    12     # text inputs
radius-l:    14     # L button (48px)
radius-xl:   16     # XL button (56px), cards
radius-2xl:  20     # sheets, dialogs
radius-3xl:  24     # big cards / sections
radius-4xl:  32     # hero blocks
radius-full: 999    # chips, pills, capsules
```

## Elevation & Depth

평면이 기본이며 그림자는 floating/modal 표면에서만 등장한다. shadow offset과 blur 값은 `colors_and_type.css`에서 직접 인용되며, 색은 모두 navy-900 베이스의 낮은 알파(0.04~0.16)로 통일된다.

```yaml
shadow-1:     >
  0 1px 2px oklch(0.155 0.060 261 / 0.04),
  0 1px 1px oklch(0.155 0.060 261 / 0.04)   # menu
shadow-2:     >
  0 4px 12px oklch(0.155 0.060 261 / 0.06),
  0 1px  2px oklch(0.155 0.060 261 / 0.04)   # tooltip
shadow-3:     >
  0 12px 32px oklch(0.155 0.060 261 / 0.10),
  0 2px  6px oklch(0.155 0.060 261 / 0.06)   # dialog
shadow-toast: >
  0 8px 24px oklch(0.155 0.060 261 / 0.16)   # toast
```

## 적용 상태

- [x] `primary` / `neutral` / `blue` 색상 스케일을 `src/app/globals.css`에 CSS 변수 + Tailwind 유틸리티로 등록
- [x] shadcn 시맨틱 토큰(`--primary`, `--background`, `--border` 등)을 새 팔레트로 재배선
- [ ] spacing / radius 사다리를 Tailwind 테마에 반영 (Phase 1 화면 작업 시 함께 적용)
- [ ] type ramp를 Tailwind 텍스트 유틸리티 또는 컴포넌트로 반영
- [ ] Pretendard Variable / Montserrat 폰트 로드
- [ ] shadow-1~3, shadow-toast 토큰 반영
