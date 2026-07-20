# 경기 서북부 지역 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고양(일산동구·일산서구)·파주·김포·양주·의정부 50개 행정동을 `areas` 테이블에 추가해, 경기 동남부에 한정돼 있던 지역 추천 범위를 서울도심·여의도·GTX-A 통근권까지 넓힌다.

**Architecture:** `areas` 테이블과 통근시간 계산(`src/lib/commute.ts`)은 이미 지역 무관 범용 구조라 코드 로직 변경이 필요 없다. `data/areas-seed.json`에 신규 행정동을 추가하고 `scripts/seed-areas.ts`로 Supabase에 upsert하는 데이터 작업이 핵심이며, 부수적으로 문서(PRD)와 지도 폴백 좌표를 갱신한다.

**Tech Stack:** Next.js, TypeScript, Supabase(JS client), tsx(스크립트 실행기), Node.js 내장 `JSON.parse`/`assert`로 데이터 검증.

## Global Constraints

- 지역명은 코드에 하드코딩하지 않는다 — `data/areas-seed.json`에만 지역 데이터를 둔다 (`CLAUDE.md` 절대 규칙).
- `sigungu` 컬럼 포맷은 기존 관례를 따른다: `"경기 OO시"` 또는 `"경기 OO시 OO구"` (예: `"경기 고양시 일산동구"`).
- `areas` 테이블은 RLS상 **service role 키로만 쓰기 가능**하다 — `scripts/seed-areas.ts` 실행 시 `SUPABASE_SERVICE_ROLE_KEY` 환경변수가 필요하며, 이 값은 `.env.local`에 이미 존재한다(내용은 확인하지 않는다).
- `npx tsx scripts/seed-areas.ts` 실행은 **실제 Supabase 프로젝트의 `areas` 테이블에 upsert하는 되돌리기 어려운 쓰기 작업**이다 — Task 3 실행 직전 반드시 사용자에게 실행 확인을 받는다.
- 이 저장소엔 자동화 테스트 프레임워크(Jest 등)가 없다 — 각 태스크의 "테스트"는 Node 스크립트로 데이터를 검증하거나, 시드 후 실제 Supabase/API 호출로 동작을 확인하는 방식으로 대체한다.

---

### Task 1: `data/areas-seed.json`에 신규 50개 행정동 추가

**Files:**
- Modify: `data/areas-seed.json` (현재 152개 항목, 파일 끝 `]` 직전에 추가)

**Interfaces:**
- Consumes: 없음 (순수 데이터 파일)
- Produces: `AreaSeed[]` 형식의 JSON 배열, `scripts/seed-areas.ts`가 이 파일을 읽어 Supabase에 upsert (Task 3에서 사용)

- [ ] **Step 1: 파일 끝에 신규 50개 항목 추가**

`data/areas-seed.json`의 마지막 항목(`동탄9동`)이 끝나는 줄:
```json
  {
    "code": "4159759000",
    "name": "동탄9동",
    "sigungu": "경기 화성시 동탄구",
    "lat": 37.18449,
    "lng": 127.12396,
    "source_note": "SBIZ 상가정보 API 반경조회 결과(슈퍼마켓 업종) 좌표 평균 — 행정동 대표 좌표 근사치"
  }
]
```
이 마지막 `}`  다음에 `,`를 추가하고, 파일을 닫는 `]` 직전에 아래 50개 객체를 그대로 삽입한다:

```json
  {
    "code": "4128558000",
    "name": "장항1동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6416703,
    "lng": 126.7705889,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 장항로225번길 72 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 adm_cd2 대조."
  },
  {
    "code": "4128559000",
    "name": "장항2동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6499110,
    "lng": 126.7783522,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 노루목로 114 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128555100",
    "name": "백석1동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6496420,
    "lng": 126.7925318,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 일산로 145 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128555200",
    "name": "백석2동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6438906,
    "lng": 126.7854872,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 장백로 72 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128556000",
    "name": "마두1동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6557990,
    "lng": 126.7897913,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 일산로 218 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128557000",
    "name": "마두2동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6535931,
    "lng": 126.7844982,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 강송로 166 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128553000",
    "name": "정발산동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6724598,
    "lng": 126.7798491,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 일산로 422 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128551000",
    "name": "식사동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6773674,
    "lng": 126.8137929,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 위시티2로11번길 22-21 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128552500",
    "name": "중산1동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6917979,
    "lng": 126.7803874,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 중산로 224 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128552600",
    "name": "중산2동",
    "sigungu": "경기 고양시 일산동구",
    "lat": 37.6745159,
    "lng": 126.7860123,
    "source_note": "주민센터 주소: 경기도 고양시 일산동구 하늘마을1로 2, 풍산프라자 6층 (임시청사로 추정). (좌표 추정치 — 임시청사 이전 가능성으로 재검증 필요)"
  },
  {
    "code": "4128755000",
    "name": "주엽1동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6700875,
    "lng": 126.7632809,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 강성로 109 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128756000",
    "name": "주엽2동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6741106,
    "lng": 126.7604780,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 주엽로 178 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128757000",
    "name": "대화동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6829699,
    "lng": 126.7551351,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 일산로 668 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128754500",
    "name": "탄현1동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6943449,
    "lng": 126.7684143,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 홀트로 36 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128754600",
    "name": "탄현2동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.7022648,
    "lng": 126.7675321,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 탄현로 120, 이원마트 2층 (임시청사, 신청사는 2029년 상반기 예정). (좌표 추정치 — 재검증 필요)"
  },
  {
    "code": "4128751000",
    "name": "일산1동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6872696,
    "lng": 126.7685884,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 원일로 55 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128752000",
    "name": "일산2동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6846362,
    "lng": 126.7772420,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 고봉로 283 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4128753000",
    "name": "일산3동",
    "sigungu": "경기 고양시 일산서구",
    "lat": 37.6769718,
    "lng": 126.7702823,
    "source_note": "주민센터 주소: 경기도 고양시 일산서구 강선로 158 (OSM/Nominatim 지오코딩). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4148055000",
    "name": "운정1동",
    "sigungu": "경기 파주시",
    "lat": 37.7241437,
    "lng": 126.7512047,
    "source_note": "행정복지센터 주소: 경기도 파주시 와석순환로 415(와동동), 운정1·2동 통합청사. dong.paju.go.kr 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148056000",
    "name": "운정2동",
    "sigungu": "경기 파주시",
    "lat": 37.7238463,
    "lng": 126.7515918,
    "source_note": "행정복지센터 주소: 경기도 파주시 와석순환로 415(와동동), 운정1동과 동일 건물. 신청사는 2026~2027년 준공 예정. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148057000",
    "name": "운정3동",
    "sigungu": "경기 파주시",
    "lat": 37.7122203,
    "lng": 126.7610935,
    "source_note": "행정복지센터 주소: 경기도 파주시 미래로 350(야당동). Nominatim 하우스넘버 매치 실패로 야당동 법정동 중심좌표 대체. (좌표 추정치 — 재검증 필요)"
  },
  {
    "code": "4148058000",
    "name": "운정4동",
    "sigungu": "경기 파주시",
    "lat": 37.7189712,
    "lng": 126.7687667,
    "source_note": "행정복지센터 주소: 경기도 파주시 하우3길 77(야당동). dong.paju.go.kr 확인, Nominatim 매치. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148059000",
    "name": "운정5동",
    "sigungu": "경기 파주시",
    "lat": 37.7257448,
    "lng": 126.7371479,
    "source_note": "행정복지센터 주소: 경기도 파주시 책향기로 283(목동동). Nominatim 하우스넘버 매치 실패로 목동동 법정동 중심좌표 대체. (좌표 추정치 — 재검증 필요)"
  },
  {
    "code": "4148060000",
    "name": "운정6동",
    "sigungu": "경기 파주시",
    "lat": 37.7127219,
    "lng": 126.7203816,
    "source_note": "행정복지센터 주소: 경기도 파주시 청석로 115 반석프라자 5층(동패동). dong.paju.go.kr 확인, Nominatim 매치. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148054000",
    "name": "교하동",
    "sigungu": "경기 파주시",
    "lat": 37.7530934,
    "lng": 126.7468992,
    "source_note": "행정복지센터 주소: 경기도 파주시 교하로 1401(교하동). 위키백과 및 dong.paju.go.kr 확인. 코드는 웹 검색으로 별도 교차 확인."
  },
  {
    "code": "4148051000",
    "name": "금촌1동",
    "sigungu": "경기 파주시",
    "lat": 37.7663783,
    "lng": 126.7760459,
    "source_note": "행정복지센터 주소: 경기도 파주시 새꽃로 215(아동동). dong.paju.go.kr 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148052000",
    "name": "금촌2동",
    "sigungu": "경기 파주시",
    "lat": 37.7515744,
    "lng": 126.7772241,
    "source_note": "행정복지센터 주소: 경기도 파주시 쇠재로 115(금릉동). dong.paju.go.kr 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4148053000",
    "name": "금촌3동",
    "sigungu": "경기 파주시",
    "lat": 37.7713925,
    "lng": 126.7784007,
    "source_note": "행정복지센터 주소: 경기도 파주시 시청로 194. dong.paju.go.kr 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157051500",
    "name": "김포본동",
    "sigungu": "경기 김포시",
    "lat": 37.6275594,
    "lng": 126.7056939,
    "source_note": "행정복지센터 주소: 경기도 김포시 북변1로 13(북변동). 위키백과+gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157056000",
    "name": "장기동",
    "sigungu": "경기 김포시",
    "lat": 37.6397396,
    "lng": 126.6713857,
    "source_note": "행정복지센터 주소: 경기도 김포시 김포한강2로 112(장기동). gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157052500",
    "name": "장기본동",
    "sigungu": "경기 김포시",
    "lat": 37.6523062,
    "lng": 126.6717281,
    "source_note": "행정복지센터 주소: 경기도 김포시 김포대로 1433(장기동). gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157054000",
    "name": "사우동",
    "sigungu": "경기 김포시",
    "lat": 37.6192880,
    "lng": 126.7167420,
    "source_note": "행정복지센터 주소: 경기도 김포시 돌문로 51(북변동). gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157055000",
    "name": "풍무동",
    "sigungu": "경기 김포시",
    "lat": 37.6021368,
    "lng": 126.7220346,
    "source_note": "행정복지센터 주소: 경기도 김포시 풍무로 74. gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157057000",
    "name": "구래동",
    "sigungu": "경기 김포시",
    "lat": 37.6464264,
    "lng": 126.6236392,
    "source_note": "행정복지센터 주소: 경기도 김포시 김포한강9로115번길 25. gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4157057500",
    "name": "마산동",
    "sigungu": "경기 김포시",
    "lat": 37.6436770,
    "lng": 126.6413084,
    "source_note": "행정복지센터 주소 상충(김포한강8로 246 vs 김포한강3로 432) — POI 이름 검색으로 위치 확정. (주소 표기 재검증 권장)"
  },
  {
    "code": "4157058000",
    "name": "운양동",
    "sigungu": "경기 김포시",
    "lat": 37.6514229,
    "lng": 126.6832703,
    "source_note": "행정복지센터 주소: 경기도 김포시 모담공원로 32. gimpoch.com 확인. 코드는 KIKcd_H 2023-05-01 스냅샷."
  },
  {
    "code": "4163057000",
    "name": "옥정1동",
    "sigungu": "경기 양주시",
    "lat": 37.8371922,
    "lng": 127.0900767,
    "source_note": "주민센터 주소: 경기도 양주시 옥정로 397-7. 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4163058000",
    "name": "옥정2동",
    "sigungu": "경기 양주시",
    "lat": 37.8198832,
    "lng": 127.0945208,
    "source_note": "주민센터 주소: 경기도 양주시 옥정동로7가길 4, 파스텔시티2 2층 (2023년 분동 후 임시청사로 추정). (좌표 추정치 — 재검증 필요)"
  },
  {
    "code": "4163053000",
    "name": "회천1동",
    "sigungu": "경기 양주시",
    "lat": 37.8470591,
    "lng": 127.0646604,
    "source_note": "주소 상충: 양주시청 공식 페이지는 화합로1327번길 39, 일부 뉴스는 덕정길 67(신청사)를 언급. 공식 페이지 값 채택. (재검증 필요)"
  },
  {
    "code": "4163054000",
    "name": "회천2동",
    "sigungu": "경기 양주시",
    "lat": 37.8216197,
    "lng": 127.0468282,
    "source_note": "주민센터 주소: 경기도 양주시 평화로1475번길 39. 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4163055000",
    "name": "회천3동",
    "sigungu": "경기 양주시",
    "lat": 37.8378353,
    "lng": 127.0689434,
    "source_note": "주민센터 주소: 경기도 양주시 회정로 143. 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4163052000",
    "name": "양주2동",
    "sigungu": "경기 양주시",
    "lat": 37.7969343,
    "lng": 127.0804073,
    "source_note": "주민센터 주소: 경기도 양주시 고읍로 77. 고읍지구 아파트 밀집으로 선정(양주1동은 저밀도 원도심으로 제외). 코드는 admdongkor ver20260701 대조."
  },
  {
    "code": "4115056700",
    "name": "신곡1동",
    "sigungu": "경기 의정부시",
    "lat": 37.7315135,
    "lng": 127.0567830,
    "source_note": "주민센터 주소: 경기도 의정부시 발곡로 17 (2024~2025년경 신청사 이전). Nominatim 라벨이 구청사명으로 표기되어 OSM 갱신 지연 가능성 있음(주소 자체는 뉴스로 확인). (라벨 불일치 — 재검증 권장)"
  },
  {
    "code": "4115056800",
    "name": "신곡2동",
    "sigungu": "경기 의정부시",
    "lat": 37.7436875,
    "lng": 127.0580730,
    "source_note": "주민센터 주소: 경기도 의정부시 추동로23번길 7(신곡동). Nominatim 매치."
  },
  {
    "code": "4115054500",
    "name": "호원1동",
    "sigungu": "경기 의정부시",
    "lat": 37.7120444,
    "lng": 127.0487191,
    "source_note": "주민센터 주소: 경기도 의정부시 평화로230번길 12-9(호원동). Nominatim 매치(호원1동 작은도서관, 부속시설)."
  },
  {
    "code": "4115055500",
    "name": "호원2동",
    "sigungu": "경기 의정부시",
    "lat": 37.7263792,
    "lng": 127.0430521,
    "source_note": "주민센터 주소: 경기도 의정부시 신흥로 115(호원동). Nominatim 매치."
  },
  {
    "code": "4115056100",
    "name": "장암동",
    "sigungu": "경기 의정부시",
    "lat": 37.7263435,
    "lng": 127.0542463,
    "source_note": "주민센터 주소: 경기도 의정부시 장곡로250번길 23(장암동). Nominatim 매치."
  },
  {
    "code": "4115057300",
    "name": "송산1동",
    "sigungu": "경기 의정부시",
    "lat": 37.7311871,
    "lng": 127.0868441,
    "source_note": "주민센터 주소: 경기도 의정부시 민락로 13(용현동). Nominatim 매치."
  },
  {
    "code": "4115057600",
    "name": "송산2동",
    "sigungu": "경기 의정부시",
    "lat": 37.7397170,
    "lng": 127.0899910,
    "source_note": "주민센터 주소: 경기도 의정부시 용민로 115(민락동). Nominatim 매치. '민락1동'이라는 행정동은 실재하지 않아 이 항목으로 대체."
  },
  {
    "code": "4115057800",
    "name": "송산3동",
    "sigungu": "경기 의정부시",
    "lat": 37.7531186,
    "lng": 127.1131174,
    "source_note": "주민센터 주소: 경기도 의정부시 민락로 360(낙양동, 2021.12 개청). 지번 매칭 실패로 인근 버스정류장 좌표 대체. (좌표 추정치 — 재검증 필요)"
  }
]
```

- [ ] **Step 2: 데이터 검증 스크립트 실행**

Run:
```bash
node -e "
const a = require('./data/areas-seed.json');
console.assert(a.length === 202, 'FAIL: 항목 수가 202가 아님, 실제 ' + a.length);
const codes = new Set(a.map(x => x.code));
console.assert(codes.size === 202, 'FAIL: code 중복 존재, 고유 개수 ' + codes.size);
const required = ['code', 'name', 'sigungu', 'lat', 'lng', 'source_note'];
for (const item of a) {
  for (const key of required) {
    console.assert(item[key] !== undefined && item[key] !== '', 'FAIL: ' + item.name + '에 ' + key + ' 누락');
  }
}
console.log('OK: 202개 항목, 코드 중복 없음, 필수 필드 모두 존재');
"
```
Expected: `OK: 202개 항목, 코드 중복 없음, 필수 필드 모두 존재` 출력, `FAIL`로 시작하는 assertion 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add data/areas-seed.json
git commit -m "$(cat <<'EOF'
데이터: 경기 서북부(고양·파주·김포·양주·의정부) 50개 행정동 추가

주거 밀집 핵심동만 선별해 areas 시드 데이터에 반영.
좌표/코드 출처는 각 항목 source_note 참고, 추정치 8건 포함.
EOF
)"
```

---

### Task 2: `scripts/seed-areas.ts` 확장 이력 주석 갱신

**Files:**
- Modify: `scripts/seed-areas.ts:1-19` (상단 JSDoc 주석)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (문서 주석만 변경, 실행 로직 불변)

- [ ] **Step 1: 상단 주석에 2차 확장 이력 추가**

현재 주석(발췌):
```ts
/**
 * areas 테이블 시드 스크립트.
 *
 * 대상: 성남시(수정구·중원구·분당구), 하남시, 과천시, 의왕시,
 *       용인시(수지구·기흥구만 — 처인구 제외), 광주시(읍·면·동 전체) — PRD 초기 지원 지역.
 *       + 수원시(영통구·권선구), 화성시(동탄구) — 1차 확장 (분당선/신분당선/GTX·SRT로
 *       강남·판교 통근권과 이어지는 인접 신도시, PRD §8 확장 기준에 따른 추가).
 * PRD 근거: docs/PRD-우리집.md §8 "초기 지원 지역"
 *
 * 데이터 출처/산출 방식은 data/areas-seed.json 각 항목의 source_note에 남겨뒀다.
 * 초기 119개는 행정안전부 행정표준코드관리시스템 기준 코드 + 주민센터 주소 지오코딩.
 * 확장 33개(수원 영통·권선, 화성 동탄)는 SBIZ 상가정보 API 반경조회 응답의
 * 행정동코드(adongCd)·좌표를 그대로 썼다 — 실제 등록 상가 데이터 기반이라 코드
 * 정확도는 높지만, 좌표는 주민센터가 아니라 슈퍼마켓 업종 매장들의 평균 위치라
 * 기존 119개보다 대표성이 다소 느슨하다.
 * source_note가 "추정치"인 항목은 출처를 교차 확인하지 못한 값이니,
 * 실사용 전에 재검증이 필요하다.
 *
 * 지역 확장 시: data/areas-seed.json에 항목을 추가하고 이 스크립트를 다시 실행하면 된다
 * (CLAUDE.md 절대 규칙 — 지역 하드코딩 금지: 코드에는 지역명을 적지 않고 이 JSON만 늘린다).
 *
 * 실행: npx tsx scripts/seed-areas.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (areas 테이블은 RLS상 service role 쓰기만 허용되어 있어 anon 키로는 실행할 수 없다.)
 */
```

`* PRD 근거: docs/PRD-우리집.md §8 "초기 지원 지역"` 줄 바로 아래에 다음 문단을 추가한다 (파일명도 실제 존재하는 `docs/PRD-우리집_v2.md`로 함께 교정):

```ts
 * PRD 근거: docs/PRD-우리집_v2.md §8 "초기 지원 지역"
 *
 * + 고양시(일산동구·일산서구), 파주시, 김포시, 양주시, 의정부시 — 2차 확장
 *   (서울도심·여의도·GTX-A 통근권, 주거 밀집 핵심 행정동만 선별해 50개 추가).
 *   행정동코드는 code.go.kr이 검색폼 기반이라 자동 조회가 안 돼, 오픈소스
 *   데이터셋(vuski/admdongkor ver20260701, KIKcd_H 2023-05-01 스냅샷)을
 *   대조해 확보했다 — 기존 두 출처(행안부 공식 조회, SBIZ API)와는 다른
 *   세 번째 소스이니 참고.
```

- [ ] **Step 2: 파일이 여전히 유효한 TypeScript인지 확인**

Run: `npx tsc --noEmit scripts/seed-areas.ts`
Expected: 에러 없이 종료 (주석만 변경했으므로 타입 에러가 나면 안 됨).

- [ ] **Step 3: 커밋**

```bash
git add scripts/seed-areas.ts
git commit -m "문서: seed-areas.ts에 경기 서북부 2차 확장 이력 및 PRD 파일명 교정 반영"
```

---

### Task 3: Supabase에 실제 시드 실행 (프로덕션 쓰기 — 실행 전 사용자 확인 필수)

**Files:**
- 없음 (스크립트 실행만, 파일 변경 없음)

**Interfaces:**
- Consumes: Task 1에서 완성된 `data/areas-seed.json` (202개 항목), `scripts/seed-areas.ts`의 `main()` 함수
- Produces: Supabase `areas` 테이블에 202개 행 (upsert, `onConflict: 'code'`)

**⚠️ 이 태스크는 실제 Supabase 프로젝트의 `areas` 테이블에 쓰기 작업을 수행한다. 실행 전 반드시 사용자에게 "지금 Supabase에 시드를 실행해도 될까요?"라고 확인받는다.**

- [ ] **Step 1: 사용자 확인 후 시드 스크립트 실행**

Run: `npx tsx scripts/seed-areas.ts`
Expected 출력: `areas 시드 완료: 202건 (총 202건 중)`

- [ ] **Step 2: Supabase에서 실제 반영 건수 확인**

Supabase SQL Editor 또는 `psql`에서:
```sql
select count(*) from areas;
```
Expected: `202`

```sql
select code, name, sigungu from areas where sigungu like '경기 고양시%' or sigungu like '경기 파주시%' or sigungu like '경기 김포시%' or sigungu like '경기 양주시%' or sigungu like '경기 의정부시%' order by sigungu, code;
```
Expected: 50행, Task 1의 목록과 이름 일치.

- [ ] **Step 3: 커밋할 파일 없음 — 실행 결과만 다음 태스크 진행자에게 공유**

Task 4 담당자는 이 시드가 완료된 상태를 전제로 진행한다.

---

### Task 4: 신규 지역 통근시간 캐시 동작 확인

**Files:**
- 없음 (수동/API 호출 검증)

**Interfaces:**
- Consumes: `src/lib/commute.ts`의 `ensureCommuteForOrigin`, `src/app/api/odsay/batch-commute/route.ts`, Task 3에서 시드된 202개 `areas` 행
- Produces: `commute_cache` 테이블에 신규 50개 지역에 대한 캐시 행

- [ ] **Step 1: 로컬 개발 서버 실행**

Run: `npm run dev`

- [ ] **Step 2: 고양시 인근 거점으로 온보딩 진행**

브라우저에서 `/s/[임의 세션 id]/onboard/anchor` 접속 → "직접 입력"으로 고양시 일산동구 소재 주소(예: 장항동 인근) 검색·선택 → 통근 상한 시간 슬라이더 아무 값이나 설정 → "Next" 클릭.

- [ ] **Step 3: batch-commute 호출 및 캐시 확인**

브라우저 네트워크 탭에서 `/api/odsay/batch-commute` 요청이 200으로 완료되는지 확인한 뒤, Supabase에서:
```sql
select cc.area_code, a.name, cc.commute_min
from commute_cache cc
join areas a on a.code = cc.area_code
where a.sigungu like '경기 고양시%'
order by cc.commute_min
limit 10;
```
Expected: 최소 1개 이상의 행이 반환되고 `commute_min`이 null이 아닌 숫자값.

- [ ] **Step 4: 커밋할 파일 없음 — 검증 결과만 기록**

이 태스크는 코드 변경이 없으므로 커밋하지 않는다. 이상이 있으면(캐시 행이 비어있거나 에러 발생) `src/lib/commute.ts`의 `ensureCommuteForOrigin` 로직 자체는 지역 무관 범용 구조이므로, 문제 원인은 Task 3의 시드 누락이나 ODsay/카카오모빌리티 API 키 설정 쪽을 먼저 의심한다.

---

### Task 5: PRD §8 "초기 지원 지역" 문구 갱신

**Files:**
- Modify: `docs/PRD-우리집_v2.md:127`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (문서만 갱신, `CLAUDE.md`가 참조하는 단일 기준 문서를 실제 지원 지역과 동기화)

- [ ] **Step 1: §8 지역 범위 문단 교체**

현재 127번 줄:
```
**초기 지원 지역 (확정)**: 강남·판교 두 업무지구의 통근권이 겹치는 경기 동남부 — 성남시, 하남시, 과천시, 의왕시, 용인시(수지구·기흥구), 광주시를 1차 범위로 한다 (행정동 약 60~80개). 선정 근거: ① "한 명은 강남, 한 명은 판교" 조합이 흔해 통근 균형이라는 핵심 기능이 가장 잘 작동하는 무대, ② 서울 대비 신혼부부 예산과 맞는 진입 가격대의 구역이 충분, ③ 행정동 규모가 통근 캐시·데이터 배치 비용으로 감당 가능. 확장 기준: NSM이 안정적으로 발생하고 교집합 0건 비율(가드레일①)이 임계 이하로 유지되면, 인접 통근권(분당선·신분당선·경강선 연장 축) 순으로 넓힌다. 지역 확장은 areas 테이블 시드 추가만으로 가능하도록 지역 하드코딩을 금지한다.
```

다음으로 교체:
```
**초기 지원 지역 (확정, 2026-07 기준)**: 강남·판교 두 업무지구의 통근권이 겹치는 경기 동남부 — 성남시, 하남시, 과천시, 의왕시, 용인시(수지구·기흥구), 광주시를 1차 범위로 한다. 이후 분당선/신분당선/GTX·SRT 인접 신도시인 수원시(영통구·권선구), 화성시(동탄구)를 1차 확장으로 추가했고, 서울도심·여의도·GTX-A 통근권 수요에 대응해 고양시(일산동구·일산서구), 파주시, 김포시, 양주시, 의정부시의 주거 밀집 핵심 행정동을 2차 확장으로 추가했다 (현재 총 202개 행정동). 선정 근거: ① "한 명은 강남, 한 명은 판교" 조합이 흔해 통근 균형이라는 핵심 기능이 가장 잘 작동하는 무대, ② 서울 대비 신혼부부 예산과 맞는 진입 가격대의 구역이 충분, ③ 행정동 규모가 통근 캐시·데이터 배치 비용으로 감당 가능. 확장 기준: NSM이 안정적으로 발생하고 교집합 0건 비율(가드레일①)이 임계 이하로 유지되면, 인접 통근권(분당선·신분당선·경강선 축) 또는 서울도심·여의도·GTX-A 축 등 신혼부부 통근 수요가 확인되는 권역 순으로 넓힌다. 지역 확장은 areas 테이블 시드 추가만으로 가능하도록 지역 하드코딩을 금지한다.
```

- [ ] **Step 2: 문서 렌더링 확인**

Run: `grep -n "2차 확장" docs/PRD-우리집_v2.md`
Expected: 127번 줄이 출력되고 위에서 교체한 문구가 그대로 보임.

- [ ] **Step 3: 커밋**

```bash
git add docs/PRD-우리집_v2.md
git commit -m "문서: PRD §8 초기 지원 지역에 경기 서북부 2차 확장 반영"
```

---

### Task 6: 지도 폴백 기본 중심좌표 조정 (선택, 낮은 우선순위)

**Files:**
- Modify: `src/components/result-map-sheet.tsx:58-59`

**Interfaces:**
- Consumes: 없음
- Produces: `DEFAULT_CENTER` 상수 — 핀이 하나도 없을 때만 지도 초기 중심으로 쓰임 (이 파일 428번 줄 근처 `kakao.maps.LatLngBounds` 동적 계산 로직에는 영향 없음)

- [ ] **Step 1: 상수와 주석 교체**

현재:
```ts
// 지원 지역(경기 동남부) 대략 중심 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.395, lng: 127.111 }
```

교체:
```ts
// 지원 지역 전체(경기 동남부~서북부)를 아우르는 서울 중심 근사 좌표 — 핀이 하나도 없을 때만 쓰는 기본 좌표.
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }
```

- [ ] **Step 2: 타입/빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없이 종료.

- [ ] **Step 3: 커밋**

```bash
git add src/components/result-map-sheet.tsx
git commit -m "수정: 지도 폴백 기본 중심좌표를 서울 중심으로 조정"
```

---

## Self-Review 결과

- **스펙 커버리지**: 설계 문서의 4개 코드 변경 항목(데이터 추가, 스크립트 주석, PRD 갱신, 지도 폴백 좌표) 모두 Task 1·2·5·6에 대응. 검증 계획 3개 항목(upsert 건수, 테이블 행 수, commute_cache 확인)은 Task 1 Step 2, Task 3 Step 2, Task 4에 대응. `sigungu-filter-sheet`/지도 그룹핑 확인은 Task 4에서 개발 서버로 실제 온보딩을 진행하며 함께 관찰 가능하므로 별도 태스크를 추가하지 않았다.
- **플레이스홀더 스캔**: "TBD", "나중에" 류 표현 없음 — 모든 스텝에 실제 코드/명령어 포함.
- **타입/필드 일관성**: `AreaSeed` 인터페이스(`code, name, sigungu, lat, lng, source_note`)가 Task 1의 JSON, `scripts/seed-areas.ts`의 기존 타입 정의와 일치함을 확인.
