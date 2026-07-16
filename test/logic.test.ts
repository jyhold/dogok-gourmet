import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapKakaoCategory,
  mapKakaoCafe,
  estimatePriceTier,
  SOLO_EXCLUDED_SUBS,
  DESSERT_MAIN,
} from '../src/lib/categories.ts';
import {
  buildCafeRow,
  buildSheetRow,
  buildCandidateRow,
  COFFEE_SHEET_HEADER,
  SHEET_HEADER,
  CANDIDATE_HEADER,
} from '../src/lib/classify.ts';
import { haversineMeters, inAllowedDistrict, inServiceArea, reachableInMode, COMPANY_COORDS } from '../src/lib/geo.ts';
import { applyFilters, boostVisited, boostRecommended, weightedPick, VISITED_BOOST } from '../src/lib/roulette.ts';
import {
  buildCandidates,
  buildDessertCandidates,
  dessertDistanceWeight,
  DESSERT_NEAR_BOOST,
  distancePrefWeight,
  accessModeWeight,
  DISTANCE_PREF_BOOST,
  ACCESS_MODE_MATCH_BOOST,
} from '../src/lib/candidates.ts';
import { isDuplicatePlace, normName, DUP_DISTANCE_M } from '../src/lib/syncDedupe.ts';
import { scanAll } from '../src/lib/kakaoScan.ts';
import { passesGate } from '../src/lib/googlePlaces.ts';
import {
  aggregate,
  toKstStamp,
  stampToDate,
  formatDetail,
  parseDetail,
  buildStatsRow,
  rowToStat,
  STATS_HEADER,
} from '../src/lib/stats.ts';
import { MOCK_STAT_ROWS } from '../src/lib/mockData.ts';
import type { Candidate } from '../src/lib/types.ts';

// ── 카테고리 매핑 (병목 7) ──
test('카카오 카테고리 매핑: 세부 우선', () => {
  assert.equal(mapKakaoCategory('음식점 > 한식 > 국밥').sub, '국밥·탕');
  assert.equal(mapKakaoCategory('음식점 > 일식 > 초밥,롤').sub, '초밥·회');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 육류,고기').sub, '고기구이');
});
// 칼국수 / 냉면·갈비탕 분리 — 규칙 순서에 민감한 조합들을 고정한다
test('카카오 매핑: 칼국수와 냉면·갈비탕이 갈린다', () => {
  assert.equal(mapKakaoCategory('음식점 > 한식 > 칼국수').sub, '칼국수');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 수제비').sub, '칼국수');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 국시').sub, '칼국수');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 냉면').sub, '냉면·갈비탕');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 면옥').sub, '냉면·갈비탕');
  // '갈비탕'은 국밥·탕('탕')과 고기구이('갈비')보다 먼저 걸려야 한다
  assert.equal(mapKakaoCategory('음식점 > 한식 > 갈비탕').sub, '냉면·갈비탕');
  // 반대로 '갈비'(갈비집)는 여전히 고기구이
  assert.equal(mapKakaoCategory('음식점 > 한식 > 육류,고기 > 갈비').sub, '고기구이');
  // 설렁탕은 그대로 국밥·탕
  assert.equal(mapKakaoCategory('음식점 > 한식 > 설렁탕').sub, '국밥·탕');
});
test('카카오 매핑: 샤브샤브 (카카오는 별도 대분류로 준다)', () => {
  // '음식점 > 샤브샤브' — 한식/일식 밑이 아니라 최상위. 예전엔 기타로 떨어져 점심 룰렛에서 통째로 빠졌다.
  assert.deepEqual(mapKakaoCategory('음식점 > 샤브샤브'), { main: '한식', sub: '샤브샤브' });
  assert.equal(mapKakaoCategory('음식점 > 샤브샤브 > 채선당').sub, '샤브샤브');
  // 상호에 '칼국수'가 붙어도 샤브샤브 우선 (규칙 순서 보장)
  assert.equal(mapKakaoCategory('음식점 > 샤브샤브 > 등촌샤브칼국수').sub, '샤브샤브');
  assert.equal(mapKakaoCategory('음식점 > 샤브샤브 > 명동칼국수샤브샤브').sub, '샤브샤브');
  // 샤브샤브는 다인 전제 → 혼밥 모드 제외
  assert.ok(SOLO_EXCLUDED_SUBS.has('샤브샤브'));
});
test("카카오 매핑: '국수'가 쌀국수·칼국수를 빼앗지 않는다", () => {
  assert.equal(mapKakaoCategory('음식점 > 아시아음식 > 쌀국수').main, '아시안');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 칼국수').sub, '칼국수');
  // 그 외 일반 국수집은 분식으로
  assert.equal(mapKakaoCategory('음식점 > 한식 > 국수').sub, '국수·우동');
});
test('카카오 매핑 실패 → 기타', () => {
  assert.equal(mapKakaoCategory('음식점 > 알수없는것').main, '기타');
  assert.equal(mapKakaoCategory('').main, '기타');
});
test('예산 추정: 국밥=가성비, 초밥=플렉스', () => {
  assert.equal(estimatePriceTier('국밥·탕'), '가성비');
  assert.equal(estimatePriceTier('초밥·회'), '플렉스');
});

// ── 지오 (병목 3·5) ──
test('하버사인: 같은 점 = 0', () => {
  assert.equal(Math.round(haversineMeters(COMPANY_COORDS, COMPANY_COORDS)), 0);
});
test('행정구역 필터: 도보는 관악구 차단', () => {
  assert.equal(inAllowedDistrict('서울 관악구 봉천동', 'walk'), false);
  assert.equal(inAllowedDistrict('서울 강남구 역삼동', 'walk'), true);
  assert.equal(inAllowedDistrict('서울 송파구 잠실동', 'taxi'), true);
  assert.equal(inAllowedDistrict('서울 송파구 잠실동', 'walk'), false);
});
test('서비스 지역 판정', () => {
  assert.equal(inServiceArea(COMPANY_COORDS), true);
  assert.equal(inServiceArea({ lat: 35.1, lng: 129.0 }), false); // 부산
});

// ── access_mode 오버라이드 (병목 5) ──
test('reachableInMode: accessMode 있으면 거리 무시, 없으면 직선거리', () => {
  // 직선 가깝지만(500m) 택시 지정 → 도보/따릉이 제외, 택시만 노출
  assert.equal(reachableInMode({ distanceM: 500, accessMode: 'taxi' }, 'walk'), false);
  assert.equal(reachableInMode({ distanceM: 500, accessMode: 'taxi' }, 'bike'), false);
  assert.equal(reachableInMode({ distanceM: 500, accessMode: 'taxi' }, 'taxi'), true);
  // accessMode 없으면 기존 직선거리 반경 (walk 1300 / taxi 5000)
  assert.equal(reachableInMode({ distanceM: 3000 }, 'walk'), false);
  assert.equal(reachableInMode({ distanceM: 3000 }, 'taxi'), true);
  // 완전 대체: 멀어도(4km) 도보 지정이면 도보 모드 노출
  assert.equal(reachableInMode({ distanceM: 4000, accessMode: 'walk' }, 'walk'), true);
});
test('buildCandidates: 택시 지정 근처 식당은 도보 제외·택시 포함', async () => {
  const walk = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'walk');
  const taxi = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'taxi');
  const inWalk = walk.candidates.some((c) => c.name === '언덕 위 감자탕');
  const inTaxi = taxi.candidates.some((c) => c.name === '언덕 위 감자탕');
  assert.equal(inWalk, false, '택시 지정 식당은 도보 모드에서 제외돼야 함');
  assert.equal(inTaxi, true, '택시 모드에서는 노출돼야 함');
});

// ── 룰렛 필터 + 추첨 ──
function cand(id: string, sub: string, weight = 1): Candidate {
  return {
    id, name: id, categoryMain: '한식', categorySub: sub, curated: false,
    lat: 37.48, lng: 127.03, address: '', distanceM: 100, walkMinutes: 2,
    priceTier: '가성비', priceEstimated: true, weight,
  };
}
test('applyFilters: 제외/seen/예산', () => {
  const pool = [cand('a', '국밥·탕'), cand('b', '고기구이'), cand('c', '국밥·탕')];
  const r = applyFilters(pool, { excludedSubs: ['고기구이'], priceTier: null, seenIds: ['a'] });
  assert.deepEqual(r.map((c) => c.id), ['c']);
});
test('weightedPick: 빈 배열 null', () => {
  assert.equal(weightedPick([]), null);
});
test('후식 거리 가중치: 가까울수록 크고 반경 끝은 1배', () => {
  assert.equal(dessertDistanceWeight(0, 300), DESSERT_NEAR_BOOST); // 코앞 = 최대
  assert.equal(dessertDistanceWeight(300, 300), 1); // 반경 끝 = 1배(하한)
  assert.ok(dessertDistanceWeight(50, 300) > dessertDistanceWeight(250, 300));
  // 중간 지점 = 1배와 최대의 정확히 중간 (선형). 상수를 튜닝해도 성립.
  assert.equal(dessertDistanceWeight(150, 300), 1 + (DESSERT_NEAR_BOOST - 1) / 2);
});
test('후식 거리 가중치: 반경 밖·음수도 1~최대로 클램프', () => {
  assert.equal(dessertDistanceWeight(9999, 300), 1);
  assert.equal(dessertDistanceWeight(-10, 300), DESSERT_NEAR_BOOST);
});
test('후식 거리 가중치: 확장 반경(1km)에선 기준이 함께 커짐', () => {
  // 300m 지점: 반경 300m일 땐 1배(끝), 반경 1km일 땐 더 높게(아직 가까운 편)
  assert.equal(dessertDistanceWeight(300, 300), 1);
  assert.ok(dessertDistanceWeight(300, 1000) > dessertDistanceWeight(300, 300));
});
test('boostVisited: 켜면 visited만 가중치↑, 끄면 그대로', () => {
  const pool = [
    { ...cand('a', '국밥·탕', 2), visited: true },
    cand('b', '국밥·탕', 2),
  ];
  const off = boostVisited(pool, false);
  assert.equal(off[0].weight, 2);
  const on = boostVisited(pool, true);
  assert.equal(on[0].weight, 2 * VISITED_BOOST); // visited 부스트
  assert.equal(on[1].weight, 2); // 미방문 그대로
});
test('boostVisited: 인증 맛집이 대부분 뽑힘', () => {
  const pool = [
    { ...cand('v', '국밥·탕', 1), visited: true },
    cand('x', '국밥·탕', 1),
    cand('y', '국밥·탕', 1),
  ];
  const boosted = boostVisited(pool, true);
  let vCount = 0;
  for (let i = 0; i < 300; i++) if (weightedPick(boosted)!.id === 'v') vCount++;
  assert.ok(vCount > 200, `인증 맛집이 대부분이어야 함 (실제 ${vCount}/300)`);
});
test('weightedPick: 가중치 편향', () => {
  const pool = [cand('a', '국밥·탕', 0.01), cand('b', '국밥·탕', 100)];
  let bCount = 0;
  for (let i = 0; i < 200; i++) if (weightedPick(pool)!.id === 'b') bCount++;
  assert.ok(bCount > 180, `가중치 높은 b가 대부분 뽑혀야 함 (실제 ${bCount})`);
});

// ── 통합: 모드별 후보 구성 (mock) ──
test('buildCandidates 혼밥: 고기구이 제외', async () => {
  const { candidates } = await buildCandidates(COMPANY_COORDS, 'lunch-solo', 'taxi');
  const hasGrill = candidates.some((c) => SOLO_EXCLUDED_SUBS.has(c.categorySub) && !c.soloFriendly);
  assert.equal(hasGrill, false);
  assert.ok(candidates.length > 0);
});
test('buildCandidates 혼밥(엄격): 관리자DB는 solo_friendly=TRUE만 출현', async () => {
  const { candidates } = await buildCandidates(COMPANY_COORDS, 'lunch-solo', 'taxi');
  const curated = candidates.filter((c) => c.curated);
  assert.ok(curated.length > 0, '혼밥 인증 관리자DB 후보가 있어야 함');
  // 시트에서 solo_friendly=FALSE(미검증)인 곳은 혼밥 룰렛에 나오면 안 된다
  assert.ok(curated.every((c) => c.soloFriendly), 'solo_friendly=FALSE가 섞이면 안 됨');

  // 점심약속 모드에선 그대로 나온다 (혼밥 모드에만 적용되는 규칙)
  const group = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'taxi');
  assert.ok(
    group.candidates.some((c) => c.curated && !c.soloFriendly),
    '점심약속은 solo_friendly와 무관해야 함',
  );
});
test('buildCandidates 혼밥: solo_friendly=FALSE 매장은 카카오 트윈으로도 재등장 안 함', async () => {
  // 크리스탈제이드 도곡점: DB solo_friendly=FALSE인데 중식(짜장·짬뽕=혼밥친화)이라
  // 예전엔 카카오 실시간 결과가 solo 필터 뒤 dedupe를 빠져나가 룰렛에 다시 올라왔다.
  const solo = await buildCandidates(COMPANY_COORDS, 'lunch-solo', 'taxi');
  const leaked = solo.candidates.filter((c) => c.name.includes('크리스탈제이드'));
  assert.equal(leaked.length, 0, '혼밥 룰렛에 크리스탈제이드(카카오 트윈 포함)가 있으면 안 됨');

  // 점심약속 모드에선 정상 노출돼야 한다 (혼밥 전용 규칙임을 확인)
  const group = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'taxi');
  assert.ok(
    group.candidates.some((c) => c.name.includes('크리스탈제이드')),
    '점심약속 모드에선 크리스탈제이드가 나와야 함',
  );
});
test('buildCandidates 도보: 관악구 카카오 결과 없음', async () => {
  const { candidates } = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'walk');
  const gwanak = candidates.some((c) => c.address.includes('관악구'));
  assert.equal(gwanak, false);
});

// ── 후식 카테고리 매핑 (CE7) ──
test('mapKakaoCafe: 세부 우선, 실패 시 커피·음료', () => {
  assert.equal(mapKakaoCafe('음식점 > 카페 > 제과,베이커리').sub, '베이커리·빵');
  assert.equal(mapKakaoCafe('음식점 > 카페 > 빙수').sub, '아이스크림·빙수');
  assert.equal(mapKakaoCafe('음식점 > 카페 > 도넛').sub, '도넛·와플');
  assert.equal(mapKakaoCafe('음식점 > 카페 > 커피전문점').sub, '커피·음료');
  // 미매칭도 커피·음료로 (CE7은 전부 카페)
  assert.equal(mapKakaoCafe('음식점 > 카페').sub, '커피·음료');
  assert.equal(mapKakaoCafe('음식점 > 카페').main, DESSERT_MAIN);
});

// ── 후식 추천 부스트 ──
test('boostRecommended: 켜면 recommended만 가중치↑', () => {
  const pool = [
    { ...cand('a', '커피·음료', 2), recommended: true },
    cand('b', '커피·음료', 2),
  ];
  assert.equal(boostRecommended(pool, false)[0].weight, 2);
  const on = boostRecommended(pool, true);
  assert.equal(on[0].weight, 2 * VISITED_BOOST);
  assert.equal(on[1].weight, 2);
});

// ── 후식 후보 구성 (mock, 위치기반 500m) ──
test('buildDessertCandidates: 500m 내 후보 + curated 추천/방문 필드', async () => {
  const { candidates, radius } = await buildDessertCandidates(COMPANY_COORDS);
  assert.ok(candidates.length > 0, '후식 후보가 있어야 함');
  // 모두 사용 반경 이내
  assert.ok(candidates.every((c) => c.distanceM <= radius));
  // 모든 후보 대분류는 후식 라벨
  assert.ok(candidates.every((c) => c.categoryMain === DESSERT_MAIN));
  // curated(coffee 시트) 후보에 recommended/visited가 전달됨
  const curated = candidates.filter((c) => c.curated);
  assert.ok(curated.length > 0, 'coffee 시트 큐레이션 후보가 있어야 함');
  assert.ok(curated.some((c) => c.recommended === true));
});

test('buildDessertCandidates: 반경 밖(관악) 카페는 제외', async () => {
  const { candidates } = await buildDessertCandidates(COMPANY_COORDS);
  const gwanak = candidates.some((c) => c.address.includes('관악구'));
  assert.equal(gwanak, false);
});

test('buildDessertCandidates: 현재 위치 기준 300m는 더 촘촘하게 컷', async () => {
  const { candidates, radius, expanded } = await buildDessertCandidates(COMPANY_COORDS, 300);
  assert.equal(radius, 300);
  assert.equal(expanded, false, 'mock 8곳이 300m 내라 확장 불필요');
  assert.ok(candidates.length >= 3);
  assert.ok(candidates.every((c) => c.distanceM <= 300), '모든 후보가 300m 이내');
  // 300m 밖(예: ~311m 매봉 디저트카페, ~387m 도곡 젤라또)은 제외돼야 함
  assert.ok(!candidates.some((c) => c.name === '매봉 디저트카페'));
});

// ── 시트 행 스키마 정합 ──
// SHEET_HEADER는 코드 어디서도 안 쓰이는 export라, 한 번 조용히 20→22열로 어긋난 적이 있다.
// 헤더와 행 빌더가 따로 놀면 시트 열이 통째로 밀리므로 여기서 못박는다.
const SAMPLE_PLACE = {
  place_name: '테스트식당',
  category_name: '음식점 > 한식 > 국밥',
  address_name: '서울 강남구 도곡동',
  road_address_name: '서울 강남구 남부순환로 2800',
  x: '127.0529',
  y: '37.4891',
  phone: '02-000-0000',
};
test('buildSheetRow: 열 개수가 SHEET_HEADER와 일치', () => {
  assert.equal(buildSheetRow(SAMPLE_PLACE, '둘다').length, SHEET_HEADER.length);
});
test('buildCandidateRow: 24열 + 앞 20열은 restaurants와 동일', () => {
  const cand = buildCandidateRow(SAMPLE_PLACE, '둘다');
  assert.equal(cand.length, CANDIDATE_HEADER.length);
  assert.equal(CANDIDATE_HEADER.length, SHEET_HEADER.length + 4);
  // 승격 = 앞 20열 그대로 복사. 어긋나면 restaurants 열이 밀린다.
  assert.deepEqual(cand.slice(0, SHEET_HEADER.length), buildSheetRow(SAMPLE_PLACE, '둘다'));
  // 검증 메타 4칸은 비어 있어야(=미검증) 한다
  assert.deepEqual(cand.slice(SHEET_HEADER.length), ['', '', '', '']);
  // A~T가 같으므로 헤더도 같은 순서여야 한다
  assert.deepEqual(CANDIDATE_HEADER.slice(0, SHEET_HEADER.length), SHEET_HEADER);
});

// ── 후식 동기화: 시트 행 스키마 정합 ──
test('buildCafeRow: 열 개수가 COFFEE_SHEET_HEADER와 일치', () => {
  const row = buildCafeRow({
    place_name: '테스트카페',
    category_name: '음식점 > 카페 > 도넛',
    address_name: '서울 강남구 도곡동',
    road_address_name: '서울 강남구 남부순환로 2800',
    x: '127.0529',
    y: '37.4891',
    phone: '02-000-0000',
  });
  assert.equal(row.length, COFFEE_SHEET_HEADER.length);
  assert.equal(COFFEE_SHEET_HEADER[COFFEE_SHEET_HEADER.length - 1], '아아INDEX');
  assert.equal(row[0], '테스트카페'); // name
  assert.equal(row[1], '도넛·와플'); // category_sub (CE7 매핑)
  assert.equal(row[8], 'TRUE'); // active
  assert.equal(row[12], 'FALSE'); // recommended (기본 미추천)
  assert.equal(row[13], ''); // 아아INDEX (동기화는 빈 값, 손 큐레이션)
});

test('buildDessertCandidates: curated 후보에 아아INDEX(iceAmericano) 전달', async () => {
  const { candidates } = await buildDessertCandidates(COMPANY_COORDS);
  const withAa = candidates.filter((c) => c.curated && c.iceAmericano != null);
  assert.ok(withAa.length > 0, 'coffee 시트 아아INDEX 값이 후보에 실려야 함');
  assert.ok(withAa.every((c) => typeof c.iceAmericano === 'number'));
});

// ── 동기화 중복 판정 (syncDedupe) — 찌개의민족 재추가 버그 회귀 ──
test('isDuplicatePlace: 이름 완전일치는 좌표가 멀어도 중복 (기존 50m 게이트 버그 회귀)', () => {
  // 시트 좌표와 카카오 좌표가 ~200m 차이나던 케이스 — 이전엔 신규로 재추가됨
  const existing = [{ name: '찌개의민족', lat: 37.4941, lng: 127.0621 }];
  const cand = { name: '찌개의민족', lat: 37.4959, lng: 127.0621 }; // 약 200m
  assert.ok(haversineMeters({ lat: 37.4941, lng: 127.0621 }, cand) > DUP_DISTANCE_M);
  assert.equal(isDuplicatePlace(cand, existing), true);
});
test('isDuplicatePlace: 좌표 없는 기존 행(파서 스킵)도 이름 완전일치면 중복', () => {
  const existing = [{ name: '찌개의민족' }]; // lat/lng 없음 (좌표 누락으로 파서가 스킵한 행)
  assert.equal(isDuplicatePlace({ name: '찌개의민족', lat: 37.5, lng: 127.03 }, existing), true);
});
test('isDuplicatePlace: 부분일치는 150m 이내만 중복(지점 구분)', () => {
  const existing = [{ name: '메가커피', lat: 37.4941, lng: 127.0621 }];
  const near = { name: '메가커피 도곡', lat: 37.4945, lng: 127.0621 }; // ~44m, 부분일치
  const far = { name: '메가커피 도곡', lat: 37.499, lng: 127.0621 }; // ~545m
  assert.equal(isDuplicatePlace(near, existing), true);
  assert.equal(isDuplicatePlace(far, existing), false);
});
test('isDuplicatePlace: 다른 상호는 중복 아님', () => {
  const existing = [{ name: '찌개의민족', lat: 37.4941, lng: 127.0621 }];
  assert.equal(isDuplicatePlace({ name: '북창동순두부', lat: 37.4941, lng: 127.0621 }, existing), false);
});
test('normName: 지점 접미사·공백 제거', () => {
  assert.equal(normName('찌개의민족 강남점'), '찌개의민족강남');
  assert.equal(normName('스타벅스 본점'), '스타벅스');
});

// ── 통계 (§11) ──
test('toKstStamp: UTC → KST, 시트가 날짜로 오해 못 할 형식', () => {
  // 2026-07-15T01:23:45Z = KST 10:23:45
  assert.equal(toKstStamp(new Date('2026-07-15T01:23:45Z')), '20260715-102345');
  // 자정 넘김 (UTC 15:30 = KST 다음날 00:30)
  assert.equal(toKstStamp(new Date('2026-07-15T15:30:00Z')), '20260716-003000');
  // 숫자로도 날짜로도 파싱되지 않아야 시트가 원본을 보존한다
  const s = toKstStamp(new Date('2026-07-15T01:23:45Z'));
  assert.ok(Number.isNaN(Number(s)), '숫자로 파싱되면 시트가 지수표기로 바꿔버림');
  assert.ok(Number.isNaN(Date.parse(s)), '날짜로 파싱되면 시트가 로케일 형식으로 바꿔버림');
});
test('stampToDate: 일자 추출 + 불량 형식 거부', () => {
  assert.equal(stampToDate('20260715-102345'), '2026-07-15');
  assert.equal(stampToDate('2026. 7. 15 오전 10:23'), null); // 시트가 날짜로 바꿔버린 경우
  assert.equal(stampToDate(''), null);
});
test('detail 인코딩 왕복 + 빈 값 제거', () => {
  const s = formatDetail({ respin: true, price: '보통', dist: 'walk', boost: false, empty: '' });
  assert.equal(s, 'respin=1;price=보통;dist=walk;boost=0');
  assert.deepEqual(parseDetail(s), { respin: '1', price: '보통', dist: 'walk', boost: '0' });
});
test('buildStatsRow: 7열 + 탭/개행 제거', () => {
  const row = buildStatsRow(
    { event: 'spin', visitor: 'v-abc123', mode: 'lunch-solo', place: '정닭\t곰탕', categorySub: '국밥·탕', detail: 'respin=0' },
    new Date('2026-07-15T01:23:45Z'),
  );
  assert.equal(row.length, STATS_HEADER.length);
  assert.equal(row[0], '20260715-102345');
  assert.equal(row[4], '정닭 곰탕', '탭이 남으면 시트 열이 밀림');
});
test('rowToStat: 불량 행은 null', () => {
  assert.ok(rowToStat({ ts: '20260715-102345', event: 'spin' }));
  assert.equal(rowToStat({ ts: '20260715-102345', event: '알수없음' }), null);
  assert.equal(rowToStat({ ts: 'garbage', event: 'spin' }), null);
});
test('aggregate: mock 이벤트 집계가 손으로 센 값과 일치', () => {
  const s = aggregate(MOCK_STAT_ROWS, '2026-07-15');
  // mock: 방문자 5명(aaa,bbb,ccc,ddd,eee), 룰렛 10회, 재추첨 3, 좋아요 4, 지도 3
  assert.equal(s.visitors, 5);
  assert.equal(s.spins, 10);
  assert.equal(s.respins, 3);
  assert.equal(s.likes, 4);
  assert.equal(s.maps, 3);
  // 3일차(오늘=2026-07-15) 방문자는 eee, aaa 둘
  assert.equal(s.visitorsToday, 2);
  assert.equal(s.daily.length, 3);
  assert.equal(s.daily[0].date, '2026-07-13');
  // 비율
  assert.equal(s.likeRate, 4 / 10);
  assert.equal(s.respinRate, 3 / 10);
  // 정닭곰탕이 3회로 최다 + 좋아요 2
  assert.equal(s.topPlaces[0].key, '정닭곰탕');
  assert.equal(s.topPlaces[0].count, 3);
  assert.equal(s.topPlaces[0].likes, 2);
  // 모드 분포 합 = 룰렛 수
  assert.equal(s.byMode.reduce((a, b) => a + b.count, 0), 10);
});
test('aggregate: 빈 입력에도 안전 (0으로 나누기 금지)', () => {
  const s = aggregate([], '2026-07-15');
  assert.equal(s.spins, 0);
  assert.equal(s.likeRate, 0);
  assert.equal(s.respinRate, 0);
  assert.equal(s.lastEventAt, null);
  assert.deepEqual(s.daily, []);
});

// ── 이동수단 선택 가중치 (v1.15) ──
test('거리 선호: 도보=가까울수록↑, 택시=멀수록↑, 따릉이=중립', () => {
  // 도보(반경 1300): 코앞이 최대, 반경 끝이 1배
  assert.equal(distancePrefWeight(0, 'walk'), DISTANCE_PREF_BOOST);
  assert.equal(distancePrefWeight(1300, 'walk'), 1);
  assert.ok(distancePrefWeight(200, 'walk') > distancePrefWeight(1000, 'walk'));

  // 택시(반경 5000): 정확히 반대 — 멀수록 최대
  assert.equal(distancePrefWeight(0, 'taxi'), 1);
  assert.equal(distancePrefWeight(5000, 'taxi'), DISTANCE_PREF_BOOST);
  assert.ok(distancePrefWeight(4000, 'taxi') > distancePrefWeight(500, 'taxi'));

  // 같은 500m 지점이라도 모드에 따라 선호가 뒤집힌다 (이 기능의 핵심)
  assert.ok(distancePrefWeight(500, 'walk') > distancePrefWeight(500, 'taxi'));

  // 따릉이는 중립 — 근/원 어느 쪽도 편들지 않는다
  assert.equal(distancePrefWeight(0, 'bike'), 1);
  assert.equal(distancePrefWeight(2000, 'bike'), 1);
});
test('거리 선호: 반경 밖·음수도 1~최대로 클램프', () => {
  assert.equal(distancePrefWeight(99999, 'walk'), 1);
  assert.equal(distancePrefWeight(-50, 'walk'), DISTANCE_PREF_BOOST);
  assert.equal(distancePrefWeight(99999, 'taxi'), DISTANCE_PREF_BOOST);
});
test('access_mode 일치 부스트: 지정 모드와 같을 때만', () => {
  assert.equal(accessModeWeight({ accessMode: 'taxi' }, 'taxi'), ACCESS_MODE_MATCH_BOOST);
  assert.equal(accessModeWeight({ accessMode: 'taxi' }, 'walk'), 1);
  assert.equal(accessModeWeight({ accessMode: 'walk' }, 'walk'), ACCESS_MODE_MATCH_BOOST);
  // 카카오 실시간 결과는 access_mode가 없다 → 항상 1배
  assert.equal(accessModeWeight({ accessMode: undefined }, 'taxi'), 1);
});
test('buildCandidates: 택시 지정 식당이 택시 모드에서 실제로 잘 뽑힌다', async () => {
  // mock '언덕 위 감자탕' = 직선 350m지만 access_mode=taxi (가파른 언덕)
  const taxi = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'taxi');
  const hill = taxi.candidates.find((c) => c.name === '언덕 위 감자탕')!;
  assert.ok(hill, '택시 모드엔 나와야 함');
  // 같은 거리대의 미지정 후보보다 가중치가 높아야 한다
  const plain = taxi.candidates.find((c) => c.curated && !c.accessMode && c.distanceM < 1000);
  if (plain) assert.ok(hill.weight > plain.weight, `택시 지정(${hill.weight}) > 미지정(${plain.weight})`);
});

// ── 격자 스캔 (§12) ──
test('scanAll: mock 모드는 네트워크를 타지 않고 반경 내 mock만 반환', async () => {
  // USE_MOCK 기본값(TRUE) — 테스트가 카카오를 호출하면 키 없이 실패하거나 과금된다
  const { places, stats } = await scanAll(COMPANY_COORDS, 2000, 'FD6');
  assert.ok(places.length > 0, 'mock 후보가 나와야 함');
  assert.equal(stats.calls, 0, 'mock인데 API를 호출하면 안 됨');
  // 반경 밖(관악 등)은 걸러져야 함
  assert.ok(
    places.every((p) => haversineMeters(COMPANY_COORDS, { lat: Number(p.y), lng: Number(p.x) }) <= 2000),
    '반경 밖이 섞이면 안 됨',
  );
});

// ── 구글 품질 게이트 (§12) ──
const GATE = { minRating: 4.0, minReviews: 200 };
test('passesGate: 평점 4.0 이상 또는 리뷰 200 이상', () => {
  // 평점만 좋아도 통과
  assert.equal(passesGate({ rating: 4.2, reviews: 3 }, GATE), true);
  // 리뷰만 많아도 통과 (평점이 낮아도 — 사용자가 정한 'or' 규칙)
  assert.equal(passesGate({ rating: 3.1, reviews: 500 }, GATE), true);
  // 경계값은 포함
  assert.equal(passesGate({ rating: 4.0, reviews: 0 }, GATE), true);
  assert.equal(passesGate({ rating: 1.0, reviews: 200 }, GATE), true);
  // 둘 다 미달이면 탈락
  assert.equal(passesGate({ rating: 3.9, reviews: 199 }, GATE), false);
});
test('passesGate: 평점을 못 받으면 통과시키지 않는다', () => {
  // 신규 오픈·매칭 실패 — 모르는 곳을 큐레이션 DB에 올리지 않는다
  assert.equal(passesGate({ rating: null, reviews: null, miss: 'no-result' }, GATE), false);
  assert.equal(passesGate({ rating: null, reviews: null, miss: 'too-far' }, GATE), false);
  assert.equal(passesGate({ rating: null, reviews: 999 }, GATE), true); // 리뷰수는 받았다면 인정
});
