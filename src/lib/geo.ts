import type { Coords, DistanceMode } from './types';
import { DISTANCE_METERS } from './types';

// ── 고정 시작점: 도곡동 군인공제회관 (사내용이라 항상 여기서 시작, 위치인식 미사용) ──
// 카카오 지오코딩 확정(2026-07): 서울 강남구 남부순환로 2806 (도곡동 467-13), 매봉·도곡역 사이.
export const COMPANY_COORDS: Coords = { lat: 37.4891, lng: 127.0529 };

// ── 서비스 지역 바운딩 박스 (서초·강남·동작·송파 4개구 커버) ──
// 세부 판정은 주소 행정구역 필터가 담당, 이건 1차 컷.
export const SERVICE_BBOX = {
  minLat: 37.44,
  maxLat: 37.54,
  minLng: 126.94,
  maxLng: 127.13,
};

/** 도보/따릉이는 서초·강남만, 택시는 +동작·송파 */
export const ALLOWED_DISTRICTS: Record<DistanceMode, string[]> = {
  walk: ['서초구', '강남구'],
  bike: ['서초구', '강남구'],
  taxi: ['서초구', '강남구', '동작구', '송파구'],
};

/** 하버사인 직선거리 (m) */
export function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// 반경 상한은 직선거리(하버사인) 기준. 아래 보정계수는 '도보 예상 분' 표시용에만 사용.
export const ROAD_FACTOR = 1.3;

/** 직선거리 → 도보 예상 분 (직선거리 × 도로보정 1.3 ÷ 67m/분, 병목 5) */
export function walkMinutes(straightMeters: number): number {
  return Math.max(1, Math.round((straightMeters * ROAD_FACTOR) / 67));
}

/** 서비스 지역 바운딩 박스 안인지 */
export function inServiceArea(c: Coords): boolean {
  return (
    c.lat >= SERVICE_BBOX.minLat &&
    c.lat <= SERVICE_BBOX.maxLat &&
    c.lng >= SERVICE_BBOX.minLng &&
    c.lng <= SERVICE_BBOX.maxLng
  );
}

/** 거리 모드에 맞는 직선거리 반경(m) 내인지 */
export function withinRadius(from: Coords, to: Coords, mode: DistanceMode): boolean {
  return haversineMeters(from, to) <= DISTANCE_METERS[mode];
}

/** 주소 문자열이 해당 거리 모드에서 허용된 행정구역인지 */
export function inAllowedDistrict(address: string, mode: DistanceMode): boolean {
  if (!address) return false;
  return ALLOWED_DISTRICTS[mode].some((d) => address.includes(d));
}
