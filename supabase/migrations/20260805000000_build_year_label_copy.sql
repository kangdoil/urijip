-- "년식"은 표준 표기가 아닌 "연식"으로 통일한다. 조건 이름은 DB
-- conditions.name에 시드돼 있고 온보딩 조건 순위 화면(/onboard/conditions)이
-- 이 값을 그대로 렌더링하므로, 코드/문서 상의 표기만 바꿔서는 실제 화면에
-- 반영되지 않는다.
update public.conditions set name = '연식' where code = 'build_year';
