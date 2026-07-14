import type { Coords } from './types';
import { MOCK_KAKAO_PLACES, MOCK_KAKAO_CAFES, type KakaoPlace } from './mockData';
import { haversineMeters } from './geo';

// ── 카카오 로컬 API (반경 음식점 검색) + mock 폴백 ──────────

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

// 좌표 격자 약 100m + 반경 단위 5분 캐시 (비용 폭발 방지, §5.3)
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: KakaoPlace[]; at: number }>();

function gridKey(c: Coords, radius: number, groupCode: string): string {
  // 소수 3자리 ≈ 111m 격자. groupCode로 FD6(음식점)/CE7(카페) 캐시 분리
  return `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${radius},${groupCode}`;
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
  groupCode: string,
): Promise<{ docs: KakaoApiDoc[]; isEnd: boolean }> {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error('KAKAO_REST_KEY 미설정');

  // 카테고리 그룹 FD6 = 음식점, CE7 = 카페
  const params = new URLSearchParams({
    category_group_code: groupCode,
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

/**
 * 반경 내 매장 검색 (최대 3페이지 = 45건, 병목 대응).
 * groupCode: FD6=음식점(기본), CE7=카페(후식 모드).
 */
export async function searchNearby(
  center: Coords,
  radius: number,
  groupCode = 'FD6',
): Promise<KakaoPlace[]> {
  if (useMock()) {
    // mock: 그룹별 소스에서 반경 내만 필터해 반환
    const source = groupCode === 'CE7' ? MOCK_KAKAO_CAFES : MOCK_KAKAO_PLACES;
    return source.filter(
      (p) => haversineMeters(center, { lat: Number(p.y), lng: Number(p.x) }) <= radius,
    );
  }

  const ck = gridKey(center, radius, groupCode);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const all: KakaoPlace[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const { docs, isEnd } = await fetchKakaoPage(center, radius, page, groupCode);
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
