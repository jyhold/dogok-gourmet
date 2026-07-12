import type { Coords } from './types';
import { MOCK_KAKAO_PLACES, type KakaoPlace } from './mockData';
import { haversineMeters } from './geo';

// ── 카카오 로컬 API (반경 음식점 검색) + mock 폴백 ──────────

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

// 좌표 격자 약 100m + 반경 단위 5분 캐시 (비용 폭발 방지, §5.3)
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: KakaoPlace[]; at: number }>();

function gridKey(c: Coords, radius: number): string {
  // 소수 3자리 ≈ 111m 격자
  return `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${radius}`;
}

interface KakaoApiDoc {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  phone: string;
  place_url: string;
}

async function fetchKakaoPage(
  center: Coords,
  radius: number,
  page: number,
): Promise<{ docs: KakaoApiDoc[]; isEnd: boolean }> {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error('KAKAO_REST_KEY 미설정');

  // 카테고리 그룹 FD6 = 음식점
  const params = new URLSearchParams({
    category_group_code: 'FD6',
    x: String(center.lng),
    y: String(center.lat),
    radius: String(radius),
    size: '15',
    page: String(page),
    sort: 'distance',
  });
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/category.json?${params}`,
    { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`카카오 검색 실패: ${res.status}`);
  const json = (await res.json()) as {
    documents: KakaoApiDoc[];
    meta: { is_end: boolean };
  };
  return { docs: json.documents, isEnd: json.meta.is_end };
}

/** 반경 내 음식점 검색 (최대 3페이지 = 45건, 병목 대응). */
export async function searchNearby(center: Coords, radius: number): Promise<KakaoPlace[]> {
  if (useMock()) {
    // mock: 반경 내만 필터해 반환
    return MOCK_KAKAO_PLACES.filter(
      (p) => haversineMeters(center, { lat: Number(p.y), lng: Number(p.x) }) <= radius,
    );
  }

  const ck = gridKey(center, radius);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const all: KakaoPlace[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const { docs, isEnd } = await fetchKakaoPage(center, radius, page);
      all.push(...docs);
      if (isEnd) break;
    }
    cache.set(ck, { data: all, at: Date.now() });
  } catch (err) {
    console.error('[kakao] 검색 실패:', err);
    if (hit) return hit.data;
  }
  return all;
}
