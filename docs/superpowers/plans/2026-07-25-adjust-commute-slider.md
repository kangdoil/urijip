# 조율하기(/adjust) 통근 슬라이더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/adjust` 화면에 예산 슬라이더와 동일한 패턴의 통근 슬라이더를 추가하고, 편집 화면·결정 화면 양쪽에 일관되게 반영한다.

**Architecture:** 백엔드에 통근 +30분 슬랙을 가진 전용 후보 조회 함수(`_adjust_candidates`)를 추가해 `get_adjust_data`가 쓰도록 바꾸고, `decide_proposal`이 `commute_max_min` payload를 반영하도록 확장한다. 프론트(`src/app/s/[id]/adjust/page.tsx`)는 예산과 같은 상태/파생값 패턴으로 통근 상태를 추가하고, 편집 화면에 "통근 상한 조정" 카드를 추가하며, 결정 화면은 기존 diff 카드 + `AdjustAreaPreviewList` 재사용으로 정리한다.

**Tech Stack:** Next.js App Router + TypeScript, Supabase(Postgres RPC), Tailwind, `@/components/ui/slider`(Radix 기반). 이 저장소엔 테스트 러너가 없다 — DB 로직은 원격 프로젝트(kvhsviugkbvrjdkfhlra)에 임시 fixture 스크립트로, UI는 `npx tsc --noEmit` + 실제 dev 서버 브라우저 구동으로 검증한다.

## Global Constraints

- 통근 슬라이더 슬랙은 **고정 +30분**(둘 중 높은 원래 상한 기준), 슬라이더 최대치는 `Math.min(높은 원래값 + 30, 120)` — `participants.commute_max_min`의 DB 체크 제약(`between 10 and 120`)을 절대 넘지 않는다.
- 통근 슬라이더 `step`은 5분.
- 통근은 예산과 달리 **인당 값**이라 공유 "적용값" 개념이 없다 — 후보 필터링은 각자 자기 값으로 따로 비교한다(`c.a_minutes <= aCommuteValue && c.b_minutes <= bCommuteValue`), 예산처럼 `min(a,b)` 단일값을 쓰지 않는다.
- 한 세션의 콜드 스테이션 병목은 예산 또는 통근 중 하나뿐이라는 기존 가정(`get_concession_matches` 사다리가 a_target/b_target 중 하나만 'budget'|'commute'로 정함)은 유지한다 — 두 추천 배너가 동시에 뜨는 경우는 없다.
- 화면 (1) 편집 화면의 CTA는 조건부 문구 없이 항상 `총 {passing.length}곳 제안하고 동네 보러 가기`.
- 화면 (3) 결정 화면(상대가 제안 → 내가 결정)의 우선순위 그리드 카드 + 비활성 예산 슬라이더 카드는 삭제하고, 이미 있는 diff 카드(변경 사항 목록)가 `commute_max_min`까지 자동으로 보여주도록 한다. 미리보기 리스트는 `GroupedAreaList` 대신 화면 (1)이 이미 쓰는 `AdjustAreaPreviewList`로 통일한다. 버튼 라벨은 "No"→"다시 조율하기", "Yesss!"→"이 조건 수락하기".
- 화면 (2)(제안 완료 후 상대 확인 대기)는 이번 범위 밖 — 건드리지 않는다.
- `get_matches`, `get_fallback_matches`, `get_conflict_report`, 기존 `_session_candidates`는 변경하지 않는다.

---

## File Structure

- **Create:** `supabase/migrations/20260725020000_adjust_commute_slider.sql`
- **Modify:** `src/app/s/[id]/adjust/page.tsx` (유일한 프론트 파일 — 상태/파생값/화면 (1)/화면 (3) 전부 이 파일 안에 있음)

---

### Task 1: DB — 통근 슬랙 후보 조회 + commute_max_min 반영

**Files:**
- Create: `supabase/migrations/20260725020000_adjust_commute_slider.sql`
- Create (temporary, deleted at end of task): `scripts/tmp-verify-adjust-commute.ts`

**Interfaces:**
- Consumes: 기존 `public.participants`(`commute_max_min int check between 10 and 120`, `budget_max_krw`, `anchor_lat/lng`, `transport_mode`), `public.areas`, `public.area_stats`, `public.commute_cache`, `public.participant_conditions`, `public.proposals`.
- Produces: `public._adjust_candidates(sid uuid) returns table(code text, name text, sigungu text, avg_price_krw bigint, a_minutes int, b_minutes int, lat double precision, lng double precision, satisfied jsonb)`. `public.get_adjust_data(sid uuid)` 응답의 `a`/`b` 객체에 `commute_max_min` 필드 추가(기존 `id`/`budget_max_krw`/`priorities`는 그대로). `public.decide_proposal(pid uuid, accept boolean)`이 payload의 `commute_max_min` 키를 처리.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260725020000_adjust_commute_slider.sql` 전체 내용:

```sql
-- =============================================================
-- 조율하기(/adjust) 화면 통근 슬라이더 지원
-- (docs/superpowers/specs/2026-07-25-adjust-commute-slider-design.md).
--
-- get_adjust_data가 쓰는 _session_candidates는 통근을 하드 필터링하고
-- get_matches/get_fallback_matches/get_conflict_report와 공유되므로 그대로
-- 두고, 조율 화면 전용으로 통근 +30분 슬랙을 준 _adjust_candidates를
-- 새로 추가한다. 예산은 원래도 이 계층에서 필터링하지 않으므로 손댈 게 없다.
-- =============================================================

create or replace function public._adjust_candidates(sid uuid)
returns table (
  code text, name text, sigungu text,
  avg_price_krw bigint, a_minutes int, b_minutes int,
  lat double precision, lng double precision,
  satisfied jsonb
) language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  if a_p.id is null or b_p.id is null
     or a_p.completed_at is null or b_p.completed_at is null then
    raise exception '아직 두 사람 모두 조건 입력을 마치지 않았어요';
  end if;

  return query
  select
    ar.code, ar.name, ar.sigungu,
    st.avg_price_krw, ca.minutes, cb.minutes,
    ar.lat, ar.lng,
    jsonb_build_object(
      'area_size', coalesce(st.size_59_ok, false),
      'build_year', (st.built_year_avg is not null and st.built_year_avg >= extract(year from now())::int - 10),
      'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
    )
  from public.areas ar
  join public.area_stats st on st.area_code = ar.code
  join public.commute_cache ca
    on ca.area_code = ar.code and ca.mode = a_p.transport_mode
   and ca.origin_key = round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3)
  join public.commute_cache cb
    on cb.area_code = ar.code and cb.mode = b_p.transport_mode
   and cb.origin_key = round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3)
  where ca.minutes <= a_p.commute_max_min + 30
    and cb.minutes <= b_p.commute_max_min + 30;
end $$;

create or replace function public.get_adjust_data(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
  result jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  select jsonb_build_object(
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sigungu', c.sigungu,
        'avg_price_krw', c.avg_price_krw,
        'a_minutes', c.a_minutes, 'b_minutes', c.b_minutes,
        'satisfied', c.satisfied
      ))
      from public._adjust_candidates(sid) c
    ), '[]'::jsonb),
    'a', jsonb_build_object(
      'id', a_p.id,
      'budget_max_krw', a_p.budget_max_krw,
      'commute_max_min', a_p.commute_max_min,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = a_p.id
      ), '{}'::jsonb)
    ),
    'b', jsonb_build_object(
      'id', b_p.id,
      'budget_max_krw', b_p.budget_max_krw,
      'commute_max_min', b_p.commute_max_min,
      'priorities', coalesce((
        select jsonb_object_agg(condition_code, priority)
        from public.participant_conditions where participant_id = b_p.id
      ), '{}'::jsonb)
    )
  ) into result;

  return result;
end $$;

create or replace function public.decide_proposal(pid uuid, accept boolean)
returns void language plpgsql security definer as $$
declare
  prop record;
  my_participant record;
  key text;
  val jsonb;
begin
  select * into prop from public.proposals where id = pid;
  if prop.id is null then
    raise exception '존재하지 않는 제안이에요';
  end if;
  if prop.status <> 'pending' then
    raise exception '이미 처리된 제안이에요';
  end if;
  if not public.is_session_member(prop.session_id) then
    raise exception '세션 참여자만 처리할 수 있어요';
  end if;

  select * into my_participant from public.participants
    where session_id = prop.session_id and user_id = auth.uid();

  if my_participant.id = prop.proposer_id then
    raise exception '본인 제안은 스스로 결정할 수 없어요';
  end if;

  if accept then
    for key, val in select * from jsonb_each(prop.payload)
    loop
      if key in ('area_size', 'build_year', 'infra') then
        insert into public.participant_conditions (participant_id, condition_code, priority)
        values (prop.proposer_id, key, (val #>> '{}')::int)
        on conflict (participant_id, condition_code) do update set priority = excluded.priority;
      elsif key = 'budget_max_krw' then
        update public.participants set budget_max_krw = (val #>> '{}')::bigint
        where id = prop.proposer_id;
      elsif key = 'commute_max_min' then
        update public.participants set commute_max_min = (val #>> '{}')::int
        where id = prop.proposer_id;
      end if;
    end loop;

    update public.proposals set status = 'accepted', decided_at = now() where id = pid;
  else
    update public.proposals set status = 'rejected', decided_at = now() where id = pid;
  end if;
end $$;
```

- [ ] **Step 2: 원격 프로젝트에 적용**

Run: `supabase db push` (linked project: `kvhsviugkbvrjdkfhlra`, `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`이 가리키는 곳과 동일 — 이 저장소는 로컬 Docker 스택을 쓰지 않는다).
Expected: 마이그레이션이 에러 없이 적용됨. 이미 같은 이름 함수를 `create or replace`하는 것이라 재실행해도 안전하다.

- [ ] **Step 3: fixture 검증 스크립트 작성**

`scripts/tmp-verify-adjust-commute.ts` (임시 — 이 태스크 마지막에 삭제):

```ts
/**
 * get_adjust_data가 +30분 슬랙 후보와 commute_max_min을 내려주는지,
 * decide_proposal이 commute_max_min을 반영하는지 검증한다.
 * 실행: npx tsx scripts/tmp-verify-adjust-commute.ts
 * 필요 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  console.log(`OK ${label}`)
}

async function main() {
  const { data: userA, error: userAErr } = await admin.auth.admin.createUser({
    email: `verify-adjust-a-${Date.now()}@example.com`,
    password: 'verify-password-1234',
    email_confirm: true,
  })
  if (userAErr) throw userAErr
  const { data: userB, error: userBErr } = await admin.auth.admin.createUser({
    email: `verify-adjust-b-${Date.now()}@example.com`,
    password: 'verify-password-1234',
    email_confirm: true,
  })
  if (userBErr) throw userBErr

  const { data: session, error: sessionErr } = await admin.from('sessions').insert({}).select('id').single()
  if (sessionErr) throw sessionErr
  const sid = session.id as string

  // A 원래 통근 상한 40분, B 40분 — 구역 하나는 A 42분(원래 상한 밖, +30분
  // 슬랙 안), 하나는 A 100분(슬랙 밖) 으로 설계해 딱 1곳만 새로 열리게 한다.
  const { data: participants, error: pErr } = await admin
    .from('participants')
    .insert([
      {
        session_id: sid, user_id: userA.user.id, role: 'A',
        anchor_lat: 37.401, anchor_lng: 127.101, transport_mode: 'car',
        commute_max_min: 40, budget_max_krw: 500000000, completed_at: new Date().toISOString(),
      },
      {
        session_id: sid, user_id: userB.user.id, role: 'B',
        anchor_lat: 37.501, anchor_lng: 127.201, transport_mode: 'car',
        commute_max_min: 40, budget_max_krw: 500000000, completed_at: new Date().toISOString(),
      },
    ])
    .select('id, role')
  if (pErr) throw pErr
  const aId = participants.find((p) => p.role === 'A')!.id
  const bId = participants.find((p) => p.role === 'B')!.id

  const areas = [
    { code: 'ADJVERIFY01', aMinutes: 35, bMinutes: 35 }, // 원래 상한 안 — 항상 통과
    { code: 'ADJVERIFY02', aMinutes: 42, bMinutes: 35 }, // +30분 슬랙 안(40+30=70>42) — 슬랙 덕에 새로 보임
    { code: 'ADJVERIFY03', aMinutes: 100, bMinutes: 35 }, // 슬랙(70분) 밖 — 여전히 안 보여야 함
  ]

  const { error: areaErr } = await admin.from('areas').insert(
    areas.map((a) => ({ code: a.code, name: a.code, sigungu: '검증용', lat: 37.45, lng: 127.15 }))
  )
  if (areaErr) throw areaErr

  const { error: statErr } = await admin.from('area_stats').insert(
    areas.map((a) => ({
      area_code: a.code, avg_price_krw: 300000000,
      built_year_avg: 2000, mart_ok: false, hospital_ok: false, park_ok: false, size_59_ok: false,
    }))
  )
  if (statErr) throw statErr

  const commuteRows = areas.flatMap((a) => [
    { origin_key: '37.401,127.101', area_code: a.code, mode: 'car', minutes: a.aMinutes },
    { origin_key: '37.501,127.201', area_code: a.code, mode: 'car', minutes: a.bMinutes },
  ])
  const { error: commuteErr } = await admin.from('commute_cache').insert(commuteRows)
  if (commuteErr) throw commuteErr

  // 실제 로그인 세션으로 get_adjust_data 호출 (RLS 통과 확인 겸 실사용 경로 검증)
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { error: signInErr } = await anon.auth.signInWithPassword({
    email: userA.user.email!,
    password: 'verify-password-1234',
  })
  if (signInErr) throw signInErr

  const { data: adjustData, error: rpcErr } = await anon.rpc('get_adjust_data', { sid })
  if (rpcErr) throw rpcErr

  assertEqual(adjustData.a.commute_max_min, 40, 'a.commute_max_min')
  assertEqual(adjustData.b.commute_max_min, 40, 'b.commute_max_min')
  const codes = (adjustData.candidates as { code: string }[]).map((c) => c.code).sort()
  assertEqual(codes, ['ADJVERIFY01', 'ADJVERIFY02'], 'candidates (슬랙 안쪽 2곳만, 슬랙 밖 1곳 제외)')

  // decide_proposal이 commute_max_min을 실제로 반영하는지 — B가 제안하고 A가 수락
  const { data: proposal, error: proposalErr } = await admin
    .from('proposals')
    .insert({ session_id: sid, proposer_id: bId, payload: { commute_max_min: 55 } })
    .select('id')
    .single()
  if (proposalErr) throw proposalErr

  const { error: decideErr } = await anon.rpc('decide_proposal', { pid: proposal.id, accept: true })
  if (decideErr) throw decideErr

  const { data: bAfter, error: bAfterErr } = await admin
    .from('participants')
    .select('commute_max_min')
    .eq('id', bId)
    .single()
  if (bAfterErr) throw bAfterErr
  assertEqual(bAfter.commute_max_min, 55, 'decide_proposal 이후 B commute_max_min')

  // ===== 정리 =====
  await admin.from('sessions').delete().eq('id', sid)
  await admin.from('areas').delete().in('code', areas.map((a) => a.code))
  await admin.auth.admin.deleteUser(userA.user.id)
  await admin.auth.admin.deleteUser(userB.user.id)

  console.log('모든 검증 통과')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 4: 스크립트 실행**

Run: `npx tsx scripts/tmp-verify-adjust-commute.ts`
Expected: `OK a.commute_max_min`, `OK b.commute_max_min`, `OK candidates (...)`, `OK decide_proposal 이후 B commute_max_min`, `모든 검증 통과`. 실패하면 에러의 `expected`/`got`을 비교해 SQL을 수정하고 `supabase db push` 후 재실행한다.

- [ ] **Step 5: 임시 스크립트 삭제 및 커밋**

```bash
rm scripts/tmp-verify-adjust-commute.ts
git add supabase/migrations/20260725020000_adjust_commute_slider.sql
git commit -m "$(cat <<'EOF'
추가: 조율하기 화면용 통근 슬랙 후보 조회 + commute_max_min 반영

get_matches 등이 공유하는 _session_candidates를 건드리지 않고, 조율
화면 전용 _adjust_candidates(+30분 슬랙)를 추가해 get_adjust_data가
쓰도록 한다. decide_proposal은 commute_max_min payload도 반영한다.
EOF
)"
```

---

### 라인 번호 주의사항 (Task 2·3 공통)

아래 각 Step이 인용하는 줄 번호는 **이 태스크를 시작하기 직전의 파일 상태** 기준이다 — 같은 태스크 안에서도 앞 Step이 줄을 추가/삭제하면 뒤 Step의 줄 번호가 밀린다. 줄 번호는 방향을 잡는 참고용으로만 쓰고, 실제로 편집할 위치는 각 Step이 제시하는 **원본 코드 스니펫(old code)과 내용이 정확히 일치하는 부분**을 찾아 확인한 뒤 수정한다. 확신이 안 서면 그 근처를 다시 읽고 진행한다.

### Task 2: 프론트 — 통근 상태/파생값 + 편집 화면(1) UI

**Files:**
- Modify: `src/app/s/[id]/adjust/page.tsx`

**Interfaces:**
- Consumes: Task 1의 `get_adjust_data` 응답 형태(`a`/`b`에 `commute_max_min` 포함), `decide_proposal`의 `commute_max_min` payload 처리.
- Produces: `ParticipantAdjust.commute_max_min: number`. 컴포넌트 state `aCommuteValue`/`bCommuteValue: number`, 파생값 `highCommuteOriginal`/`commuteHasConflict`/`commuteSliderMax: number`, `commuteCardRef`. `countMatches(candidates, budget, aCommute, bCommute, aOrder, bOrder)` — 시그니처 변경(다음 태스크가 이 시그니처를 그대로 소비). `recommendation`의 타입이 `{ kind: 'budget' | 'commute'; role: 'A' | 'B'; amount: number; areaCount: number } | null`로 확장(다음 태스크는 건드리지 않지만 화면 (3)에서 참조하진 않음 — screen (1) 전용).

- [ ] **Step 1: `ParticipantAdjust` 인터페이스 확장**

`src/app/s/[id]/adjust/page.tsx:35-39`를 교체:

```tsx
interface ParticipantAdjust {
  id: string
  budget_max_krw: number
  commute_max_min: number
  priorities: Record<string, Priority>
}
```

- [ ] **Step 2: `buildChanges`에 `commute_max_min` 케이스 추가**

`src/app/s/[id]/adjust/page.tsx:106-114`(현재 `if ('budget_max_krw' in payload) { ... }` 블록) 바로 뒤에 추가:

```tsx
  if ('commute_max_min' in payload) {
    changes.push({
      key: 'commute_max_min',
      label: '통근 상한',
      oldValue: `${original.commute_max_min}분`,
      newValue: `${Number(payload.commute_max_min)}분`,
      isSkip: false,
    })
  }
```

- [ ] **Step 3: `countMatches` 시그니처 확장**

`src/app/s/[id]/adjust/page.tsx:93-98`을 교체:

```tsx
function countMatches(
  candidates: Candidate[],
  budget: number,
  aCommute: number,
  bCommute: number,
  aOrder: string[],
  bOrder: string[]
) {
  const passing = candidates
    .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= budget)
    .filter((c) => c.a_minutes <= aCommute && c.b_minutes <= bCommute)
    .filter((c) => priorityHardOk(aOrder, c.satisfied) && priorityHardOk(bOrder, c.satisfied))
  return new Set(passing.map((c) => c.sigungu)).size
}
```

- [ ] **Step 4: 통근 state 추가 + 초기화(pending proposal 오버레이 포함)**

`src/app/s/[id]/adjust/page.tsx:157-158`(현재 `const [aBudgetValue, setABudgetValue] = useState(0)` / `const [bBudgetValue, setBBudgetValue] = useState(0)`) 바로 뒤에 추가:

```tsx
  const [aCommuteValue, setACommuteValue] = useState(0)
  const [bCommuteValue, setBCommuteValue] = useState(0)
```

`src/app/s/[id]/adjust/page.tsx:168`(현재 `const budgetCardRef = useRef<HTMLDivElement>(null)`) 바로 뒤에 추가:

```tsx
  const commuteCardRef = useRef<HTMLDivElement>(null)
```

`refresh()` 안, `src/app/s/[id]/adjust/page.tsx:214-215`(`let aBudgetInit = ...` / `let bBudgetInit = ...`) 바로 뒤에 추가:

```tsx
    let aCommuteInit = parsed.a.commute_max_min
    let bCommuteInit = parsed.b.commute_max_min
```

`src/app/s/[id]/adjust/page.tsx:227-230`(`if ('budget_max_krw' in pendingProposal.payload) { ... }` 블록) 바로 뒤에 추가:

```tsx
      if ('commute_max_min' in pendingProposal.payload) {
        if (proposerIsA) aCommuteInit = Number(pendingProposal.payload.commute_max_min)
        else bCommuteInit = Number(pendingProposal.payload.commute_max_min)
      }
```

`src/app/s/[id]/adjust/page.tsx:236-237`(`setABudgetValue(aBudgetInit)` / `setBBudgetValue(bBudgetInit)`) 바로 뒤에 추가:

```tsx
    setACommuteValue(aCommuteInit)
    setBCommuteValue(bCommuteInit)
```

`wasColdStation` 계산부, `src/app/s/[id]/adjust/page.tsx:243-249`를 교체:

```tsx
    const wasColdStation =
      countMatches(
        parsed.candidates,
        originalLowBudget,
        parsed.a.commute_max_min,
        parsed.b.commute_max_min,
        orderFromPriorities(parsed.a.priorities),
        orderFromPriorities(parsed.b.priorities)
      ) === 0
```

- [ ] **Step 5: 파생값 추가**

`src/app/s/[id]/adjust/page.tsx:267-278`(예산 파생값 블록) 바로 뒤에 추가:

```tsx
  const highCommuteOriginal = data ? Math.max(data.a.commute_max_min, data.b.commute_max_min) : 0
  const commuteHasConflict = data ? data.a.commute_max_min !== data.b.commute_max_min : false
  // 통근은 인당 값이라(예산처럼 "더 낮은 쪽" 공유 기준이 없음) appliedCommute
  // 같은 단일 파생값을 만들지 않는다 — passing 필터가 각자 값으로 따로 비교한다.
  // 슬라이더 max는 DB 체크 제약(commute_max_min between 10 and 120)을 넘지 않게 캡한다.
  const commuteSliderMax = Math.min(highCommuteOriginal + 30, 120)
```

- [ ] **Step 6: 추천 배너 로직에 통근 병목 추가**

`src/app/s/[id]/adjust/page.tsx:288-302`를 교체:

```tsx
  const budgetRecommendation = (() => {
    if (!concession || !data || !me) return null
    if (concession.main.total_count === 0) return null
    const lowerRole: 'A' | 'B' = data.a.budget_max_krw <= data.b.budget_max_krw ? 'A' : 'B'
    if (me.role !== lowerRole) return null
    const side = lowerRole === 'A' ? concession.main.give.a : concession.main.give.b
    if (side.budget_widen_krw === 0) return null
    return { kind: 'budget' as const, role: lowerRole, amount: side.budget_widen_krw, areaCount: concession.main.total_count }
  })()

  // 통근은 인당 값이라 "더 낮은 쪽" 비교 없이, 병목인 본인 role에게만 보여준다.
  const commuteRecommendation = (() => {
    if (!concession || !data || !me) return null
    if (concession.main.total_count === 0) return null
    const side = me.role === 'A' ? concession.main.give.a : concession.main.give.b
    if (side.commute_widen_min === 0) return null
    return { kind: 'commute' as const, role: me.role, amount: side.commute_widen_min, areaCount: concession.main.total_count }
  })()

  // 한 세션의 병목은 예산 또는 통근 중 하나뿐이라(사다리가 a_target/b_target을
  // 각각 하나로만 정함) 두 추천이 동시에 존재하는 경우는 없다.
  const recommendation = budgetRecommendation ?? commuteRecommendation
```

- [ ] **Step 7: `applyRecommendation` 분기 처리**

`src/app/s/[id]/adjust/page.tsx:304-314`를 교체:

```tsx
  function applyRecommendation() {
    if (!recommendation) return
    if (recommendation.kind === 'budget') {
      const setBudget = recommendation.role === 'A' ? setABudgetValue : setBBudgetValue
      setBudget((v) => Math.min(v + recommendation.amount, budgetSliderMax))
    } else {
      const setCommute = recommendation.role === 'A' ? setACommuteValue : setBCommuteValue
      setCommute((v) => Math.min(v + recommendation.amount, commuteSliderMax))
    }
    setHighlightTarget(recommendation.kind)
    setRecommendationApplied(true)
    requestAnimationFrame(() => {
      const ref = recommendation.kind === 'budget' ? budgetCardRef : commuteCardRef
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => setHighlightTarget(null), 2500)
  }
```

- [ ] **Step 8: `passing` 필터에 통근 조건 추가**

`src/app/s/[id]/adjust/page.tsx:316-329`를 교체:

```tsx
  const passing = useMemo(() => {
    if (!data) return []
    return data.candidates
      .filter((c) => c.avg_price_krw != null && c.avg_price_krw <= appliedBudget)
      .filter((c) => c.a_minutes <= aCommuteValue && c.b_minutes <= bCommuteValue)
      .filter((c) => priorityHardOk(aOrder, c.satisfied) && priorityHardOk(bOrder, c.satisfied))
      .map((c) => {
        const score = CODES.reduce((sum, code) => {
          if (!c.satisfied[code]) return sum
          return sum + priorityWeight(aOrder, code) + priorityWeight(bOrder, code)
        }, 0)
        return { ...c, score }
      })
      .sort((x, y) => y.score - x.score || x.a_minutes + x.b_minutes - (y.a_minutes + y.b_minutes))
  }, [data, aOrder, bOrder, appliedBudget, aCommuteValue, bCommuteValue])
```

- [ ] **Step 9: `myDiff`/`saveMyChanges`에 통근 반영**

`src/app/s/[id]/adjust/page.tsx:333-350`(`myDiff` 함수)를 교체:

```tsx
  function myDiff() {
    if (!me || !data) return {}
    const myOrder = me.role === 'A' ? aOrder : bOrder
    const myOriginal = me.role === 'A' ? data.a : data.b
    const myBudgetValue = me.role === 'A' ? aBudgetValue : bBudgetValue
    const myCommuteValue = me.role === 'A' ? aCommuteValue : bCommuteValue

    const payload: Record<string, string | number> = {}
    const originalOrder = orderFromPriorities(myOriginal.priorities)
    if (myOrder.join(',') !== originalOrder.join(',')) {
      myOrder.forEach((code, i) => {
        payload[code] = i + 1
      })
    }
    if (myBudgetValue !== myOriginal.budget_max_krw) {
      payload.budget_max_krw = myBudgetValue
    }
    if (myCommuteValue !== myOriginal.commute_max_min) {
      payload.commute_max_min = myCommuteValue
    }
    return payload
  }
```

`src/app/s/[id]/adjust/page.tsx:380-406`(`saveMyChanges` 함수)를 교체:

```tsx
  async function saveMyChanges(supabase: ReturnType<typeof createClient>) {
    if (!me || !data) return
    const myOrder = me.role === 'A' ? aOrder : bOrder
    const myOriginal = me.role === 'A' ? data.a : data.b
    const myBudgetValue = me.role === 'A' ? aBudgetValue : bBudgetValue
    const myCommuteValue = me.role === 'A' ? aCommuteValue : bCommuteValue

    const originalOrder = orderFromPriorities(myOriginal.priorities)
    if (myOrder.join(',') !== originalOrder.join(',')) {
      const { error: condError } = await supabase.from('participant_conditions').upsert(
        myOrder.map((code, i) => ({
          participant_id: me.id,
          condition_code: code,
          priority: i + 1,
        })),
        { onConflict: 'participant_id,condition_code' }
      )
      if (condError) throw condError
    }

    if (myBudgetValue !== myOriginal.budget_max_krw) {
      const { error: budgetError } = await supabase
        .from('participants')
        .update({ budget_max_krw: myBudgetValue })
        .eq('id', me.id)
      if (budgetError) throw budgetError
    }

    if (myCommuteValue !== myOriginal.commute_max_min) {
      const { error: commuteError } = await supabase
        .from('participants')
        .update({ commute_max_min: myCommuteValue })
        .eq('id', me.id)
      if (commuteError) throw commuteError
    }
  }
```

- [ ] **Step 10: 화면 (3)의 `countMatches` 호출부만 우선 시그니처에 맞춰 갱신**

화면 (3) JSX는 다음 태스크에서 전체를 다시 작업하지만, 이 태스크에서 `countMatches` 시그니처를 바꿨으므로 컴파일이 깨지지 않도록 호출부만 지금 맞춘다. `src/app/s/[id]/adjust/page.tsx:537-539`를 교체:

```tsx
    const beforeBudget = Math.min(data.a.budget_max_krw, data.b.budget_max_krw)
    const sigunguCountBefore = countMatches(
      data.candidates, beforeBudget, data.a.commute_max_min, data.b.commute_max_min, aOrder, bOrder
    )
    const sigunguCountAfter = countMatches(
      data.candidates, appliedBudget, aCommuteValue, bCommuteValue, aOrder, bOrder
    )
```

- [ ] **Step 11: 편집 화면(1)에 "통근 상한 조정" 카드 추가**

`src/app/s/[id]/adjust/page.tsx:687-709`(추천 배너 JSX)를 교체 — `recommendation.kind`에 따라 문구가 갈리도록:

```tsx
          {recommendation && !recommendationApplied && (
            <div className="flex flex-col gap-4 rounded-[40px] border-2 border-pink-500 bg-white px-6 py-6">
              <p className="flex items-center gap-1.5 text-body-m font-bold text-pink-500">
                <Compass className="size-5" />
                추천 조정
              </p>
              <p className="text-body-m leading-[1.6] text-neutral-900">
                <span className="font-bold">
                  {recommendation.role}의 {recommendation.kind === 'budget' ? '예산 상한' : '통근 상한'}
                </span>
                이 {recommendation.kind === 'budget' ? '낮아' : '좁아'} 후보가 없었어요. 아래{' '}
                <span className="font-bold text-accent-teal">강조된 항목</span>처럼{' '}
                <span className="font-bold">
                  {recommendation.kind === 'budget'
                    ? formatEok(recommendation.amount)
                    : `${recommendation.amount}분`}
                </span>{' '}
                {recommendation.kind === 'budget' ? '올리면' : '넓히면'}{' '}
                <span className="font-bold text-pink-500">{recommendation.areaCount}곳</span>이 열려요.
              </p>
              <button
                type="button"
                onClick={applyRecommendation}
                className="flex w-full items-center justify-center rounded-full bg-pink-500 px-10 py-4 text-body-m font-bold text-white"
              >
                추천대로 변경하기
              </button>
            </div>
          )}
```

`src/app/s/[id]/adjust/page.tsx:741-804`(예산 카드 전체) 바로 뒤, `</div>`(예산/우선순위를 감싸는 `flex flex-col gap-3` 닫는 태그) 앞에 새 카드를 추가한다 — 즉 예산 카드 블록 다음, 우선순위+예산을 감싸는 wrapper `<div className="flex flex-col gap-3">`의 닫는 태그 바로 앞:

```tsx
            <div
              ref={commuteCardRef}
              className={cn(
                'rounded-[40px] border border-neutral-100 bg-white px-5 py-5 shadow-[0_10px_20px_rgba(0,0,0,0.04)] transition-all',
                highlightTarget === 'commute' && 'border-pink-500 ring-4 ring-pink-200'
              )}
            >
              <span className="text-title-sb font-bold text-neutral-900">통근 상한 조정</span>
              <p className="mt-1 text-caption-l text-neutral-400">
                {commuteHasConflict ? '통근 상한이 서로 달라요 · ' : '통근 상한이 같아요 · '}
                각자 상한 안에서만 후보에 반영돼요
              </p>

              <div className="mt-4 flex flex-col gap-4">
                {(
                  [
                    ['A', aCommuteValue, setACommuteValue, data.a.commute_max_min] as const,
                    ['B', bCommuteValue, setBCommuteValue, data.b.commute_max_min] as const,
                  ]
                ).map(([role, value, setValue, original]) => {
                  const isMe = me.role === role
                  return (
                    <div key={role} className={cn('flex flex-col gap-2', !isMe && 'opacity-50')}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                            role === 'A' ? 'bg-pink-500' : 'bg-accent-teal'
                          )}
                        >
                          {role}
                        </span>
                        <span className="text-caption-l font-semibold text-neutral-900">
                          {isMe ? '내 통근 상한' : '상대 통근 상한'}
                        </span>
                        <span className="ml-auto text-body-sb font-bold text-neutral-900">{value}분</span>
                      </div>
                      <Slider
                        value={[value]}
                        onValueChange={isMe ? ([v]) => setValue(v) : undefined}
                        min={original}
                        max={commuteSliderMax}
                        step={5}
                      />
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 h-px w-full bg-neutral-100" />
              <p className="mt-3 text-center text-caption-l leading-[1.4] text-neutral-500">
                각자 통근 상한을 올리면 후보를 넓혀볼 수 있어요
              </p>
            </div>
```

(예산 카드는 헤더에 `justify-between`으로 우측 정렬된 현재 적용 예산 값을 보여주지만, 통근은 인당 값이라 그런 단일 요약값이 없다 — 그래서 통근 카드 헤더는 제목만 두고 우측 값 배지를 넣지 않는다. 이건 설계 의도다.)

- [ ] **Step 12: 편집 화면(1) CTA 문구 통일**

`src/app/s/[id]/adjust/page.tsx:838`을 교체:

```tsx
          {`총 ${passing.length}곳 제안하고 동네 보러 가기`}
```

- [ ] **Step 13: 타입 체크 & lint**

Run: `npx tsc --noEmit && npx eslint src/app/s/\[id\]/adjust/page.tsx`
Expected: 에러 없음. (화면 (3) JSX는 아직 옛 구조 그대로라 `lowBudgetOriginal`이 여전히 쓰이고 있어 unused 경고는 안 남아야 한다 — 다음 태스크에서 그 블록을 지우면서 함께 정리한다.)

- [ ] **Step 14: 커밋**

```bash
git add src/app/s/\[id\]/adjust/page.tsx
git commit -m "$(cat <<'EOF'
추가: 조율하기 편집 화면에 통근 상한 조정 카드 추가

예산 슬라이더와 동일한 패턴(역할별 슬라이더, 본인만 조작 가능, 원래
값에서 올리는 방향만 허용)으로 통근 슬라이더를 추가한다. 추천 조정
배너도 통근 병목까지 대칭 확장하고, 편집 화면 CTA 문구를 통일한다.
EOF
)"
```

---

### Task 3: 프론트 — 결정 화면(3) 레이아웃 정리

**Files:**
- Modify: `src/app/s/[id]/adjust/page.tsx`

**Interfaces:**
- Consumes: Task 2가 확장한 `buildChanges`(이제 `commute_max_min` 변경도 항목으로 만듦), `countMatches` 새 시그니처(Task 2 Step 10에서 이미 호출부 갱신 완료), `@/components/adjust-area-preview-list`의 `AdjustAreaPreviewList`(이미 화면 (1)에서 쓰는 컴포넌트, `{ areas, emptyMessage }` props), `@/components/icons/car-icon`의 `CarIcon`.
- Produces: 없음(리프 UI).

- [ ] **Step 1: import 정리**

`src/app/s/[id]/adjust/page.tsx:4`를 교체:

```tsx
import { ArrowRight, ArrowUpDown, Compass } from 'lucide-react'
```

`src/app/s/[id]/adjust/page.tsx:9`(`import { GroupedAreaList } from '@/components/grouped-area-list'`)를 삭제하고, 같은 자리에 추가:

```tsx
import { CarIcon } from '@/components/icons/car-icon'
```

(`AdjustAreaPreviewList`는 `src/app/s/[id]/adjust/page.tsx:10`에 이미 import돼 있다 — 화면 (1)에서 이미 쓰고 있으므로 추가 import 불필요.)

- [ ] **Step 2: diff 카드 행에 아이콘 추가**

`src/app/s/[id]/adjust/page.tsx:557-573`(dark diff 카드의 `{changes.map((change) => ( ... ))}` 블록)를 교체:

```tsx
              {changes.map((change) => (
                <div key={change.key} className="flex items-center justify-between">
                  <span className="flex w-24 shrink-0 items-center gap-1.5 text-body-sb font-semibold text-white">
                    {change.key === 'budget_max_krw' && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/asset/icon/money.svg" alt="" className="size-4" />
                    )}
                    {change.key === 'commute_max_min' && <CarIcon className="size-4 text-white" />}
                    {change.key === 'priorities' && <ArrowUpDown className="size-4 text-white" />}
                    {change.label}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-body-sb font-medium text-white">{change.oldValue}</span>
                    <ArrowRight className="size-4 text-neutral-400" />
                    <span
                      className={cn(
                        'rounded-full px-3 py-1.5 text-body-sb font-bold',
                        change.isSkip ? 'bg-white/10 text-white' : `${badgeColors.badgeBg} ${badgeColors.badgeText}`
                      )}
                    >
                      {change.newValue}
                    </span>
                  </div>
                </div>
              ))}
```

- [ ] **Step 3: 결과 변화 행을 강조 pill로 감싸기**

`src/app/s/[id]/adjust/page.tsx:574-579`를 교체:

```tsx
              <div className="h-px w-full bg-white/10" />
              <div
                className={cn(
                  'flex items-center justify-center gap-3 rounded-xl bg-white/10 px-3 py-2 text-[15px] font-medium',
                  badgeColors.badgeText
                )}
              >
                <span>총 {displayCountBefore}곳</span>
                <ArrowRight className="size-4" />
                <span>총 {displayCountAfter}곳</span>
              </div>
```

- [ ] **Step 4: 우선순위 그리드 + 비활성 예산 슬라이더 카드 삭제**

`src/app/s/[id]/adjust/page.tsx:582-627`(`<div className="flex flex-col gap-3">`로 시작해 우선순위 카드와 예산 카드를 감싸는 블록 전체, 닫는 `</div>`까지)를 통째로 삭제한다.

- [ ] **Step 5: 미리보기를 `AdjustAreaPreviewList`로 교체**

`src/app/s/[id]/adjust/page.tsx:629-640`(`<div className="rounded-t-[60px] ...">...<GroupedAreaList areas={passing} />...</div>`)를 교체:

```tsx
            <div className="rounded-t-[60px] bg-neutral-100 px-4 pt-8 pb-2 -mx-4">
              <div className="mb-6 flex flex-col items-center gap-1.5">
                <p className="text-body-m text-neutral-500">우리가 함께 할 수 있는 동네</p>
                <p className="flex items-center gap-2 text-title-sb font-bold text-neutral-900">
                  <span className="rounded-full bg-neutral-900 px-4 py-2 font-montserrat text-mont-title-m text-white">
                    {sigunguCountAfter}
                  </span>
                  개 시군구에 걸쳐 있어요
                </p>
              </div>
              <AdjustAreaPreviewList areas={passing} emptyMessage="이 조건을 만족하는 동네가 아직 없어요" />
            </div>
```

- [ ] **Step 6: 이제 안 쓰는 `lowBudgetOriginal` 제거**

`lowBudgetOriginal`은 Step 4에서 지운 비활성 예산 슬라이더 블록에서만 쓰였다. `src/app/s/[id]/adjust/page.tsx:267`(`const lowBudgetOriginal = data ? Math.min(data.a.budget_max_krw, data.b.budget_max_krw) : 0`) 줄을 삭제한다. (`highBudgetOriginal`은 `budgetSliderMax` 계산에 계속 쓰이므로 그대로 둔다.)

- [ ] **Step 7: 액션 버튼 라벨 교체**

`src/app/s/[id]/adjust/page.tsx:647-653`, `654-660`(현재 "No"/"Yesss!" 버튼)의 버튼 텍스트만 교체:

```tsx
          <button
            onClick={() => decide(false)}
            disabled={submitting}
            className="flex flex-1 items-center justify-center rounded-full border-2 border-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-pink-500 disabled:opacity-50"
          >
            다시 조율하기
          </button>
          <button
            onClick={() => decide(true)}
            disabled={submitting}
            className="flex flex-1 items-center justify-center rounded-full bg-pink-500 px-10 py-5 font-montserrat text-mont-title-m font-bold text-white disabled:opacity-50"
          >
            이 조건 수락하기
          </button>
```

- [ ] **Step 8: 타입 체크 & lint**

Run: `npx tsc --noEmit && npx eslint src/app/s/\[id\]/adjust/page.tsx`
Expected: 에러·경고 없음 — 특히 `GroupedAreaList` import 제거 후 미사용 참조가 없는지, `lowBudgetOriginal` 제거 후 다른 참조가 없는지 확인한다.

- [ ] **Step 9: 커밋**

```bash
git add src/app/s/\[id\]/adjust/page.tsx
git commit -m "$(cat <<'EOF'
변경: 조율하기 결정 화면을 diff 카드 + 공용 미리보기로 정리

우선순위 그리드/비활성 예산 슬라이더 카드를 삭제하고(이미 diff 카드가
변경 내역을 다 보여줌), 미리보기를 GroupedAreaList에서 편집 화면과
같은 AdjustAreaPreviewList로 통일한다. 액션 버튼 라벨도 다듬는다.
EOF
)"
```

---

### Task 4: End-to-End 검증

**Files:** 없음(코드 변경 없음, 실행 확인만)

**Interfaces:**
- Consumes: Task 1~3 전체.
- Produces: 없음.

- [ ] **Step 1: dev 서버 확인**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000` (200이 아니면 `npm run dev`로 새로 띄운다 — 이미 떠 있는 인스턴스가 있는지 먼저 `lsof -i :3000`으로 확인).

- [ ] **Step 2: 편집 화면(1) 확인 (Playwright MCP)**

두 참여자로 세션을 만들고(온보딩 완료), `/s/[id]/adjust`로 이동해 확인:
- "통근 상한 조정" 카드가 "예산 상한 조정" 카드와 같은 스타일로 보이는지
- 본인 role의 통근 슬라이더만 움직일 수 있고(상대는 반투명), 슬라이더를 올리면 아래 "우리가 함께 할 수 있는 동네 미리보기" 곳 수가 실제로 늘어나는지(이게 이번 작업의 핵심 검증 포인트 — Task 1의 +30분 슬랙이 실제로 프론트까지 이어지는지)
- CTA 버튼이 항상 "총 N곳 제안하고 동네 보러 가기" 형태인지(0곳이어도 조건부 문구로 안 바뀌는지)
- 콘솔 에러 없는지 (`mcp__plugin_playwright_playwright__browser_console_messages`)

- [ ] **Step 3: 결정 화면(3) 확인**

한쪽 참여자가 통근 상한을 올려 제안(`suggest()`)한 뒤, 상대방 세션에서 같은 `/adjust` 페이지에 접속해 확인:
- 상단 diff 카드에 "통근 상한" 행이 아이콘과 함께 보이는지, old→new 값이 맞는지
- "총 N곳 → 총 M곳" 결과 변화 행이 강조된 pill로 보이는지
- 우선순위 그리드/비활성 예산 슬라이더 카드가 더 이상 안 보이는지
- 미리보기 리스트가 `AdjustAreaPreviewList` 스타일(시군구당 카드, "N곳 더보기")로 보이는지
- 버튼이 "다시 조율하기"/"이 조건 수락하기"로 보이는지
- "이 조건 수락하기"를 눌렀을 때 실제로 결과 화면으로 이동하고, DB에 `commute_max_min`이 반영됐는지(제안자 쪽 participants row 확인)

Expected: 위 항목 전부 통과. 실패 항목이 있으면 해당 태스크로 돌아가 수정 후 재확인한다.

---

## 실행 순서 요약

Task 1(DB) → Task 2(편집 화면) → Task 3(결정 화면) → Task 4(E2E 검증). Task 2는 Task 1의 응답 형태를 전제하므로 반드시 그 뒤에 온다. Task 3은 Task 2가 바꾼 `countMatches` 시그니처와 `buildChanges` 확장을 그대로 쓰므로 Task 2 이후에 온다.
