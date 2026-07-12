-- =============================================================
-- 우리집 · 신혼부부 주거 조건 조율 서비스 · Supabase 스키마 (v0.2)
-- 실행: Supabase SQL Editor 또는 supabase db push
-- 전제: Anonymous Auth 활성화 (B는 가입 없이 참여)
-- 대응 문서: PRD-우리집.md v0.4
-- =============================================================

-- -------------------------------------------------------------
-- 1. 세션: A가 생성, B가 초대 코드로 참여
--    v0.2: situation 컬럼 삭제 (신혼부부 단일 타겟, 분기 불필요)
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
--    completed_at 이 채워져야 "입력 완료" 상태
-- -------------------------------------------------------------
create table public.participants (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id),
  role            text not null check (role in ('A', 'B')),
  display_name    text,
  anchor_label    text,                                  -- 예: '판교역 테크노밸리'
  anchor_lat      double precision,
  anchor_lng      double precision,
  transport_mode  text check (transport_mode in ('transit', 'car')),
  commute_max_min int  check (commute_max_min between 10 and 120),
  budget_max_krw  bigint,                                -- 원 단위 상한
  completed_at    timestamptz,                           -- null = 입력 미완료
  created_at      timestamptz not null default now(),
  unique (session_id, role),
  unique (session_id, user_id)
);

-- -------------------------------------------------------------
-- 3. 조건 마스터 (정적 시드 데이터)
--    v0.2: 통근시간·예산은 상한 입력값이라 participants에 직접 저장(위 참조).
--    여기엔 "분류형"(필수/선호/무관 대상) 3개만 둔다.
--    가족 타겟 삭제로 family_only 컬럼 제거.
-- -------------------------------------------------------------
create table public.conditions (
  code       text primary key,          -- 예: 'area_size', 'build_year'
  name       text not null,             -- 예: '평형'
  descr      text,
  sort_order int not null default 0
);

insert into public.conditions (code, name, descr, sort_order) values
  ('area_size',  '평형',   '전용 59㎡ 이상',                          1),
  ('build_year', '년식',   '준공 10년 이내 = 신축',                   2),
  ('infra',      '인프라', '마트·병원·공원 중 2개 이상 접근성 충족',  3);

-- -------------------------------------------------------------
-- 4. 참여자별 조건 분류 (필수/선호/무관)
--    v0.2: 분류형 조건이 3개뿐이라 필수 최대 2개로 조정 (트리거로 강제)
-- -------------------------------------------------------------
create table public.participant_conditions (
  participant_id uuid not null references public.participants(id) on delete cascade,
  condition_code text not null references public.conditions(code),
  tier           text not null check (tier in ('must', 'nice', 'skip')),
  primary key (participant_id, condition_code)
);

create or replace function public.enforce_must_limit()
returns trigger language plpgsql as $$
begin
  if new.tier = 'must' and (
    select count(*) from public.participant_conditions
    where participant_id = new.participant_id
      and tier = 'must'
      and condition_code <> new.condition_code
  ) >= 2 then
    raise exception '필수 조건은 최대 2개까지 선택할 수 있어요';
  end if;
  return new;
end $$;

create trigger trg_must_limit
  before insert or update on public.participant_conditions
  for each row execute function public.enforce_must_limit();

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
-- v0.2: 역세권·대단지·학군 컬럼 삭제 (조건에서 제외됨).
-- 인프라는 마트·병원·공원 개별 충족 여부로 저장하고,
-- "2개 이상 충족" 판정은 조회 쿼리에서 계산한다 (기준 변경에 유연하도록).
create table public.area_stats (
  area_code         text primary key references public.areas(code),
  avg_price_krw     bigint,              -- 최근 6개월 실거래 평균 (예산)
  built_year_avg    int,                 -- 년식
  mart_ok           boolean,             -- 대형마트 차량 10분 이내
  hospital_ok       boolean,             -- 종합병원 차량 20분 이내
  park_ok           boolean,             -- 도보 10분 내 공원
  refreshed_at      timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 6. 통근시간 캐시: (출발 거점, 구역, 수단) 쌍 재사용
--    origin_key = 좌표를 소수 3자리로 반올림한 문자열 (약 100m 격자)
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
  payload     jsonb not null,           -- 예: {"build_year":"nice","budget_max_krw":550000000}
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- -------------------------------------------------------------
-- 8. 결과 공유 (v0.2 신설)
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
-- get_shared_result(slug) RPC로만 열람한다 (아래 참조).
create policy shares_select on public.result_shares
  for select using (public.is_session_member(session_id));
create policy shares_insert on public.result_shares
  for insert with check (
    exists (select 1 from public.participants p
            where p.id = created_by and p.user_id = auth.uid())
  );

-- =============================================================
-- 공유 카드 공개 열람 (v0.2 신설)
-- 로그인/세션 참여 여부와 무관하게 slug만으로 조회 가능.
-- include_budget=false면 avg_price_krw를 응답에서 제외한다.
-- =============================================================
create or replace function public.get_shared_result(slug text)
returns jsonb language plpgsql security definer as $$
declare
  result jsonb;
begin
  update public.result_shares set view_count = view_count + 1
  where share_slug = slug;

  select jsonb_build_object(
    'areas', jsonb_agg(
      jsonb_build_object(
        'name', a.name,
        'sigungu', a.sigungu,
        'avg_price_krw', case when rs.include_budget then st.avg_price_krw else null end,
        'built_year_avg', st.built_year_avg
      )
    )
  )
  into result
  from public.result_shares rs
  join public.areas a on a.code = any(rs.area_codes)
  left join public.area_stats st on st.area_code = a.code
  where rs.share_slug = slug
  group by rs.include_budget;

  if result is null then
    raise exception '존재하지 않거나 만료된 공유 링크예요';
  end if;

  return result;
end $$;

-- =============================================================
-- 초대 코드로 참여 (invite_code는 세션 조회 정책을 우회해야 하므로
-- security definer RPC로만 노출)
-- =============================================================
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

-- =============================================================
-- Realtime: B 입력 완료를 A 화면에 실시간 반영
-- =============================================================
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.proposals;
