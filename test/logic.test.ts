import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapKakaoCategory, estimatePriceTier, SOLO_EXCLUDED_SUBS } from '../src/lib/categories.ts';
import { haversineMeters, inAllowedDistrict, inServiceArea, COMPANY_COORDS } from '../src/lib/geo.ts';
import { applyFilters, boostVisited, weightedPick, VISITED_BOOST } from '../src/lib/roulette.ts';
import { buildCandidates } from '../src/lib/candidates.ts';
import type { Candidate } from '../src/lib/types.ts';

// ── 카테고리 매핑 (병목 7) ──
test('카카오 카테고리 매핑: 세부 우선', () => {
  assert.equal(mapKakaoCategory('음식점 > 한식 > 국밥').sub, '국밥·탕');
  assert.equal(mapKakaoCategory('음식점 > 일식 > 초밥,롤').sub, '초밥·회');
  assert.equal(mapKakaoCategory('음식점 > 한식 > 육류,고기').sub, '고기구이');
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
test('buildCandidates 팀회식: 큐레이션 메인은 단체석만', async () => {
  const { candidates } = await buildCandidates(COMPANY_COORDS, 'dinner-team', 'taxi');
  const curatedNonGroup = candidates.filter((c) => c.curated && !c.groupSeating);
  assert.equal(curatedNonGroup.length, 0);
});
test('buildCandidates 도보: 관악구 카카오 결과 없음', async () => {
  const { candidates } = await buildCandidates(COMPANY_COORDS, 'lunch-group', 'walk');
  const gwanak = candidates.some((c) => c.address.includes('관악구'));
  assert.equal(gwanak, false);
});
