# DESIGN-clay 토큰 갱신 설계

## 목표

`DESIGN-clay.md`의 타이포그래피를 Pretendard Variable로 통일하고, 기존 Clay 전용 색상 체계를 사용자가 제공한 pink, accent, neutral 팔레트로 재구성한다.

## 타이포그래피

- 모든 display, title, body, caption, button, nav-link 토큰의 `fontFamily`를 `Pretendard Variable, sans-serif`로 설정한다.
- 기존 Plain Black 및 Inter 언급은 Pretendard Variable의 가변 굵기 사용으로 갱신한다.

## 컬러 토큰

- Pink scale: `#FFF0F5`(50), `#FFE1E9`(100), `#FFC2D3`(200), `#FF99B3`(300), `#FF7096`(400), `#FF4D8B`(500), `#E63973`(600), `#C21A56`(700), `#8F0D3C`(800), `#400418`(900)
- Accent: teal `#3EDAD8`, coral `#FF8A71`, lavender `#D0C3FF`
- Neutral: `#F8FAFC`(50), `#F1F5F9`(100), `#CBD5E1`(300), `#64748B`(500), `#0F172A`(900)
- 의미 토큰은 neutral을 바탕·텍스트·경계선에, pink 500을 기본 강조색에, 세 accent를 기능 카드에 사용한다.
- 기존 `brand-peach`, `brand-ochre`, `brand-mint`은 제거한다. coral을 새 기능 카드 색상으로 추가한다.

## 컴포넌트와 문서 서술

- `feature-card-peach`, `feature-card-ochre`는 `feature-card-coral` 하나로 통합한다.
- cream 계열 카드 및 배경은 neutral 50/100을 사용한다.
- 색상, 타이포그래피, 핵심 특성 설명에서 기존 Hex 값과 Clay 고유 색상명(cream, ochre, peach, mint)을 새 토큰 기준으로 바꾼다.

## 범위

- 대상은 `/Users/dowon/Downloads/DESIGN-clay.md` 한 파일이다.
- 레이아웃, spacing, radius, 컴포넌트 구조는 변경하지 않는다.
