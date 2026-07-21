import type { Cafe, Candidate, Coords, DistanceMode, Mode, Restaurant } from './types';
import {
  DISTANCE_METERS,
  DESSERT_RADIUS_COMPANY_M,
  DESSERT_RADIUS_EXPANDED_M,
  DESSERT_MIN_RESULTS,
} from './types';
import { loadRestaurants } from './sheet';
import { loadCafes } from './coffeeSheet';
import { searchNearby } from './kakao';
import type { KakaoPlace } from './mockData';
import {
  estimatePriceTier,
  mapKakaoCategory,
  mapKakaoCafe,
  DESSERT_MAIN,
  SOLO_EXCLUDED_SUBS,
  SOLO_FRIENDLY_SUBS,
} from './categories';
import { haversineMeters, inAllowedDistrict, reachableInMode, walkMinutes } from './geo';

// ── 점심 모드는 항상 '점심' 시간대 (저녁 폐지) ──────────────
const LUNCH_MEAL = '점심' as const;

/**
 * 혼밥 모드에서 관리자DB(=solo_friendly 검증 완료) 후보에 주는 가중치.
 * 이 모드의 curated는 전부 solo_friendly=TRUE라, 사실상 '검증된 곳 > 카카오 실시간' 배수다.
 */
const SOLO_CURATED_BOOST = 2;

// ── 이동수단 선택 반영 (v1.17) ────────────────────────────
// 거리 모드는 reachableInMode(geo.ts)로 노출 여부를 정한다:
//  · access_mode 지정 매장 → 정확히 그 모드에서만 (우선순위1)
//  · 미지정 매장 → 군인공제회관 직선거리 밴드로 단 하나의 모드에만 배정 (우선순위2)
// 밴드가 서로 겹치지 않아 모드별로 후보 풀이 완전히 갈리므로, 예전 v1.15의
// 반경 상대 거리 가중치(distancePrefWeight)·access_mode 일치 부스트는 불필요해 제거했다.

/** meal_type 필드가 점심과 호환되는지 (둘다·점심 통과, 저녁 제외) */
function lunchMealMatches(rMeal: Restaurant['mealType']): boolean {
  return rMeal === '둘다' || rMeal === LUNCH_MEAL;
}

// ── 관리자DB Restaurant → Candidate ────────────────────────
function curatedToCandidate(r: Restaurant, center: Coords): Candidate {
  const straight = haversineMeters(center, { lat: r.lat, lng: r.lng });
  return {
    id: `db:${r.name}`,
    name: r.name,
    categoryMain: r.categoryMain,
    categorySub: r.categorySub,
    curated: true,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    distanceM: Math.round(straight),
    walkMinutes: walkMinutes(straight),
    priceTier: r.priceTier,
    priceEstimated: false,
    priceNote: r.priceNote || undefined,
    signatureMenu: r.signatureMenu || undefined,
    comment: r.comment || undefined,
    phone: r.phone,
    groupSeating: r.groupSeating,
    groupCapacity: r.groupCapacity,
    soloFriendly: r.soloFriendly,
    accessMode: r.accessMode,
    visited: r.visited,
    rating: r.rating,
    weight: r.weight,
  };
}

// ── 카카오 KakaoPlace → Candidate ──────────────────────────
function kakaoToCandidate(p: KakaoPlace, center: Coords): Candidate {
  const lat = Number(p.y);
  const lng = Number(p.x);
  const mapped = mapKakaoCategory(p.category_name);
  const straight = haversineMeters(center, { lat, lng });
  return {
    id: `kakao:${p.id}`,
    name: p.place_name,
    categoryMain: mapped.main,
    categorySub: mapped.sub,
    curated: false,
    lat,
    lng,
    address: p.road_address_name || p.address_name,
    distanceM: Math.round(straight),
    walkMinutes: walkMinutes(straight),
    priceTier: estimatePriceTier(mapped.sub),
    priceEstimated: true,
    phone: p.phone || undefined,
    weight: 1,
    kakaoPlaceUrl: p.place_url,
  };
}

// ── 중복 병합 (이름+좌표 50m 근접 → 관리자DB 우선, 병목 7) ────

/** 카카오 후보 k가 관리자DB 후보 중 하나와 동일 매장인가 (이름+50m) */
function isCuratedDup(k: Candidate, curated: Candidate[]): boolean {
  return curated.some(
    (c) =>
      haversineMeters({ lat: c.lat, lng: c.lng }, { lat: k.lat, lng: k.lng }) <= 50 &&
      (c.name.includes(k.name) || k.name.includes(c.name) || sameCore(c.name, k.name)),
  );
}

/** 카카오 후보에서 관리자DB와 중복되는 것을 제거 (DB우선) */
function dropCuratedDupes(kakao: Candidate[], curated: Candidate[]): Candidate[] {
  return kakao.filter((k) => !isCuratedDup(k, curated));
}

function dedupe(curated: Candidate[], kakao: Candidate[]): Candidate[] {
  return [...curated, ...dropCuratedDupes(kakao, curated)];
}

/** 상호 핵심어(지점명 제거) 일치 검사 */
function sameCore(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s|점$|본점|지점|역점/g, '');
  const na = norm(a);
  const nb = norm(b);
  return na.length >= 2 && (na.includes(nb) || nb.includes(na));
}

export interface BuildResult {
  candidates: Candidate[];
}

/**
 * 점심 모드 후보 구성 (기획서 §7.2). 시작점=군인공제회관 고정.
 * mode: lunch-solo | lunch-group / distance: 이동수단(반경·행정구역)
 */
export async function buildCandidates(
  center: Coords,
  mode: Extract<Mode, 'lunch-solo' | 'lunch-group'>,
  distance: DistanceMode,
): Promise<BuildResult> {
  const radius = DISTANCE_METERS[distance];

  // 1) 카카오 반경 검색 → 행정구역 필터 → 후보화
  const rawKakao = await searchNearby(center, radius);
  let kakaoCands = rawKakao
    .filter((p) => inAllowedDistrict(p.road_address_name || p.address_name, distance))
    .map((p) => kakaoToCandidate(p, center))
    .filter((c) => reachableInMode(c, distance));

  // 2) 관리자DB 로드 → 반경 + 점심 meal_type 매칭 (행정구역 필터 미적용: 예외 등록 허용)
  const restaurants = await loadRestaurants();
  let curatedCands = restaurants
    .filter((r) => lunchMealMatches(r.mealType))
    .map((r) => curatedToCandidate(r, center))
    .filter((c) => reachableInMode(c, distance));

  // 점심 공통: '기타' 대분류 제외 (치킨·호프·매칭 실패는 점심 룰렛에 미출현)
  const notEtc = (c: Candidate) => c.categoryMain !== '기타';
  kakaoCands = kakaoCands.filter(notEtc);
  curatedCands = curatedCands.filter(notEtc);

  // ★ 카카오에서 관리자DB와 중복되는 매장을 먼저 제거 (DB우선, 병목 1).
  //   반드시 아래 solo_friendly 필터 '이전'에 전체 curated 기준으로 해야 한다.
  //   그러지 않으면 DB가 미검증(solo_friendly=FALSE)으로 뺀 매장을, 카카오 실시간
  //   결과가 카테고리 휴리스틱만으로 되살린다. (예: 크리스탈제이드 도곡점이
  //   solo_friendly=FALSE인데 중식(짜장·짬뽕=혼밥친화)으로 매핑돼 혼밥 룰렛에 재등장)
  kakaoCands = dropCuratedDupes(kakaoCands, curatedCands);

  // 3) 모드별 후보 구성
  if (mode === 'lunch-solo') {
    // 혼밥(엄격): 관리자DB는 solo_friendly=TRUE만 출현. FALSE는 미검증으로 보고 제외한다.
    // 카테고리 제외(SOLO_EXCLUDED_SUBS)는 여기서 볼 필요가 없다 — 관리자가 TRUE로 찍었다면
    // 고기구이라도 1인 가능하다는 판단이므로 그대로 통과시킨다.
    curatedCands = curatedCands
      .filter((c) => c.soloFriendly)
      .map((c) => ({
        ...c,
        weight:
          c.weight * (SOLO_FRIENDLY_SUBS.has(c.categorySub) ? 1.5 : 1) * SOLO_CURATED_BOOST,
      }));
    // 카카오 실시간 결과엔 solo_friendly 정보가 없어 카테고리 휴리스틱으로만 거른다.
    kakaoCands = kakaoCands
      .filter((c) => !SOLO_EXCLUDED_SUBS.has(c.categorySub))
      .map((c) => ({
        ...c,
        weight: c.weight * (SOLO_FRIENDLY_SUBS.has(c.categorySub) ? 1.5 : 1),
      }));
  }
  // lunch-group: 전 카테고리, 예산 필터는 프론트에서 (기본 동작)

  // 카카오는 위에서 이미 관리자DB와 중복 제거됨 → 여기선 단순 합치기
  const merged = [...curatedCands, ...kakaoCands];
  return { candidates: merged };
}

// ── 후식(coffee) Cafe → Candidate ──────────────────────────
function cafeCuratedToCandidate(c: Cafe, center: Coords): Candidate {
  const straight = haversineMeters(center, { lat: c.lat, lng: c.lng });
  return {
    id: `cafe:${c.name}`,
    name: c.name,
    categoryMain: DESSERT_MAIN,
    categorySub: c.categorySub,
    curated: true,
    lat: c.lat,
    lng: c.lng,
    address: c.address,
    distanceM: Math.round(straight),
    walkMinutes: walkMinutes(straight),
    priceTier: '보통',
    priceEstimated: false,
    priceNote: c.priceNote || undefined,
    signatureMenu: c.signatureMenu || undefined,
    comment: c.comment || undefined,
    phone: c.phone,
    visited: c.visited,
    recommended: c.recommended,
    iceAmericano: c.iceAmericano,
    weight: c.weight,
  };
}

function cafeKakaoToCandidate(p: KakaoPlace, center: Coords): Candidate {
  const lat = Number(p.y);
  const lng = Number(p.x);
  const mapped = mapKakaoCafe(p.category_name);
  const straight = haversineMeters(center, { lat, lng });
  return {
    id: `kakao:${p.id}`,
    name: p.place_name,
    categoryMain: mapped.main,
    categorySub: mapped.sub,
    curated: false,
    lat,
    lng,
    address: p.road_address_name || p.address_name,
    distanceM: Math.round(straight),
    walkMinutes: walkMinutes(straight),
    priceTier: '보통',
    priceEstimated: true,
    phone: p.phone || undefined,
    weight: 1,
    kakaoPlaceUrl: p.place_url,
  };
}

export interface DessertResult {
  candidates: Candidate[];
  /** 반경을 기본(500m)에서 확장했는지 (결과 부족) */
  expanded: boolean;
  /** 실제 사용 반경 (m) */
  radius: number;
}

/** 지정 반경으로 후식 후보 1회 구성 (카카오 CE7 + coffee 시트 + 병합) */
/** 가장 가까운 곳의 가중치 배수 (반경 끝은 1배). 높일수록 코앞 편중, 낮출수록 다양 */
export const DESSERT_NEAR_BOOST = 2;

/**
 * 후식 거리 가중치 — 점심 후 짧게 다녀오는 특성상 가까울수록 자주 나오게.
 * 0m=DESSERT_NEAR_BOOST배 → 반경 끝=1배로 선형 감쇠. 1배 하한이라 먼 곳도 가끔은 나온다.
 * 반경 기준 상대값이라 자동 확장(1km) 시에도 자연스럽게 동작.
 */
export function dessertDistanceWeight(distM: number, radiusM: number): number {
  const t = Math.min(1, Math.max(0, distM / Math.max(1, radiusM)));
  return 1 + (DESSERT_NEAR_BOOST - 1) * (1 - t);
}

async function buildDessertAtRadius(center: Coords, radius: number): Promise<Candidate[]> {
  // 1) 카카오 CE7(카페) 반경 검색 → 후보화 → 직선거리 컷 (행정구역 필터 미적용)
  const rawKakao = await searchNearby(center, radius, 'CE7');
  const kakaoCands = rawKakao
    .map((p) => cafeKakaoToCandidate(p, center))
    .filter((c) => c.distanceM <= radius);

  // 2) coffee 시트 → 후보화 → 직선거리 컷
  const cafes = await loadCafes();
  const curatedCands = cafes
    .map((c) => cafeCuratedToCandidate(c, center))
    .filter((c) => c.distanceM <= radius);

  return dedupe(curatedCands, kakaoCands);
}

/**
 * 후식 모드 후보 구성 — base 반경(현재 위치 300m / 군인공제회관 폴백 500m).
 * 결과가 부족(DESSERT_MIN_RESULTS 미만)하면 1km까지 1회 자동 확장.
 */
export async function buildDessertCandidates(
  center: Coords,
  radius: number = DESSERT_RADIUS_COMPANY_M,
): Promise<DessertResult> {
  let candidates = await buildDessertAtRadius(center, radius);
  let expanded = false;
  let usedRadius = radius;

  if (candidates.length < DESSERT_MIN_RESULTS && radius < DESSERT_RADIUS_EXPANDED_M) {
    usedRadius = DESSERT_RADIUS_EXPANDED_M;
    candidates = await buildDessertAtRadius(center, usedRadius);
    expanded = true;
  }

  // 최종 반경 기준으로 거리 가중치 적용 (가까울수록 잘 나오게)
  const weighted = candidates.map((c) => ({
    ...c,
    weight: c.weight * dessertDistanceWeight(c.distanceM, usedRadius),
  }));

  return { candidates: weighted, expanded, radius: usedRadius };
}
