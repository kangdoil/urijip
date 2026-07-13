-- get_shared_result 버그 수정: area_codes가 비어있으면(=매칭 0건 상태에서 공유)
-- inner join 결과가 0행이 되어 "존재하지 않거나 만료된 링크"로 잘못 나왔다.
-- 공유 자체는 존재하되 areas가 빈 배열인 것과, 공유가 아예 없는 것을 구분한다.
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
