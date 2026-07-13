import Papa from 'papaparse';
import type { DistanceMode, MealType, PriceTier, Restaurant } from './types';
import { MOCK_RESTAURANTS } from './mockData';

// ── 관리자DB(구글 시트) 로더 + 10분 메모리 캐시 (병목 6) ─────

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  data: Restaurant[];
  fetchedAt: number;
}

// 서버리스 콜드스타트마다 초기화되지만 지인용 트래픽에선 문제없음.
let cache: CacheEntry | null = null;

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

function truthy(v: string | undefined): boolean {
  return (v ?? '').trim().toUpperCase() === 'TRUE';
}

function toNumber(v: string | undefined): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** 평점 정규화: 0~10 정수로 클램프. 빈 값이면 undefined. */
function clampRating(v: number | undefined): number | undefined {
  if (v == null) return undefined;
  return Math.max(0, Math.min(10, Math.round(v)));
}

/** access_mode 파싱: 1=도보/2=따릉이/3=택시. 빈 값·범위 밖이면 undefined(직선거리 폴백) */
const ACCESS_MODE_BY_NUM: Record<number, DistanceMode> = { 1: 'walk', 2: 'bike', 3: 'taxi' };
function parseAccessMode(v: string | undefined): DistanceMode | undefined {
  const n = toNumber(v);
  return n != null ? ACCESS_MODE_BY_NUM[n] : undefined;
}

const PRICE_TIERS: PriceTier[] = ['가성비', '보통', '플렉스', '회식'];
const MEAL_TYPES: MealType[] = ['점심', '저녁', '둘다'];

/** CSV 한 행 → Restaurant. 필수값 누락·형식 오류 행은 null 반환(건너뜀). */
function rowToRestaurant(row: Record<string, string>): Restaurant | null {
  const name = row.name?.trim();
  const categoryMain = row.category_main?.trim();
  const categorySub = row.category_sub?.trim();
  const priceTierRaw = row.price_tier?.trim() as PriceTier;
  if (!name || !categoryMain || !categorySub) return null;

  // active=FALSE는 파싱 단계에서 제외
  const active = truthy(row.active) || (row.active ?? '').trim() === '';
  if (!active && (row.active ?? '').trim() !== '') return null;

  const lat = toNumber(row.lat);
  const lng = toNumber(row.lng);
  // 좌표 없으면 Phase 1에서는 건너뜀 (지오코딩은 Phase 2에서 채움)
  if (lat == null || lng == null) return null;

  const priceTier = PRICE_TIERS.includes(priceTierRaw) ? priceTierRaw : '보통';
  const mealRaw = row.meal_type?.trim() as MealType;
  const mealType = MEAL_TYPES.includes(mealRaw) ? mealRaw : '둘다';

  return {
    name,
    categoryMain,
    categorySub,
    signatureMenu: row.signature_menu?.trim() ?? '',
    priceTier,
    priceNote: row.price_note?.trim() ?? '',
    address: row.address?.trim() ?? '',
    lat,
    lng,
    comment: row.comment?.trim() ?? '',
    active: true,
    weight: toNumber(row.weight) ?? 1,
    mealType,
    groupSeating: truthy(row.group_seating),
    groupCapacity: toNumber(row.group_capacity),
    phone: row.phone?.trim() || undefined,
    soloFriendly: truthy(row.solo_friendly),
    accessMode: parseAccessMode(row.access_mode),
    visited: truthy(row.visited),
    rating: clampRating(toNumber(row.rating)),
  };
}

async function fetchFromSheet(): Promise<Restaurant[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB ?? 'restaurants';
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID 미설정');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    tab,
  )}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`시트 fetch 실패: ${res.status}`);
  const csv = await res.text();

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const out: Restaurant[] = [];
  for (const row of parsed.data) {
    const r = rowToRestaurant(row);
    if (r) out.push(r);
    else if (row.name) console.warn(`[sheet] 건너뛴 행: ${row.name}`);
  }
  return out;
}

/** 관리자DB 로드 (캐시 우선). mock 모드면 mock 반환. */
export async function loadRestaurants(): Promise<Restaurant[]> {
  if (useMock()) {
    return MOCK_RESTAURANTS.filter((r) => r.active);
  }

  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const data = await fetchFromSheet();
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    console.error('[sheet] 로드 실패, 캐시/mock 폴백:', err);
    if (cache) return cache.data;
    return MOCK_RESTAURANTS.filter((r) => r.active);
  }
}
