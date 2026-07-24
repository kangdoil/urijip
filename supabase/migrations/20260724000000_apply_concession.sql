-- =============================================================
-- apply_concession: 결과 화면 콜드 스테이션 패널의 "이 조건으로 바꾸고 동네
-- 보러 가기" 버튼 전용 RPC. get_concession_matches가 이미 계산해둔
-- main.give(A/B 각자의 통근·예산 widen과 relieved_condition)를 그대로
-- participants/participant_conditions에 실제로 반영한다.
--
-- decide_proposal과 달리 propose/accept 절차를 거치지 않고 두 참여자 모두의
-- 값을 한 번에 바꾼다 — 콜드 스테이션 회복 추천은 이미 두 사람 조건을 함께
-- 고려해 계산된 균형안이라, 버튼을 누른 쪽이 즉시 적용해도 되는 지름길로
-- 설계됐다(요청사항). participants_update/pcond_write RLS는 본인 행만
-- 허용하므로(CLAUDE.md: 상대 조건은 RLS로 비공개) 상대 쪽 반영은 security
-- definer로 우회해야 한다 — is_session_member 가드로 세션 참여자만 호출
-- 가능하게 막는다(_concession_ladder_step 취약점 수정과 동일한 원칙).
-- =============================================================
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

  -- 통근 상한 widen(양수일 때만 반영 — 그 role이 병목이 아니면 항상 0).
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

  -- 예산 상한 widen(양수일 때만 반영).
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

  -- relieved_condition = 그 참여자의 2순위 조건을 3순위와 맞바꿔 하드필터
  -- (_priority_hard_ok, priority<=2)에서 빠지게 한다. priority 컬럼은
  -- deferrable initially deferred라 아래 두 UPDATE가 같은 트랜잭션 안에서
  -- 잠깐 priority=3이 중복돼도 커밋 시점에만 유일성이 검사돼 안전하다.
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

grant execute on function public.apply_concession(uuid) to authenticated;
