-- '면적이 넉넉한 곳'은 실제 판정 기준(전용 59㎡ 이상 거래 비중 과반,
-- scripts/refresh-trade-stats.ts의 size_59_ok)을 전혀 담지 못하는 문구였다.
-- 년식("지어진 지 10년 이내")·인프라("마트·병원·공원이 가까운 곳")처럼
-- 실제 기준이 드러나는 문구로 맞춘다.
update public.conditions set descr = '전용 59㎡ 이상 매물이 많은 곳' where code = 'area_size';
