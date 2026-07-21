-- 순위 매기기 UI(온보딩 conditions 페이지) 문구에 맞춰 조건 설명을 더 쉬운
-- 표현으로 다듬는다. 판정 기준(전용 59㎡ 이상 등) 자체는 area_stats 계산
-- 로직에 그대로 남아 있고, 여기서는 사용자에게 보여주는 설명 텍스트만 바꾼다.
update public.conditions set descr = '면적이 넉넉한 곳' where code = 'area_size';
update public.conditions set descr = '지어진 지 10년 이내' where code = 'build_year';
update public.conditions set descr = '마트·병원·공원이 가까운 곳' where code = 'infra';
