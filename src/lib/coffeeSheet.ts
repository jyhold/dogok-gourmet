import Papa from 'papaparse';
import type { Cafe } from './types';
import { MOCK_CAFES } from './mockData';

// ── 후식(coffee) 시트 로더 + 10분 메모리 캐시 ────────────────
// restaurants 시트와 분리된 별도 탭. 대분류는 항상 '후식'이라 시트엔 category_sub만.

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  data: Cafe[];
  fetchedAt: number;
}

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

/** 가격 파싱: 콤마·원·₩·공백 제거 후 숫자. 예 '4,500원' → 4500. 빈 값·형식 오류면 undefined */
function parsePrice(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const cleaned = v.replace(/[^0-9.]/g, '');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** CSV 한 행 → Cafe. 필수값(name/lat/lng) 누락·active=FALSE 행은 null(건너뜀). */
function rowToCafe(row: Record<string, string>): Cafe | null {
  const name = row.name?.trim();
  const categorySub = row.category_sub?.trim();
  if (!name || !categorySub) return null;

  // active=FALSE는 제외 (빈 값·TRUE는 활성)
  const active = truthy(row.active) || (row.active ?? '').trim() === '';
  if (!active && (row.active ?? '').trim() !== '') return null;

  const lat = toNumber(row.lat);
  const lng = toNumber(row.lng);
  if (lat == null || lng == null) return null;

  return {
    name,
    categorySub,
    signatureMenu: row.signature_menu?.trim() ?? '',
    priceNote: row.price_note?.trim() ?? '',
    address: row.address?.trim() ?? '',
    lat,
    lng,
    comment: row.comment?.trim() ?? '',
    active: true,
    weight: toNumber(row.weight) ?? 1,
    phone: row.phone?.trim() || undefined,
    visited: truthy(row.visited),
    recommended: truthy(row.recommended),
    iceAmericano: parsePrice(row['아아INDEX']),
  };
}

async function fetchFromSheet(): Promise<Cafe[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_COFFEE_SHEET_TAB ?? 'coffee';
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID 미설정');

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    tab,
  )}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`후식 시트 fetch 실패: ${res.status}`);
  const csv = await res.text();

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const out: Cafe[] = [];
  for (const row of parsed.data) {
    const c = rowToCafe(row);
    if (c) out.push(c);
    else if (row.name) console.warn(`[coffee] 건너뛴 행: ${row.name}`);
  }
  return out;
}

/** 후식 큐레이션 DB 로드 (캐시 우선). mock 모드면 mock 반환. */
export async function loadCafes(): Promise<Cafe[]> {
  if (useMock()) {
    return MOCK_CAFES.filter((c) => c.active);
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
    console.error('[coffee] 로드 실패, 캐시/mock 폴백:', err);
    if (cache) return cache.data;
    return MOCK_CAFES.filter((c) => c.active);
  }
}
