# 서로 양보(AB) 패널 — "얻는 것" 혜택 카드 설계

## 배경

결과 화면에서 두 사람의 필수 조건 교집합이 0곳일 때 `ResultConcessionPanel`이 "서로 양보(AB)" 단일 추천안을 보여준다. 헤드라인·서브텍스트·진단 메시지·"서로 양보" 요약 줄(폭 넓힘 배지, AB 아바타, `B +15분 · A +0.8억`, `N곳`)·하단 CTA는 이미 참고 스크린샷과 구조가 일치한다.

차이는 후보 동네 리스트 카드뿐이다. 현재는 결과 화면 캐러셀 전용으로 만들어진 `ResultAreaCard`(가격 + A/B 통근시간 + "OO 충족" 배지)를 그대로 재사용하고 있는데, 참고 스크린샷은 훨씬 단순한 "동네명 + 얻는 것: 태그" 구조를 쓴다. 이 설계는 그 카드 부분만 교체하는 범위를 다룬다.

## 범위

- **포함**: `ResultConcessionPanel`의 후보 리스트(`isZero === false` 분기)에 쓰이는 카드를 새 컴포넌트로 교체. 이 카드가 보여줄 "얻는 것" 태그를 계산하는 로직 추가.
- **제외**: 헤더/메시지/서로 양보 요약 줄/CTA 버튼(이미 스크린샷과 일치, 변경 없음). `get_concession_matches` RPC·DB 마이그레이션(프론트 계산만으로 처리). 매칭 성공(0곳이 아닌) 메인 결과 캐러셀의 `ResultAreaCard`(그대로 유지, 이번 변경과 무관).

## 컴포넌트 설계

새 프레젠테이션 컴포넌트 `ConcessionAreaCard`(`src/components/concession-area-card.tsx`)를 추가한다. `ResultAreaCard`를 확장하지 않고 별도로 만드는 이유: `ResultAreaCard`는 캐러셀 전용으로 이미 문서화돼 있고 정보 위계(가격/통근시간/충족배지)가 이 패널의 미니멀한 목적과 다르다 — prop 분기로 욱여넣으면 컴포넌트 하나가 두 위계를 떠안게 된다.

```
interface ConcessionAreaData {
  code: string
  name: string
  sigungu: string
  lat: number | null
  lng: number | null
  benefitTags: string[]  // 최대 2개, 빈 배열 가능
}
```

스타일(design.md 토큰):
- 카드: `bg-white rounded-2xl p-4 shadow-[0_10px_20px_rgba(0,0,0,0.04)]` — 같은 패널 안 팁 카드(`result-concession-panel.tsx` 88행)와 동일한 면 채움 규칙 재사용, 스트로크 없음
- 동네명: `text-title-sb font-semibold text-neutral-900`
- "얻는 것" 줄: 라벨 `text-neutral-500`, 태그 값 `text-pink-600 font-bold`, 태그 사이 구분자 `·`
- `benefitTags`가 빈 배열이면 "얻는 것" 줄 자체를 렌더링하지 않고 동네명만 표시

탭하면 지도 핀으로 이동하는 기존 `onSelectHood` 동작은 유지(카드 전체 `onClick`).

## "얻는 것" 태그 계산 로직

`result-map-sheet.tsx`에서 `concessionHoods`를 만드는 지점(343행 부근)에서 계산한다. 이미 이 스코프에 `concession.areas[].satisfied`(area_size/build_year/infra)와 `participants[].budget_max_krw`가 있어 RPC 변경이 필요 없다.

| 태그 | 판정 | 라벨 |
|---|---|---|
| 예산 여유 | `avg_price_krw < min(a.budget_max_krw, b.budget_max_krw) * 0.9`(참여자 중 더 낮은 원래 예산 상한보다 10% 이상 저렴, 둘 중 하나라도 null이면 그 조건은 건너뜀) | "예산 여유" |
| 넓은 평수 | `satisfied.area_size === true` | "넓은 평수" |
| 신축 | `satisfied.build_year === true` | "신축" |
| 인프라 | `satisfied.infra === true` | "인프라 편의" |

표시 순서는 위 표 순서로 고정(예산 여유 → 넓은 평수 → 신축 → 인프라). 최대 2개까지만 `benefitTags`에 담고 나머지는 자른다. 4개 판정이 모두 false인 카드는 `benefitTags = []`(태그 줄 숨김, 동네명만 노출) — 억지로 태그를 만들지 않는다.

## 영향 범위

- `src/components/concession-area-card.tsx` (신규)
- `src/components/result-concession-panel.tsx`: `hoods` prop 타입을 `ResultAreaData[]` → `ConcessionAreaData[]`로, 카드 렌더링을 `ResultAreaCard` → `ConcessionAreaCard`로 교체
- `src/components/result-map-sheet.tsx`: `concessionHoods` 빌드 로직에 태그 계산 추가

기존 `ResultAreaCard`, `get_concession_matches` RPC, 메인 결과 캐러셀은 변경하지 않는다.
