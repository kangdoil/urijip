# 신축(build_year) 조건 판정 방식 개선 — 평균 → 비율 설계

## 배경

"추천 동네가 확 줄었다" 신고를 조사하는 과정(우선순위 하드필터 버그, `20260725030000`/`20260725040000`)에서 실측 데이터를 뽑아보니, 신축(`build_year`) 조건이 다른 두 분류형 조건(평형·인프라)보다 유난히 희소했다 — 실제 area_stats 155건 기준 평형 89.7%, 인프라 96.8%인데 신축만 7.7%.

원인은 판정 방식 자체에 있다. `area_stats.built_year_avg`는 `scripts/refresh-trade-stats.ts`가 최근 6개월 실거래의 건축년도를 **평균**해서 채우고, SQL은 `built_year_avg >= 올해-10`이면 충족으로 본다. 반면 평형 조건(`size_59_ok`)은 같은 스크립트가 "전용면적 59㎡ 이상 거래 비중이 50% 이상"이라는 **비율** 기준으로 계산한다(`summarize()`, `scripts/refresh-trade-stats.ts:120-126`).

평균 방식은 이상치에 취약하다. 예: 한 동네에 신축 대단지 거래 3건(2024년 준공)과 구축 대단지 거래 7건(1995년 준공)이 섞이면 평균 건축년도는 2004년 — "올해-10=2016년 이상" 기준에 못 미쳐 탈락한다. 실제로는 신축 매물이 버젓이 거래되고 있는데도 평균이 구축 쪽으로 끌려가 통째로 탈락하는 구조다.

## 데이터 검증 (실측, area_stats에는 미반영)

`refresh-trade-stats.ts`와 동일한 조회 로직으로 드라이런 스크립트를 작성해 실제 국토부 실거래 데이터(152개 동네, 최근 6개월)를 분석했다.

- **기존 평균 방식 통과**: 12/152 (7.9%)
- **신규 비율 방식(신축=10년 이내) 임계값별 통과**:

  | 임계값 | 통과 수 | 비율 |
  |---|---|---|
  | 10% | 91/152 | 59.9% |
  | 20% | 76/152 | 50.0% |
  | **30%** | **57/152** | **37.5%** |
  | 40% | 56/152 | 36.8% |
  | 50%(size_59_ok와 동일 기준) | 50/152 | 32.9% |

- **결정: 임계값 30%.** 50%(평형과 동일 기준)와 큰 차이는 없지만(37.5% vs 32.9%), 신축이 다른 두 조건보다 원래 희소한 속성이라는 점을 고려해 소폭 더 관대한 값을 쓰기로 함(사용자 확인).
- 평균 방식으로는 탈락했지만 비율 30% 기준으로는 통과하는 동네가 45곳 확인됨(예: 복정동 63%/평균 2014, 금광1동 65%/평균 2014 — 평균만 보면 탈락 대상이었지만 실제 신축 거래가 다수인 동네).

## 변경 사항

### 1. `area_stats` 스키마

신규 컬럼 `build_year_ok boolean` 추가(`size_59_ok`와 동일한 성격 — 매칭 판정 전용).

`built_year_avg`는 그대로 둔다 — 공유 결과 페이지의 "준공 XXXX년 평균" 표시(`src/app/share/[slug]/page.tsx:82-84`, `src/lib/shared-result.ts:8`)가 이 컬럼을 직접 쓰고 있어 매칭 로직과 분리해서 유지해야 한다.

### 2. `scripts/refresh-trade-stats.ts`

- 상수 추가: `RECENT_YEARS = 10`(기존 인라인 `10`을 명명), `BUILD_YEAR_RECENT_RATIO_THRESHOLD = 0.3`(기존 `SIZE_THRESHOLD_M2` 패턴과 동일한 레벨).
- `summarize()`에 계산 추가:
  ```ts
  const recentCount = trades.filter((t) => t.buildYear >= new Date().getFullYear() - RECENT_YEARS).length
  build_year_ok: recentCount / trades.length >= BUILD_YEAR_RECENT_RATIO_THRESHOLD
  ```
- upsert하는 `rows`에 `build_year_ok` 포함. `built_year_avg` 계산은 손대지 않음(그대로 평균 유지 — 표시용이므로).

### 3. SQL — 인라인 계산 5곳을 `st.build_year_ok`로 교체

현재 살아있는(최신 버전) 함수 중 `'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10)` 패턴을 직접 계산하는 곳은 다음 5곳뿐이다(전부 grep + 최신 정의 확인 완료):

| 함수 | 정의 위치(최신) |
|---|---|
| `_session_candidates` | `20260714000000_area_coords_in_matches.sql:43` |
| `get_solo_preview` | `20260725030000_priority_hard_filter_fix.sql:120` |
| `_concession_ladder_step` | `20260725000000_concession_priority_safety_net.sql:69` |
| `_concession_condition_stats` (2곳) | `20260725010000_concession_condition_impact.sql:80, 131` |
| `_adjust_candidates` | `20260725020000_adjust_commute_slider.sql:41` |

전부 `'build_year', coalesce(st.build_year_ok, false)`로 교체한다. `get_matches`/`get_concession_matches`/`get_adjust_data`는 위 함수들을 호출만 할 뿐 satisfied를 직접 만들지 않으므로 자동으로 반영된다 — 별도 수정 불필요.

`_priority_hard_ok_except`(조건별 완화 임팩트 계산용)는 satisfied jsonb를 받아서만 쓰므로 무관.

### 4. 배포 순서 (3단계 — 순서를 지켜야 함)

1. **컬럼 추가 마이그레이션**만 배포(`build_year_ok` 추가, 기본값 없음/null). 이 시점엔 SQL 로직이 여전히 `built_year_avg` 기준이라 기존 동작에 영향 없음.
2. **백필**: 수정된 `refresh-trade-stats.ts` 실행 → 155개 지역에 `build_year_ok` 채움.
3. 백필 결과(통과 수) 확인 후, **로직 전환 마이그레이션** 배포(5곳 교체).

순서를 반대로 하면(로직 전환을 먼저 배포) `build_year_ok`가 전부 null/false인 상태에서 신축 조건이 전원 탈락하는 일시적 악화가 생긴다.

## 검증 계획

- 백필 직후 실제 `build_year_ok` 통과 수를 다시 세어 드라이런 수치(37.5%)와 일치하는지 확인.
- 로직 전환 마이그레이션 배포 후, 이번 세션에서 썼던 두 가지 방법으로 재검증:
  - 로컬 Postgres 시뮬레이션(합성 데이터 대신 실제 area_stats 스냅샷 재사용) — priority 하드필터 조합별 match_count 비교
  - 실제 프로덕션에 테스트 세션을 만들어 배포된 RPC를 직접 호출하는 스모크테스트(신축을 1순위로 고른 케이스가 이전보다 늘었는지)
- 공유 결과 페이지의 "준공 XXXX년 평균" 문구/값이 변경 전후 동일한지 확인(표시 필드 안 건드렸음을 재확인).

## 영향 범위

- 신규 마이그레이션 2개(컬럼 추가 / 로직 전환) — 실제 배포 시점의 다음 타임스탬프 사용(현재 최신 `20260725040000` 기준, 잠정 `20260725050000`/`20260725060000`)
- `scripts/refresh-trade-stats.ts`
- 프론트 변경 없음 — `satisfied.build_year`는 서버가 계산해 그대로 내려주므로 클라이언트 코드는 손댈 필요가 없다.

`built_year_avg` 컬럼 자체, 공유 결과 페이지, 온보딩 조건 설명 문구(`conditions.descr = '지어진 지 10년 이내'`)는 이번 범위에서 변경하지 않는다 — "10년"이라는 사용자 대상 정의는 그대로고, 판정 로직의 집계 방식만 바뀐다.
