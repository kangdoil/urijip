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

### 역할(A/B) 컬러 규칙
- **A(초대자)**: `pink-500`
- **B(피초대자)**: `accent-teal`
- 통근시간, 지도 핀, 조건 비교 등 두 사람을 색으로 구분해야 하는 모든 곳에 이 규칙을 쓴다. `blue-*` 스케일을 B에 쓰지 않는다 — 위 "Blue" 항목은 A/B 구분과 무관한 별도 용도로 예약된 스케일이다.
- 새로 만드는 화면에서 A/B를 구분해야 하면 이 규칙을 그대로 따르고, 이미 있는 화면에서 다른 색(예전 `blue-600`, `violet`/`teal` 조합 등)을 발견하면 이 규칙으로 맞춰나간다.

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

### Chip (`ui/chip.tsx`)
- 단일 선택 카테고리 pill(예: anchor 페이지의 직장/학교/부모님 집/직접 입력). `selected` prop으로 상태 제어
- **스트로크 없이 면으로만 구분**: 선택 `bg-neutral-900 text-neutral-0`, 미선택 `bg-neutral-50 text-neutral-600` — Badge/Tier 선택 버튼과 달리 primary(pink)가 아니라 neutral 대비로 선택 상태를 표현한다

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

### ResultHeaderPill (`components/result-header-pill.tsx`)
- 지도 위에 떠 있는 글래스 헤더. `border border-white bg-neutral-50/50 backdrop-blur-[10px] shadow-[0_10px_40px_rgba(0,0,0,0.04)] rounded-xl`
- 제목 + 카운트 칩(`bg-neutral-900 text-pink-500`, 다크 배경 위 핑크 텍스트가 포인트) — 폴백(매칭 0건) 상태는 `count`를 생략해서 칩을 숨긴다

### ResultAreaCard (`components/result-area-card.tsx`)
- 결과 화면 가로 스크롤 캐러셀 전용 동네 카드. `w-[304px] h-[150px] rounded-2xl border-[0.6px] border-neutral-300`(이 카드만 예외적으로 얇은 스트로크 사용 — Figma 원본 그대로)
- 동네명(`text-title-sb`) + 가격(`text-body-m` neutral-500) → 통근시간 A/B(역할 컬러 규칙에 따라 pink-500/accent-teal, 앞에 lucide `Car` 아이콘) → 충족 조건 배지(`bg-neutral-500 text-neutral-0`)
- 통근시간은 Figma엔 없었지만 두 사람이 실제로 비교하는 핵심 정보라 UX 판단으로 추가했다(그룹 결과 목업에서도 같은 이유로 넣었던 정보)

### SigunguFilterSheet / MustConditionSheet (`components/sigungu-filter-sheet.tsx`, `components/must-condition-sheet.tsx`)
- 공용 `ui/drawer.tsx`(그동안 안 쓰이던 컴포넌트)를 재사용한 두 개의 보조 바텀시트
- SigunguFilterSheet: "N개 시군구" 트리거를 누르면 전체 시군구를 `Chip`으로 나열, 하나 고르면 자동으로 닫힘
- MustConditionSheet: "필수 조건 : ..." 줄을 누르면 거의 풀페이지(`h-[92vh]`)로 열려서 위에는 A/B 조건 비교, 아래는 추천 이유 설명을 보여준다

### 시군구 필터 칩 줄 (ResultMapSheet 내부)
"N개 시군구" 트리거는 `shrink-0`로 고정하고, 개별 시군구 `Chip` 목록만 별도의 `overflow-x-auto` 컨테이너로 감싸 가로 스크롤한다 — 트리거를 스크롤 밖에 항상 붙잡아두기 위한 구조. 인라인엔 전체 시군구를 다 보여주고(예전엔 상위 2개만 잘랐었음), 그중 아무거나 눌러도 되고 트리거로 전체 목록 시트를 열어도 된다.

### 결과 화면 바텀시트 collapse 규칙
`ResultMapSheet`는 vaul snapPoints를 `[0.3, 0.6]` 두 단계만 쓴다. 가장 낮은 스냅(0.3)일 때는 핸들+시군구 칩 줄(+액션 바)만 남기고 나머지(필수조건 트리거, 동네 카드)는 렌더링하지 않는다 — 시트를 끝까지 내리면 지도가 최대한 보이면서도 필터는 계속 손닿는 곳에 있게 하려는 의도.
- **Retry/Share 액션 바는 반드시 Drawer.Content 밖에 별도 `fixed` 오버레이로 둔다.** vaul의 Drawer.Content는 snap 값과 무관하게 항상 `h-full`(고정 높이) 박스이고 snap은 그 박스를 translate로 가리는 방식이라, 액션 바를 시트 레이아웃 안(예: flex 마지막 자식)에 두면 완전히 펼친 상태(snap 1) 말고는 시트 박스 하단이 뷰포트 아래로 밀려나면서 액션 바가 화면 밖으로 사라진다. 대신 액션 바를 뷰포트 기준 `fixed bottom-0`으로 띄우고, collapsed snap 값을 "핸들+칩 줄 높이"가 액션 바 높이보다 커지도록 넉넉히 잡아서 겹치지 않게 한다.
- 바텀시트 상단 라운드는 `rounded-t-3xl`(40px, radius 토큰) — 48px이었다가 이 값으로 조정됨.

### 세션 대기실(`/s/[id]`) — 딤드 바텀시트 패턴
결과 화면과 달리 이 페이지는 지도가 없다. 대신 제목/설명을 배경(딤드) 레이어에 띄우고, 그 위에 `Drawer.Overlay`(딤 있음, `modal` 기본값)로 감싼 바텀시트를 얹는다. snapPoints는 `[0.68, 0.92]` — 콘텐츠를 숨기는 용도가 아니라 드래그 여지를 주기 위한 2단계라, 두 지점 모두 같은 카드 내용을 보여준다. `dismissible={false}`라 완전히 닫히지 않는다.
- **A/B 아바타**: `public/asset/urijip_A.png`/`urijip_B.png`(70×70), 원형 배경(A: `bg-pink-100 border-pink-500`, B: `bg-accent-teal/10 border-accent-teal`) 안에 넣는다. 완료(`completed_at`) 여부에 따라 우측 상단에 체크 배지(lucide `Check`, 본인 역할 컬러)를 얹는다. 상대가 아직 참여 전이면 `opacity-20`으로 흐리게.
- **이름 필(pill)**: `h-10 w-[88px] rounded-full`, 배경은 역할 컬러(A=pink-500, B=accent-teal), 참여 전이면 역시 `opacity-20`.
- **상대 이름 노출**: `participants` 테이블 RLS는 상대 행 전체를 세션 ready 이후로 막는다(조건·예산 보호). 그래서 이름·완료여부만 `get_session_presence` RPC(SECURITY DEFINER, `supabase/migrations/20260715000000_presence_names.sql`)로 미리 공개한다 — 조건/예산 컬럼은 여전히 노출하지 않는다.
- **상태별 하단 고정 액션**(Drawer 밖 `fixed bottom-0`, 위 collapse 규칙과 동일한 이유로 시트 안에 두지 않음): 초대 전=아웃라인 "초대 링크 복사" 버튼, 상대 참여 후=원형 새로고침 버튼(`RefreshCw`, `bg-neutral-900`), 둘 다 완료=풀와이드 "View results"(Montserrat).

### 초대장(`/j/[code]`) — JoinForm
홈 화면과 같은 톤(면 채움 카드, `urijip_logo.png` 184px)이되 카드 배경만 `bg-pink-100`(초대받은 느낌을 위한 유일한 컬러 카드). 입력창 placeholder는 홈 화면과 동일하게 "예: 도일" — 로그인 화면과 문구를 통일해서 어느 쪽에서 와도 같은 안내를 받는다. CTA는 `Start! (with B)`(Montserrat), 홈 화면의 `Start! (with A)`와 짝을 이룬다.

## 6. 주의사항 / Known Gaps

- `public/icons/budget.svg`, `public/icons/infra.svg`는 Figma에서 내려받은 정적 SVG로 `fill="#FF4D8B"`가 하드코딩돼 있다. pink-500 토큰 값이 바뀌면 이 두 파일도 수동으로 맞춰야 한다.
- Feature Card, Tier 선택 버튼 모두 아직 공용 컴포넌트로 추출되지 않았다.
- 공용 `<Card>`의 스트로크(ring) 방식은 4장의 면 채움 규칙과 다르다(위 각주 참고).
