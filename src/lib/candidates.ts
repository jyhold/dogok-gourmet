import type { Candidate, Coords, DistanceMode, MealType, Mode, Restaurant } from './types';
import { DISTANCE_METERS } from './types';
import { loadRestaurants } from './sheet';
import { searchNearby } from './kakao';
import type { KakaoPlace } from './mockData';
import {
  estimatePriceTier,
  mapKakaoCategory,
  LUNCH_ONLY_SUBS,
  SOLO_EXCLUDED_SUBS,
  SOLO_FRIENDLY_SUBS,
  TEAM_DINNER_SUBS,
} from './categories';
import { haversineMeters, inAllowedDistrict, reachableInMode, walkMinutes } from './geo';

// ── 모드 → 식사시간대 매핑 ─────────────────────────────────
function mealOf(mode: Mode): MealType {
  return mode.startsWith('lunch') ? '점심' : '저녁';
}

/** meal_type 필드가 모드와 호환되는지 (둘다는 항상 통과) */
function mealMatches(rMeal: MealType, want: MealType): boolean {
  return rMeal === '둘다' || rMeal === want;
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
function dedupe(curated: Candidate[], kakao: Candidate[]): Candidate[] {
  const result = [...curated];
  for (const k of kakao) {
    const dup = curated.some(
      (c) =>
        haversineMeters({ lat: c.lat, lng: c.lng }, { lat: k.lat, lng: k.lng }) <= 50 &&
        (c.name.includes(k.name) || k.name.includes(c.name) || sameCore(c.name, k.name)),
    );
    if (!dup) result.push(k);
  }
  return result;
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
  /** 팀회식에서 단체석 보조 후보까지 포함해야 했는지 */
  usedFallback: boolean;
}

/**
 * 모드별 후보 구성 (기획서 §7.2).
 * center: 기준 좌표 / mode: 4종 / distance: 이동수단(반경·행정구역)
 */
export async function buildCandidates(
  center: Coords,
  mode: Mode,
  distance: DistanceMode,
): Promise<BuildResult> {
  const radius = DISTANCE_METERS[distance];
  const meal = mealOf(mode);

  // 1) 카카오 반경 검색 → 행정구역 필터 → 후보화
  const rawKakao = await searchNearby(center, radius);
  let kakaoCands = rawKakao
    .filter((p) => inAllowedDistrict(p.road_address_name || p.address_name, distance))
    .map((p) => kakaoToCandidate(p, center))
    .filter((c) => reachableInMode(c, distance));

  // 2) 관리자DB 로드 → 반경 + meal_type 매칭 (행정구역 필터 미적용: 예외 등록 허용)
  const restaurants = await loadRestaurants();
  let curatedCands = restaurants
    .filter((r) => mealMatches(r.mealType, meal))
    .map((r) => curatedToCandidate(r, center))
    .filter((c) => reachableInMode(c, distance));

  // 점심 모드('기타' 대분류 제외): 치킨·호프·매칭 실패 등은 점심 룰렛에 안 나오게
  if (mode === 'lunch-solo' || mode === 'lunch-group') {
    const notEtc = (c: Candidate) => c.categoryMain !== '기타';
    kakaoCands = kakaoCands.filter(notEtc);
    curatedCands = curatedCands.filter(notEtc);
  }

  let usedFallback = false;

  // 3) 모드별 후보 구성
  switch (mode) {
    case 'lunch-solo': {
      // 혼밥: 다인 전제 제외, 혼밥 친화 가중치↑, solo_friendly 추가 가중치
      curatedCands = curatedCands
        .filter((c) => !SOLO_EXCLUDED_SUBS.has(c.categorySub) || c.soloFriendly)
        .map((c) => ({
          ...c,
          weight:
            c.weight *
            (SOLO_FRIENDLY_SUBS.has(c.categorySub) ? 1.5 : 1) *
            (c.soloFriendly ? 2 : 1),
        }));
      kakaoCands = kakaoCands
        .filter((c) => !SOLO_EXCLUDED_SUBS.has(c.categorySub))
        .map((c) => ({
          ...c,
          weight: c.weight * (SOLO_FRIENDLY_SUBS.has(c.categorySub) ? 1.5 : 1),
        }));
      break;
    }
    case 'lunch-group': {
      // 점심약속: 전 카테고리, 예산 필터는 프론트에서. 기존 기본 동작.
      break;
    }
    case 'dinner-flash': {
      // 번개모임: 예산 무관, 점심형 카테고리는 저녁에 가중치↓
      const softenLunchOnly = (c: Candidate): Candidate =>
        LUNCH_ONLY_SUBS.has(c.categorySub) ? { ...c, weight: c.weight * 0.4 } : c;
      curatedCands = curatedCands.map(softenLunchOnly);
      kakaoCands = kakaoCands.map(softenLunchOnly);
      break;
    }
    case 'dinner-team': {
      // 팀회식: 관리자DB 중 group_seating=TRUE만 메인 후보
      const teamMain = curatedCands.filter((c) => c.groupSeating);
      curatedCands = teamMain;
      // 카카오는 회식형 카테고리만 '단체석 미확인' 보조 후보
      kakaoCands = kakaoCands
        .filter((c) => TEAM_DINNER_SUBS.has(c.categorySub))
        .map((c) => ({ ...c, groupUnconfirmed: true, weight: c.weight * 0.5 }));
      // 후보 3곳 미만이면 보조 후보 포함 플래그 (프론트 안내용)
      if (teamMain.length < 3) usedFallback = true;
      break;
    }
  }

  const merged = dedupe(curatedCands, kakaoCands);
  return { candidates: merged, usedFallback };
}
