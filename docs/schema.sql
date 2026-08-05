-- =============================================================
-- 우리집 · 신혼부부 주거 조건 조율 서비스 · Supabase 스키마 (v0.4)
-- 실행: Supabase SQL Editor 또는 supabase db push
-- 전제: Anonymous Auth 활성화 (B는 가입 없이 참여)
-- 대응 문서: PRD-우리집_v2.md
--
-- v0.4 갱신 배경: 이 파일(v0.3)은 2026-07-18까지의 상태만 반영했고, 이후
-- supabase/migrations/의 20260720000000 ~ 20260726000000 변경분(우선순위
-- 랭킹 모델 전환, 완화 사다리, 연식/평형 판정 비율화 등)이 누락돼 있었다.
-- 이 버전은 로컬에 마이그레이션 38개를 전부 재생(replay)한 뒤 pg_dump로
-- 얻은 실제 최종 상태를 기준으로 재작성했다 — 마이그레이션 파일 하나하나를
-- 손으로 추적한 것이 아니라 기계적으로 검증한 결과다.
--
-- **가장 중요한 모델 변경**: "필수/선호 분리 필터링"(tier: must/nice/skip,
-- 필수 인당 2개 제한 트리거)은 20260721020000_priority_ranking.sql에서
-- 완전히 폐기됐다. 지금은 "1~3순위 랭킹" 모델이다 — 하드필터는 각자의
-- 1순위 조건 하나뿐이고, 나머지는 정렬 가중치로만 쓰인다. 상세는 4장 참조.
-- =============================================================

-- -------------------------------------------------------------
-- 1. 세션: A가 생성, B가 초대 코드로 참여
-- -------------------------------------------------------------
create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  invite_code text not null unique default substr(md5(random()::text), 1, 6),
  status      text not null default 'waiting'
              check (status in ('waiting', 'ready', 'resolved')),
  created_at  timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 2. 참여자: 세션당 최대 2명 (A/B)
--    completed_at 이 채워져야 "입력 완료" 상태.
--    commute_batch_done_at: 통근시간 배치(ODsay, 구역 수만큼 순차 호출)가
--    백그라운드로 넘어간 뒤 처음 끝난 시각. null이면 "아직 계산 중"인데,
--    이걸 매칭 0건과 혼동하면 사용자가 서비스 고장으로 오해해 이탈한다.
--    confirmed_at/saved_area_codes: 결과 화면 "확정" 클릭 시 채워진다.
--    PRD가 애초에 그렸던 별도 confirmations 테이블(세션당 2행 누적) 대신,
--    participants 테이블에 컬럼으로 직접 얹는 방식으로 구현됐다 — 이미
--    participants_select/participants_update RLS가 "본인 행은 항상,
--    상대 행은 ready 후"를 보장하므로 새 테이블·새 RLS가 필요 없었다.
-- -------------------------------------------------------------
create table public.participants (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.sessions(id) on delete cascade,
  user_id               uuid not null references auth.users(id),
  role                  text not null check (role in ('A', 'B')),
  display_name          text,
  anchor_label          text,                                  -- 예: '판교역 테크노밸리'
  anchor_lat            double precision,
  anchor_lng            double precision,
  transport_mode        text check (transport_mode in ('transit', 'car')),
  commute_max_min       int  check (commute_max_min between 10 and 120),
  budget_max_krw        bigint,                                -- 원 단위 상한
  completed_at          timestamptz,                           -- null = 입력 미완료
  created_at            timestamptz not null default now(),
  commute_batch_done_at timestamptz,                           -- null = 통근 배치 미완료
  confirmed_at          timestamptz,                           -- 본인 확정 시각
  saved_area_codes      text[],                                -- 확정 시점 구역 코드 목록
  unique (session_id, role),
  unique (session_id, user_id)
);

comment on column public.participants.commute_batch_done_at is
  '이 참여자 거점 기준 통근시간 배치(전 구역)가 한 번이라도 끝난 시각. null이면
   아직 계산 중이거나 시도된 적 없음 — 매칭 결과 0건과 구분하는 용도.';

-- -------------------------------------------------------------
-- 3. 조건 마스터 (정적 시드 데이터)
--    통근시간·예산은 상한 입력값이라 participants에 직접 저장(위 참조).
--    여기엔 "랭킹형"(1~3순위 대상) 3개만 둔다.
-- -------------------------------------------------------------
create table public.conditions (
  code       text primary key,          -- 예: 'area_size', 'build_year'
  name       text not null,             -- 예: '평형'
  descr      text,
  sort_order int not null default 0
);

insert into public.conditions (code, name, descr, sort_order) values
  ('area_size',  '평형',   '전용 59㎡ 이상 매물이 많은 곳',      1),
  ('build_year', '연식',   '지어진 지 10년 이내 매물이 많은 곳', 2),
  ('infra',      '인프라', '마트·병원·공원이 가까운 곳',         3);

-- -------------------------------------------------------------
-- 4. 참여자별 조건 순위 (1~3위 랭킹 모델, v0.4 전면 교체)
--
--    이전(v0.3): tier text check(tier in ('must','nice','skip')),
--                필수 인당 최대 2개 트리거(enforce_must_limit)로 강제.
--    현재(v0.4): priority int(1~3), 3개 조건 전부를 순위로 배치(드래그 UI).
--
--    하드필터는 "1순위로 지정한 조건 하나"뿐이다 (_priority_hard_ok,
--    min_priority=1) — 2·3순위는 탈락 기준이 아니라 정렬 가중치로만 반영된다
--    (_priority_score). "필수 인당 2개 제한"이라는 개념 자체가 없어졌다.
--
--    unique(participant_id, priority)는 deferrable — apply_concession()이
--    한 트랜잭션 안에서 2순위/3순위를 맞바꿀 때 커밋 시점까지 유일성 검사를
--    미뤄야 하기 때문 (중간에 잠깐 값이 겹쳐도 허용).
-- -------------------------------------------------------------
create table public.participant_conditions (
  participant_id uuid not null references public.participants(id) on delete cascade,
  condition_code text not null references public.conditions(code),
  priority       int  not null check (priority between 1 and 3),
  primary key (participant_id, condition_code),
  constraint participant_conditions_priority_unique
    unique (participant_id, priority) deferrable initially deferred
);

comment on column public.participant_conditions.priority is
  '참여자별 1~3위 순위(1=가장 중요). 더 이상 하드 필터가 아니라 결과 정렬
   가중치로만 쓰인다.';

-- -------------------------------------------------------------
-- 5. 구역 프리셋 (행정동 단위, 배치로 시드/갱신)
-- -------------------------------------------------------------
create table public.areas (
  code    text primary key,             -- 행정동 코드
  name    text not null,                -- 예: '초월읍'
  sigungu text not null,                -- 예: '경기 광주시'
  lat     double precision not null,    -- 대표 좌표 (통근 계산 기준점)
  lng     double precision not null
);

-- 구역별 통계 (국토부/공공 API 배치 집계 결과, 비정규화 단일 테이블)
-- 인프라는 마트·병원·공원 개별 충족 여부로 저장하고,
-- "2개 이상 충족" 판정은 조회 쿼리에서 계산한다 (기준 변경에 유연하도록).
--
-- size_59_ok / build_year_ok: v0.4에서 추가된 "매칭 판정 전용" 불리언.
-- built_year_avg(평균)는 공유 결과 페이지 표시용으로만 남아 있고, 실제
-- 매칭(area_size/build_year 조건 충족 여부)은 아래 두 컬럼의 비율 기반
-- 판정을 쓴다 — refresh-trade-stats.ts 배치가 채운다.
create table public.area_stats (
  area_code         text primary key references public.areas(code),
  avg_price_krw     bigint,              -- 최근 6개월 실거래 평균 (예산, 공유 카드 표시용)
  built_year_avg    int,                 -- 연식 평균 (공유 카드 표시용, 매칭 판정에는 미사용)
  mart_ok           boolean,             -- 대형마트 차량 10분 이내
  hospital_ok       boolean,             -- 종합병원 차량 20분 이내
  park_ok           boolean,             -- 도보 10분 내 공원
  refreshed_at      timestamptz not null default now(),
  size_59_ok        boolean,             -- 최근 6개월 실거래 중 전용 59㎡ 이상 비중 50%+ (평형 판정용)
  build_year_ok     boolean              -- 최근 6개월 실거래 중 10년 이내 준공 비중 30%+ (연식 판정용)
);

comment on column public.area_stats.size_59_ok is
  '최근 6개월 실거래 중 전용 59㎡ 이상 비중이 과반(50%) 이상인가 (평형 조건 판정용)';
comment on column public.area_stats.build_year_ok is
  '최근 6개월 실거래 중 10년 이내 준공 비중이 30% 이상이면 true.
   built_year_avg(평균, 공유 결과 페이지 표시용)와 달리 매칭 판정 전용
   — refresh-trade-stats.ts가 채운다.';

-- -------------------------------------------------------------
-- 6. 통근시간 캐시: (출발 거점, 구역, 수단) 쌍 재사용
--    origin_key = 좌표를 소수 3자리로 반올림한 문자열 (약 100m 격자)
--    통근시간 API를 호출하기 전 반드시 이 테이블을 먼저 조회해야 한다
--    (CLAUDE.md 절대 규칙).
-- -------------------------------------------------------------
create table public.commute_cache (
  origin_key  text not null,            -- 예: '37.395,127.111'
  area_code   text not null references public.areas(code),
  mode        text not null check (mode in ('transit', 'car')),
  minutes     int  not null,
  computed_at timestamptz not null default now(),
  primary key (origin_key, area_code, mode)
);

-- -------------------------------------------------------------
-- 7. 조율 제안: 기준 변경은 제안 → 상대 동의로만 적용
-- -------------------------------------------------------------
create table public.proposals (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  proposer_id uuid not null references public.participants(id),
  payload     jsonb not null,           -- 예: {"build_year":2,"budget_max_krw":550000000}
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- -------------------------------------------------------------
-- 8. 결과 공유
--    결과 화면에서 생성한 공유 카드. include_budget로 민감 정보
--    노출 여부를 사용자가 토글 (기본값 false = 예산 비공개).
--    share_slug는 공유 카드 열람용 공개 링크의 키.
-- -------------------------------------------------------------
create table public.result_shares (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  created_by     uuid not null references public.participants(id),
  share_slug     text not null unique default substr(md5(random()::text), 1, 8),
  area_codes     text[] not null,        -- 카드에 담을 구역 코드 (최대 3~5곳)
  include_budget boolean not null default false,
  view_count     int not null default 0,
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 9. 구역 제외/복구
--    결과 화면에서 뺀 구역을 세션 공유 상태로 둔다 — 한쪽이 제외하면
--    즉시 상대방 화면에도 반영, 두 사람 모두 언제든 복구 가능.
--    이력 보존을 위해 소프트 삭제(restored_at) 방식.
-- -------------------------------------------------------------
create table public.area_exclusions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  area_code   text not null references public.areas(code),
  excluded_by uuid not null references public.participants(id),
  excluded_at timestamptz not null default now(),
  restored_by uuid references public.participants(id),
  restored_at timestamptz
);

-- "현재 제외 중" 상태는 (session_id, area_code)당 최대 1행만 허용한다.
create unique index area_exclusions_active_idx
  on public.area_exclusions (session_id, area_code)
  where restored_at is null;

-- -------------------------------------------------------------
-- 10. 구역 추천 제안 (v0.4 신설)
--     결과 후보에 없는 구역을 사용자가 직접 언급하는 짧은 자유 서술
--     피드백 채널. select 정책 없음 — 조회는 서비스 롤/스튜디오에서만.
-- -------------------------------------------------------------
create table public.area_suggestions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  message        text not null check (char_length(trim(message)) between 1 and 200),
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 11. 결과 피드백 (v0.4 신설, PRD §8)
--     "이 결과가 도움이 됐나요?" 1탭 반응(up/down) + down일 때만 서술형
--     코멘트. 참여자당 1회만 남기도록 unique 제약이 최종 방어선이다
--     (재노출 방지 자체는 클라이언트가 "이미 남겼는지" 조회해서 판단 —
--     UI 검증은 UX용, DB 제약은 정합성용이라는 CLAUDE.md 원칙과 동일).
-- -------------------------------------------------------------
create table public.feedback (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  reaction       text not null check (reaction in ('up', 'down')),
  comment        text,
  created_at     timestamptz not null default now(),
  unique (participant_id)
);

-- =============================================================
-- RLS 정책
-- 핵심 규칙: 상대방 데이터는 "둘 다 입력 완료" 후에만 보인다
-- =============================================================
alter table public.sessions               enable row level security;
alter table public.participants           enable row level security;
alter table public.participant_conditions enable row level security;
alter table public.conditions             enable row level security;
alter table public.areas                  enable row level security;
alter table public.area_stats             enable row level security;
alter table public.commute_cache          enable row level security;
alter table public.proposals              enable row level security;
alter table public.result_shares          enable row level security;
alter table public.area_exclusions        enable row level security;
alter table public.area_suggestions       enable row level security;
alter table public.feedback               enable row level security;

-- 헬퍼: 내가 이 세션의 참여자인가
create or replace function public.is_session_member(sid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.participants
    where session_id = sid and user_id = auth.uid()
  );
$$;

-- 헬퍼: 이 세션의 참여자 2명이 모두 입력을 완료했는가
create or replace function public.session_is_ready(sid uuid)
returns boolean language sql security definer stable as $$
  select count(*) = 2
     and count(*) filter (where completed_at is not null) = 2
  from public.participants where session_id = sid;
$$;

-- sessions: 참여자만 조회, 생성은 로그인(익명 포함) 사용자 누구나
create policy sessions_select on public.sessions
  for select using (public.is_session_member(id));
create policy sessions_insert on public.sessions
  for insert with check (auth.uid() is not null);

-- participants: 내 행은 항상, 상대 행은 세션 ready 후에만
create policy participants_select on public.participants
  for select using (
    user_id = auth.uid()
    or (public.is_session_member(session_id) and public.session_is_ready(session_id))
  );
create policy participants_insert on public.participants
  for insert with check (user_id = auth.uid());
create policy participants_update on public.participants
  for update using (user_id = auth.uid());

-- participant_conditions: 소유자 항상, 상대 것은 ready 후에만
create policy pcond_select on public.participant_conditions
  for select using (
    exists (
      select 1 from public.participants p
      where p.id = participant_id
        and (p.user_id = auth.uid()
             or (public.is_session_member(p.session_id)
                 and public.session_is_ready(p.session_id)))
    )
  );
create policy pcond_write on public.participant_conditions
  for all using (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );

-- 정적/공용 데이터: 로그인 사용자 읽기 전용 (쓰기는 service role 배치만)
create policy conditions_read on public.conditions
  for select using (auth.uid() is not null);
create policy areas_read on public.areas
  for select using (auth.uid() is not null);
create policy area_stats_read on public.area_stats
  for select using (auth.uid() is not null);
create policy commute_read on public.commute_cache
  for select using (auth.uid() is not null);

-- proposals: 세션 참여자 조회, 본인 제안 생성, 결정은 상대만
create policy proposals_select on public.proposals
  for select using (public.is_session_member(session_id));
create policy proposals_insert on public.proposals
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = proposer_id and p.user_id = auth.uid())
  );
create policy proposals_decide on public.proposals
  for update using (
    public.is_session_member(session_id)
    and not exists (select 1 from public.participants p
                    where p.id = proposer_id and p.user_id = auth.uid())
  );

-- result_shares: 세션 참여자만 직접 테이블 조회/생성.
-- 공유 링크를 받은 외부 열람자(비로그인 지인 등)는 테이블에 직접 접근하지 않고
-- get_shared_result(slug) RPC로만 열람한다.
create policy shares_select on public.result_shares
  for select using (public.is_session_member(session_id));
create policy shares_insert on public.result_shares
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = created_by and p.user_id = auth.uid())
  );

-- area_exclusions: 세션 참여자 조회, 본인 이름으로만 제외 생성,
-- 복구는 제외한 사람이 아니어도 세션 참여자 누구나 가능.
create policy area_exclusions_select on public.area_exclusions
  for select using (public.is_session_member(session_id));
create policy area_exclusions_insert on public.area_exclusions
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = excluded_by and p.user_id = auth.uid())
  );
create policy area_exclusions_restore on public.area_exclusions
  for update using (public.is_session_member(session_id));

-- area_suggestions: 본인 이름으로만 생성. select 정책 없음(직접 조회 불가).
create policy area_suggestions_insert on public.area_suggestions
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );

-- feedback: 본인 것만 생성/조회/수정
create policy feedback_insert on public.feedback
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );
create policy feedback_select on public.feedback
  for select using (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );
create policy feedback_update on public.feedback
  for update using (
    exists (select 1 from public.participants p
            where p.id = participant_id and p.user_id = auth.uid())
  );

-- =============================================================
-- 세션 생성/참여
-- =============================================================
create or replace function public.create_session(name text)
returns jsonb language plpgsql security definer as $$
declare
  new_session record;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요';
  end if;

  insert into public.sessions default values
  returning id, invite_code into new_session;

  insert into public.participants (session_id, user_id, role, display_name)
  values (new_session.id, auth.uid(), 'A', name);

  return jsonb_build_object('id', new_session.id, 'invite_code', new_session.invite_code);
end $$;

-- 초대 코드로 참여 (invite_code는 세션 조회 정책을 우회해야 하므로
-- security definer RPC로만 노출)
create or replace function public.join_session(code text, name text default null)
returns uuid language plpgsql security definer as $$
declare
  sid uuid;
  cnt int;
begin
  select id into sid from public.sessions where invite_code = code;
  if sid is null then
    raise exception '유효하지 않은 초대 코드예요';
  end if;

  select count(*) into cnt from public.participants where session_id = sid;
  if cnt >= 2 and not public.is_session_member(sid) then
    raise exception '이미 두 명이 참여한 세션이에요';
  end if;

  insert into public.participants (session_id, user_id, role, display_name)
  values (sid, auth.uid(), 'B', name)
  on conflict (session_id, user_id) do nothing;

  return sid;
end $$;

-- 초대 링크 열람 미리보기 (초대자 이름 + 세션 상태만, 참여 전에도 조회 가능)
create or replace function public.get_invite_preview(code text)
returns jsonb language sql security definer stable as $$
  select jsonb_build_object(
    'inviter_name', (
      select p.display_name from public.participants p
      where p.session_id = s.id and p.role = 'A'
    ),
    'status', s.status
  )
  from public.sessions s
  where s.invite_code = code;
$$;

-- 두 사람 온보딩/통근 배치 진행 상태 (presence 배지, 부재중 변경 요약용)
create or replace function public.get_session_presence(sid uuid)
returns jsonb language plpgsql security definer stable as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  return (
    select jsonb_build_object(
      'participant_count', count(*),
      'roles', coalesce(jsonb_agg(role order by role), '[]'::jsonb),
      'participants', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', role, 'display_name', display_name, 'completed_at', completed_at
          ) order by role
        ), '[]'::jsonb
      )
    )
    from public.participants
    where session_id = sid
  );
end $$;

-- 통근시간 배치(ODsay) 완료 여부. commute_batch_done_at=null을
-- "매칭 0건"으로 오인하지 않도록 결과/조율 화면이 먼저 조회한다.
create or replace function public.get_commute_status(sid uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  a_p record;
  b_p record;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  return jsonb_build_object(
    'a_ready', a_p.commute_batch_done_at is not null,
    'b_ready', b_p.commute_batch_done_at is not null
  );
end $$;

-- =============================================================
-- 매칭 엔진 — 우선순위 랭킹 모델
--
-- satisfied jsonb 구조 (모든 매칭 함수 공통):
--   { 'area_size':  size_59_ok,
--     'build_year': build_year_ok,
--     'infra':      마트/병원/공원 3개 중 2개 이상 }
--
-- _priority_score: weight(priority) = 4 - priority (1위=3점,2위=2점,3위=1점)
--   satisfied한 조건들의 weight 합. get_matches 최종 정렬은
--   priority_score(A) + priority_score(B) desc, (a_minutes+b_minutes) asc.
--
-- _priority_hard_ok: 1순위로 지정한 조건 하나만 하드필터(AND). 통근시간·
--   예산은 이 함수와 별개로 항상 하드필터(_session_candidates/get_matches
--   본문에서 직접 처리).
-- =============================================================

-- 세션의 통근/예산 상한을 만족하는 후보 + satisfied 계산 (get_matches가 사용)
create or replace function public._session_candidates(sid uuid)
returns table(code text, name text, sigungu text, avg_price_krw bigint,
              a_minutes int, b_minutes int, lat double precision, lng double precision,
              satisfied jsonb)
language plpgsql stable security definer as $$
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
      'build_year', coalesce(st.build_year_ok, false),
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
  where ca.minutes <= a_p.commute_max_min
    and cb.minutes <= b_p.commute_max_min;
end $$;

-- 조율 화면(⑥) 실시간 미리보기용 — 통근 상한을 +30분 넉넉하게 잡아
-- "조건을 이렇게 풀면 후보가 몇 곳 느는지"를 보여줄 재료로 쓴다.
create or replace function public._adjust_candidates(sid uuid)
returns table(code text, name text, sigungu text, avg_price_krw bigint,
              a_minutes int, b_minutes int, lat double precision, lng double precision,
              satisfied jsonb)
language plpgsql stable security definer as $$
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
      'build_year', coalesce(st.build_year_ok, false),
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

create or replace function public._priority_score(pid uuid, satisfied jsonb)
returns int language sql stable as $$
  select coalesce(sum(4 - pc.priority), 0)::int
  from public.participant_conditions pc
  where pc.participant_id = pid
    and coalesce((satisfied ->> pc.condition_code)::boolean, false);
$$;

create or replace function public._priority_hard_ok(pid uuid, satisfied jsonb, min_priority int default 1)
returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority <= min_priority
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;

-- 완화 사다리(_concession_condition_stats)가 "이 조건 하나를 뺐을 때"를
-- 계산할 때 쓰는 변형 — 1·2순위 조건 중 excluded_code만 하드필터에서 뺀다.
create or replace function public._priority_hard_ok_except(pid uuid, satisfied jsonb, excluded_code text)
returns boolean language sql stable as $$
  select not exists (
    select 1 from public.participant_conditions pc
    where pc.participant_id = pid
      and pc.priority in (1, 2)
      and pc.condition_code <> excluded_code
      and not coalesce((satisfied ->> pc.condition_code)::boolean, false)
  )
$$;

-- 결과 화면(⑤) 메인 RPC. 반환 jsonb:
--   { ready, priorities: {a:[...], b:[...]}, budget: {...},
--     candidate_count, match_count, matches: [{code,name,sigungu,
--     avg_price_krw,a_minutes,b_minutes,lat,lng,satisfied}, ...] }
-- 정렬: priority_score(a)+priority_score(b) desc, (a_minutes+b_minutes) asc
create or replace function public.get_matches(sid uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  a_p record;
  b_p record;
  low_budget bigint;
  result jsonb;
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

  low_budget := least(a_p.budget_max_krw, b_p.budget_max_krw);

  with cand as (
    select * from public._session_candidates(sid) c
    where a_p.budget_max_krw is null or c.avg_price_krw <= low_budget
  ),
  passed as (
    select c.* from cand c
    where public._priority_hard_ok(a_p.id, c.satisfied, 1)
      and public._priority_hard_ok(b_p.id, c.satisfied, 1)
  )
  select jsonb_build_object(
    'ready', true,
    'priorities', jsonb_build_object(
      'a', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
            from public.participant_conditions where participant_id = a_p.id),
      'b', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
            from public.participant_conditions where participant_id = b_p.id)
    ),
    'budget', jsonb_build_object(
      'a_budget_krw', a_p.budget_max_krw,
      'b_budget_krw', b_p.budget_max_krw,
      'applied_krw', low_budget,
      'conflict', a_p.budget_max_krw is distinct from b_p.budget_max_krw
    ),
    'candidate_count', (select count(*) from cand),
    'match_count', (select count(*) from passed),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'sigungu', p.sigungu,
        'avg_price_krw', p.avg_price_krw,
        'a_minutes', p.a_minutes, 'b_minutes', p.b_minutes,
        'lat', p.lat, 'lng', p.lng,
        'satisfied', p.satisfied
      ) order by
        public._priority_score(a_p.id, p.satisfied) + public._priority_score(b_p.id, p.satisfied) desc,
        (p.a_minutes + p.b_minutes) asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- "먼저 둘러보기"(A 단독 미리보기, B 초대 전) — get_matches와 동일한
-- 필터/정렬 규칙을 A 한 명 기준으로만 적용한다.
create or replace function public.get_solo_preview(sid uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  a_p record;
  result jsonb;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 조회할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';

  if a_p.id is null or a_p.completed_at is null then
    raise exception '아직 본인 조건 입력을 마치지 않았어요';
  end if;

  with cand as (
    select
      ar.code, ar.name, ar.sigungu, st.avg_price_krw, ca.minutes as a_minutes,
      ar.lat, ar.lng,
      jsonb_build_object(
        'area_size', coalesce(st.size_59_ok, false),
        'build_year', coalesce(st.build_year_ok, false),
        'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
      ) as satisfied
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3)
    where ca.minutes <= a_p.commute_max_min
      and (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw)
  ),
  passed as (
    select c.* from cand c
    where public._priority_hard_ok(a_p.id, c.satisfied, 1)
  )
  select jsonb_build_object(
    'priorities', (select coalesce(jsonb_agg(condition_code order by priority), '[]'::jsonb)
                   from public.participant_conditions where participant_id = a_p.id),
    'budget_krw', a_p.budget_max_krw,
    'candidate_count', (select count(*) from cand),
    'match_count', (select count(*) from passed),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'sigungu', p.sigungu,
        'avg_price_krw', p.avg_price_krw,
        'a_minutes', p.a_minutes,
        'lat', p.lat, 'lng', p.lng,
        'satisfied', p.satisfied
      ) order by
        public._priority_score(a_p.id, p.satisfied) desc,
        p.a_minutes asc
      )
      from passed p
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- 조율 화면(⑥)이 쓰는 현재 상태 + 완화 후보 재료 묶음
create or replace function public.get_adjust_data(sid uuid)
returns jsonb language plpgsql stable security definer as $$
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

-- =============================================================
-- 조율 제안 결정 / 세션 확정·재조율
-- =============================================================
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

create or replace function public.finalize_session(sid uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 확정할 수 있어요';
  end if;
  if not public.session_is_ready(sid) then
    raise exception '아직 두 사람 모두 조건 입력을 마치지 않았어요';
  end if;

  update public.sessions set status = 'resolved' where id = sid;
end $$;

create or replace function public.reopen_session(sid uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 다시 조율할 수 있어요';
  end if;

  update public.sessions set status = 'waiting' where id = sid;
end $$;

-- =============================================================
-- 공유 카드 공개 열람
-- 로그인/세션 참여 여부와 무관하게 slug만으로 조회 가능.
-- include_budget=false면 avg_price_krw를 응답에서 제외한다.
-- area_codes가 빈 배열(=매칭 0건 상태에서 공유)이어도 "존재하지 않는 링크"로
-- 오인되지 않도록 공유 행 존재 여부와 areas 빈 배열을 구분해서 처리한다.
-- =============================================================
create or replace function public.get_shared_result(slug text)
returns jsonb language plpgsql security definer as $$
declare
  share_row record;
  result jsonb;
begin
  select * into share_row from public.result_shares where share_slug = slug;
  if share_row.id is null then
    raise exception '존재하지 않거나 만료된 공유 링크예요';
  end if;

  update public.result_shares set view_count = view_count + 1 where id = share_row.id;

  select jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.name,
        'sigungu', a.sigungu,
        'avg_price_krw', case when share_row.include_budget then st.avg_price_krw else null end,
        'built_year_avg', st.built_year_avg
      ))
      from public.areas a
      left join public.area_stats st on st.area_code = a.code
      where a.code = any(share_row.area_codes)
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- =============================================================
-- 완화 사다리 (매물 0곳 대응) — v0.4 신설
--
-- get_matches가 0건일 때, 결과 화면은 get_concession_matches를 불러
-- "무엇을 얼마나 완화하면 후보가 생기는지"를 단계별로 제시한다.
-- 새 테이블은 없다 — 전부 함수로만 구현됐다.
--
-- 사다리는 누적식 6개 진입(0~4단계, relieve_all만 순위 하드필터를 완전히
-- 해제):
--   0단계: 완화 없음 (get_matches와 동일 조건으로 재확인)
--   1단계: 통근 +5분
--   2단계: 통근 +15분
--   3단계: 통근 +15분, 예산 +8천만/+1.6억(같은 UI 단계 번호로 2회 시도)
--   4단계: 통근 +15분, 예산 +1.6억, 1순위 하드필터까지 전부 해제
-- 병목 판정(a_target/b_target)은 통근·예산 중 실패 건수가 더 많은 쪽을
-- 완화 대상으로 삼는다.
-- =============================================================

-- 한 사다리 단계의 후보 목록 + 정렬 점수 계산.
-- **invoker 권한**(security definer 아님) — 호출자(get_concession_matches
-- 등)가 이미 is_session_member를 확인했다는 전제로, RLS를 우회하는 정의자
-- 권한을 여기서 추가로 부여하지 않기 위한 의도적 선택
-- (20260723010000_concession_ladder_step_invoker_fix.sql에서 RLS 우회
-- 취약점으로 발견돼 definer → invoker로 수정됨).
create or replace function public._concession_ladder_step(
  sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint,
  min_priority_a int, min_priority_b int
)
returns jsonb language plpgsql stable as $$
declare
  a_p record;
  b_p record;
  areas_json jsonb;
  total_count bigint;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select
      ar.code, ar.name, ar.sigungu, ar.lat, ar.lng, st.avg_price_krw,
      ca.minutes as a_minutes, cb.minutes as b_minutes,
      jsonb_build_object(
        'area_size', coalesce(st.size_59_ok, false),
        'build_year', coalesce(st.build_year_ok, false),
        'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
      ) as satisfied
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = (select key from a_origin)
    join public.commute_cache cb
      on cb.area_code = ar.code and cb.mode = b_p.transport_mode
     and cb.origin_key = (select key from b_origin)
    where
      (case when a_target = 'commute' then ca.minutes <= a_p.commute_max_min + widen_min
            else ca.minutes <= a_p.commute_max_min end)
      and (case when a_target = 'budget' then (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw + widen_budget)
                else (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw) end)
      and (case when b_target = 'commute' then cb.minutes <= b_p.commute_max_min + widen_min
            else cb.minutes <= b_p.commute_max_min end)
      and (case when b_target = 'budget' then (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw + widen_budget)
                else (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw) end)
  ),
  eligible as (
    select b.* from base b
    where public._priority_hard_ok(a_p.id, b.satisfied, min_priority_a)
      and public._priority_hard_ok(b_p.id, b.satisfied, min_priority_b)
  ),
  scored as (
    select
      e.*,
      public._priority_score(a_p.id, e.satisfied) + public._priority_score(b_p.id, e.satisfied) as priority_score,
      (e.a_minutes > a_p.commute_max_min)::int
        + (a_p.budget_max_krw is not null and e.avg_price_krw > a_p.budget_max_krw)::int as a_violations,
      (e.b_minutes > b_p.commute_max_min)::int
        + (b_p.budget_max_krw is not null and e.avg_price_krw > b_p.budget_max_krw)::int as b_violations
    from eligible e
  ),
  ranked as (
    select *,
      (4 - (a_violations + b_violations)) * 10
        - abs(a_violations - b_violations)
        + priority_score as sort_score
    from scored
  )
  select
    coalesce(jsonb_agg(x.obj order by x.rnk) filter (where x.rnk <= 10), '[]'::jsonb),
    count(*)
  into areas_json, total_count
  from (
    select
      jsonb_build_object(
        'code', r.code, 'name', r.name, 'sigungu', r.sigungu, 'lat', r.lat, 'lng', r.lng,
        'avg_price_krw', r.avg_price_krw, 'a_minutes', r.a_minutes, 'b_minutes', r.b_minutes,
        'satisfied', r.satisfied, 'a_violations', r.a_violations, 'b_violations', r.b_violations
      ) as obj,
      row_number() over (order by r.sort_score desc, (r.a_minutes + r.b_minutes) asc) as rnk
    from ranked r
  ) x;

  return jsonb_build_object('areas', areas_json, 'total_count', coalesce(total_count, 0));
end $$;

-- 조건별 완화 임팩트("이 조건 하나만 뺐다면 후보가 몇 곳인지") 계산.
-- get_concession_matches가 매 단계마다 호출해 condition_impact를 채운다.
create or replace function public._concession_condition_stats(
  sid uuid, a_target text, b_target text, widen_min int, widen_budget bigint, relieved_code text
)
returns jsonb language plpgsql stable as $$
declare
  a_p record;
  b_p record;
  candidate_codes text[];
  code text;
  impact jsonb := '[]'::jsonb;
  cnt bigint;
  benefit_json jsonb := null;
  remaining_codes text[];
  area_tag_1 text;
  area_tag_2 text;
  cnt_tag_1 bigint;
  cnt_tag_2 bigint;
  cnt_budget bigint;
  min_budget bigint;
  tags jsonb;
begin
  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  -- A·B 중 누구든 1·2순위로 고른 조건만 후보(최대 3개: area_size/build_year/infra)
  select coalesce(array_agg(distinct pc.condition_code), '{}') into candidate_codes
  from public.participant_conditions pc
  where pc.participant_id in (a_p.id, b_p.id) and pc.priority in (1, 2);

  foreach code in array candidate_codes loop
    with a_origin as (
      select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
    ),
    b_origin as (
      select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
    ),
    base as (
      select
        jsonb_build_object(
          'area_size', coalesce(st.size_59_ok, false),
          'build_year', coalesce(st.build_year_ok, false),
          'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
        ) as satisfied,
        st.avg_price_krw
      from public.areas ar
      join public.area_stats st on st.area_code = ar.code
      join public.commute_cache ca
        on ca.area_code = ar.code and ca.mode = a_p.transport_mode
       and ca.origin_key = (select key from a_origin)
      join public.commute_cache cb
        on cb.area_code = ar.code and cb.mode = b_p.transport_mode
       and cb.origin_key = (select key from b_origin)
      where
        (case when a_target = 'commute' then ca.minutes <= a_p.commute_max_min + widen_min
              else ca.minutes <= a_p.commute_max_min end)
        and (case when a_target = 'budget' then (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw + widen_budget)
                  else (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw) end)
        and (case when b_target = 'commute' then cb.minutes <= b_p.commute_max_min + widen_min
              else cb.minutes <= b_p.commute_max_min end)
        and (case when b_target = 'budget' then (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw + widen_budget)
                  else (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw) end)
    )
    select count(*) into cnt
    from base b
    where public._priority_hard_ok_except(a_p.id, b.satisfied, code)
      and public._priority_hard_ok_except(b_p.id, b.satisfied, code);

    impact := impact || jsonb_build_object('condition_code', code, 'total_count', cnt);
  end loop;

  -- benefit: relieved_code가 있을 때만, 그 조건을 뺀 나머지 2개 조건 +
  -- 예산 여유를 같은 eligible set 기준으로 집계한다.
  -- (get_concession_matches 최신본에서는 항상 null로 호출되며, 조건 하나를
  -- 짚어 완화하는 사다리 rung이 20260725040000에서 폐기됐기 때문에 이
  -- 분기는 현재 도달하지 않는다 — JSON 형태 호환을 위해 남겨둔다.)
  if relieved_code is not null then
    select array_agg(t.code order by t.ord) into remaining_codes
    from unnest(array['area_size', 'build_year', 'infra']) with ordinality as t(code, ord)
    where t.code <> relieved_code;
    area_tag_1 := remaining_codes[1];
    area_tag_2 := remaining_codes[2];
    min_budget := least(coalesce(a_p.budget_max_krw, 9223372036854775807), coalesce(b_p.budget_max_krw, 9223372036854775807));

    with a_origin as (
      select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
    ),
    b_origin as (
      select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
    ),
    base as (
      select
        jsonb_build_object(
          'area_size', coalesce(st.size_59_ok, false),
          'build_year', coalesce(st.build_year_ok, false),
          'infra', ((st.mart_ok::int + st.hospital_ok::int + st.park_ok::int) >= 2)
        ) as satisfied,
        st.avg_price_krw
      from public.areas ar
      join public.area_stats st on st.area_code = ar.code
      join public.commute_cache ca
        on ca.area_code = ar.code and ca.mode = a_p.transport_mode
       and ca.origin_key = (select key from a_origin)
      join public.commute_cache cb
        on cb.area_code = ar.code and cb.mode = b_p.transport_mode
       and cb.origin_key = (select key from b_origin)
      where
        (case when a_target = 'commute' then ca.minutes <= a_p.commute_max_min + widen_min
              else ca.minutes <= a_p.commute_max_min end)
        and (case when a_target = 'budget' then (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw + widen_budget)
                  else (a_p.budget_max_krw is null or st.avg_price_krw <= a_p.budget_max_krw) end)
        and (case when b_target = 'commute' then cb.minutes <= b_p.commute_max_min + widen_min
              else cb.minutes <= b_p.commute_max_min end)
        and (case when b_target = 'budget' then (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw + widen_budget)
                  else (b_p.budget_max_krw is null or st.avg_price_krw <= b_p.budget_max_krw) end)
    ),
    eligible as (
      select b.* from base b
      where public._priority_hard_ok_except(a_p.id, b.satisfied, relieved_code)
        and public._priority_hard_ok_except(b_p.id, b.satisfied, relieved_code)
    )
    select
      count(*) filter (where (satisfied ->> area_tag_1)::boolean),
      count(*) filter (where (satisfied ->> area_tag_2)::boolean),
      count(*) filter (where avg_price_krw is not null and avg_price_krw <= min_budget * 0.9)
    into cnt_tag_1, cnt_tag_2, cnt_budget
    from eligible;

    tags := '[]'::jsonb;
    if cnt_tag_1 > 0 then
      tags := tags || jsonb_build_object('code', area_tag_1, 'count', cnt_tag_1);
    end if;
    if cnt_tag_2 > 0 then
      tags := tags || jsonb_build_object('code', area_tag_2, 'count', cnt_tag_2);
    end if;
    if cnt_budget > 0 and a_p.budget_max_krw is not null and b_p.budget_max_krw is not null then
      tags := tags || jsonb_build_object('code', 'budget', 'count', cnt_budget);
    end if;

    if jsonb_array_length(tags) > 0 then
      benefit_json := jsonb_build_object('condition_code', relieved_code, 'tags', tags);
    end if;
  end if;

  return jsonb_build_object('condition_impact', impact, 'benefit', benefit_json);
end $$;

-- 결과 화면 폴백 진입점. 사다리를 0단계부터 순서대로 시도해 처음으로
-- 후보가 1건 이상 나오는 단계를 main으로 반환하고, main이 3건 미만이면
-- 그다음 단계 결과 중 main과 겹치지 않는 것만 extra로 얹어 보여준다.
create or replace function public.get_concession_matches(sid uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  a_p record;
  b_p record;

  a_commute_fail bigint;
  a_budget_fail bigint;
  b_commute_fail bigint;
  b_budget_fail bigint;
  a_target text;
  b_target text;

  steps jsonb;
  step_count int;
  i int;
  step jsonb;
  step_min_priority int;
  step_result jsonb;
  next_step jsonb;
  next_min_priority int;
  next_result jsonb;

  main jsonb;
  extra jsonb;
  main_codes text[];
  extra_areas jsonb;
  extra_total bigint;

  stats_result jsonb;

  result jsonb;
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

  -- 병목 판정: 통근·예산 중 실패 건수가 더 많은 쪽을 완화 대상으로 삼는다.
  with a_origin as (
    select round(a_p.anchor_lat::numeric, 3) || ',' || round(a_p.anchor_lng::numeric, 3) as key
  ),
  b_origin as (
    select round(b_p.anchor_lat::numeric, 3) || ',' || round(b_p.anchor_lng::numeric, 3) as key
  ),
  base as (
    select ar.code, st.avg_price_krw, ca.minutes as a_minutes, cb.minutes as b_minutes
    from public.areas ar
    join public.area_stats st on st.area_code = ar.code
    join public.commute_cache ca
      on ca.area_code = ar.code and ca.mode = a_p.transport_mode
     and ca.origin_key = (select key from a_origin)
    join public.commute_cache cb
      on cb.area_code = ar.code and cb.mode = b_p.transport_mode
     and cb.origin_key = (select key from b_origin)
  )
  select
    count(*) filter (where a_minutes > a_p.commute_max_min),
    count(*) filter (where a_p.budget_max_krw is not null and avg_price_krw > a_p.budget_max_krw),
    count(*) filter (where b_minutes > b_p.commute_max_min),
    count(*) filter (where b_p.budget_max_krw is not null and avg_price_krw > b_p.budget_max_krw)
  into a_commute_fail, a_budget_fail, b_commute_fail, b_budget_fail
  from base;

  a_target := case
    when a_commute_fail = 0 and a_budget_fail = 0 then null
    when a_commute_fail >= a_budget_fail then 'commute'
    else 'budget'
  end;
  b_target := case
    when b_commute_fail = 0 and b_budget_fail = 0 then null
    when b_commute_fail >= b_budget_fail then 'commute'
    else 'budget'
  end;

  -- 사다리 단계 정의(누적식, 6개). relieve_all만 순위 하드필터를 완전히
  -- 푼다 — 그 외엔 전부 get_matches와 같은 min_priority=1.
  steps := jsonb_build_array(
    jsonb_build_object('step', 0, 'commute_widen', 0,  'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 1, 'commute_widen', 5,  'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 2, 'commute_widen', 15, 'budget_widen', 0,         'relieve_all', false),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 80000000,  'relieve_all', false),
    jsonb_build_object('step', 3, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve_all', false),
    jsonb_build_object('step', 4, 'commute_widen', 15, 'budget_widen', 160000000, 'relieve_all', true)
  );
  step_count := jsonb_array_length(steps);

  main := null;
  extra := null;

  for i in 0..step_count - 1 loop
    step := steps -> i;
    step_min_priority := case when coalesce((step ->> 'relieve_all')::boolean, false) then 0 else 1 end;
    step_result := public._concession_ladder_step(
      sid, a_target, b_target,
      (step ->> 'commute_widen')::int,
      (step ->> 'budget_widen')::bigint,
      step_min_priority,
      step_min_priority
    );

    if (step_result ->> 'total_count')::bigint >= 1 then
      main := jsonb_build_object(
        'ladder_step', (step ->> 'step')::int,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', step_result -> 'areas',
        'total_count', step_result -> 'total_count'
      );

      stats_result := public._concession_condition_stats(
        sid, a_target, b_target,
        (step ->> 'commute_widen')::int,
        (step ->> 'budget_widen')::bigint,
        null
      );

      main := main || jsonb_build_object(
        'condition_impact', stats_result -> 'condition_impact',
        'benefit', stats_result -> 'benefit'
      );

      if (step_result ->> 'total_count')::bigint < 3 and i + 1 < step_count then
        next_step := steps -> (i + 1);
        next_min_priority := case when coalesce((next_step ->> 'relieve_all')::boolean, false) then 0 else 1 end;
        next_result := public._concession_ladder_step(
          sid, a_target, b_target,
          (next_step ->> 'commute_widen')::int,
          (next_step ->> 'budget_widen')::bigint,
          next_min_priority,
          next_min_priority
        );

        select coalesce(array_agg(a ->> 'code'), '{}') into main_codes
        from jsonb_array_elements(main -> 'areas') a;

        select coalesce(jsonb_agg(a), '[]'::jsonb) into extra_areas
        from jsonb_array_elements(next_result -> 'areas') a
        where not (a ->> 'code' = any(main_codes));

        extra_total := (next_result ->> 'total_count')::bigint - (main ->> 'total_count')::bigint;

        extra := jsonb_build_object(
          'ladder_step', (next_step ->> 'step')::int,
          'give', jsonb_build_object(
            'a', jsonb_build_object(
              'commute_widen_min', case when a_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when a_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', null,
              'relieved_all', next_min_priority = 0
            ),
            'b', jsonb_build_object(
              'commute_widen_min', case when b_target = 'commute' then (next_step ->> 'commute_widen')::int else 0 end,
              'budget_widen_krw', case when b_target = 'budget' then (next_step ->> 'budget_widen')::bigint else 0 end,
              'relieved_condition', null,
              'relieved_all', next_min_priority = 0
            )
          ),
          'areas', extra_areas,
          'total_count', extra_total
        );
      end if;

      exit;
    end if;

    if i = step_count - 1 then
      main := jsonb_build_object(
        'ladder_step', null,
        'give', jsonb_build_object(
          'a', jsonb_build_object(
            'commute_widen_min', case when a_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when a_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          ),
          'b', jsonb_build_object(
            'commute_widen_min', case when b_target = 'commute' then (step ->> 'commute_widen')::int else 0 end,
            'budget_widen_krw', case when b_target = 'budget' then (step ->> 'budget_widen')::bigint else 0 end,
            'relieved_condition', null,
            'relieved_all', step_min_priority = 0
          )
        ),
        'areas', '[]'::jsonb,
        'total_count', 0,
        'condition_impact', '[]'::jsonb,
        'benefit', null
      );
    end if;
  end loop;

  result := jsonb_build_object('main', main, 'extra', extra);
  return result;
end $$;

-- get_concession_matches가 제안한 main.give를 실제로 participants에
-- 반영한다 (사용자가 "이 조건으로 볼래요"를 확정했을 때 호출).
-- relieved_condition은 get_concession_matches 최신본에서 항상 null이라
-- 아래 priority 맞바꿈 분기는 현재 도달하지 않는 죽은 코드지만, JSON 형태
-- 호환을 위해 남겨둔다.
create or replace function public.apply_concession(sid uuid)
returns void language plpgsql security definer as $$
declare
  a_p record;
  b_p record;
  cm jsonb;
  a_give jsonb;
  b_give jsonb;
begin
  if not public.is_session_member(sid) then
    raise exception '세션 참여자만 처리할 수 있어요';
  end if;

  select * into a_p from public.participants where session_id = sid and role = 'A';
  select * into b_p from public.participants where session_id = sid and role = 'B';

  if a_p.id is null or b_p.id is null then
    raise exception '아직 두 사람 모두 참여하지 않았어요';
  end if;

  cm := public.get_concession_matches(sid);
  a_give := cm -> 'main' -> 'give' -> 'a';
  b_give := cm -> 'main' -> 'give' -> 'b';

  if coalesce((a_give ->> 'commute_widen_min')::int, 0) > 0 then
    update public.participants
      set commute_max_min = commute_max_min + (a_give ->> 'commute_widen_min')::int
      where id = a_p.id;
  end if;
  if coalesce((b_give ->> 'commute_widen_min')::int, 0) > 0 then
    update public.participants
      set commute_max_min = commute_max_min + (b_give ->> 'commute_widen_min')::int
      where id = b_p.id;
  end if;

  if coalesce((a_give ->> 'budget_widen_krw')::bigint, 0) > 0 then
    update public.participants
      set budget_max_krw = coalesce(budget_max_krw, 0) + (a_give ->> 'budget_widen_krw')::bigint
      where id = a_p.id;
  end if;
  if coalesce((b_give ->> 'budget_widen_krw')::bigint, 0) > 0 then
    update public.participants
      set budget_max_krw = coalesce(budget_max_krw, 0) + (b_give ->> 'budget_widen_krw')::bigint
      where id = b_p.id;
  end if;

  -- priority 컬럼은 deferrable initially deferred라 아래 두 UPDATE가 같은
  -- 트랜잭션 안에서 잠깐 priority=3이 중복돼도 커밋 시점에만 유일성이
  -- 검사돼 안전하다.
  if a_give ->> 'relieved_condition' is not null then
    update public.participant_conditions
      set priority = 3
      where participant_id = a_p.id and priority = 2
        and condition_code = (a_give ->> 'relieved_condition');
    update public.participant_conditions
      set priority = 2
      where participant_id = a_p.id and priority = 3
        and condition_code <> (a_give ->> 'relieved_condition');
  end if;
  if b_give ->> 'relieved_condition' is not null then
    update public.participant_conditions
      set priority = 3
      where participant_id = b_p.id and priority = 2
        and condition_code = (b_give ->> 'relieved_condition');
    update public.participant_conditions
      set priority = 2
      where participant_id = b_p.id and priority = 3
        and condition_code <> (b_give ->> 'relieved_condition');
  end if;
end $$;

-- =============================================================
-- Realtime: B 입력 완료·제외/복구를 상대 화면에 실시간 반영
-- =============================================================
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.proposals;
alter publication supabase_realtime add table public.area_exclusions;
