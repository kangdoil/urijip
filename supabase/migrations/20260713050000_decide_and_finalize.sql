-- =============================================================
-- decide_proposal 수락 시 세션을 'resolved'로 확정한다.
-- 흐름: A가 제안 → B가 (자기 조건도 같이 조정하고) 결정하기 → 세션 확정.
-- 확정된 세션은 /s/[id]/result 화면(지도)에서 최종 동네 리스트를 보여준다.
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
        insert into public.participant_conditions (participant_id, condition_code, tier)
        values (prop.proposer_id, key, val #>> '{}')
        on conflict (participant_id, condition_code) do update set tier = excluded.tier;
      elsif key = 'budget_max_krw' then
        update public.participants set budget_max_krw = (val #>> '{}')::bigint
        where id = prop.proposer_id;
      end if;
    end loop;

    update public.proposals set status = 'accepted', decided_at = now() where id = pid;
    update public.sessions set status = 'resolved' where id = prop.session_id;
  else
    update public.proposals set status = 'rejected', decided_at = now() where id = pid;
  end if;
end $$;
