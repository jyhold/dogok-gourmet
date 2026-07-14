// ── 카카오 신규 카페·디저트 → 후식(coffee) 시트 자동 추가 (주기적 동기화) ──
// /api/sync 에서 식당 동기화와 함께 호출. Vercel Cron이 하루 1회 트리거.
// 웹훅·시크릿·CRON은 식당 동기화와 공용. append 대상 탭만 'coffee'로 지정.
import { COMPANY_COORDS, haversineMeters } from './geo';
import { searchNearby } from './kakao';
import { loadCafes, loadCafeNames } from './coffeeSheet';
import { buildCafeRow } from './classify';
import { isDuplicatePlace, type KnownPlace } from './syncDedupe';

export interface CoffeeSyncResult {
  scanned: number; // 카카오 CE7에서 훑은 수
  fresh: number; // 시트에 없어 새로 추가할 수
  added: number; // 실제 append된 수
  skipped: number; // 중복/반경 밖 제외 수
  error?: string;
}

/**
 * 카카오 CE7(카페) 반경 검색 → coffee 시트에 없는 신규만 골라 Apps Script 웹훅으로 append.
 * 식당 동기화(syncNewRestaurants)와 동일 패턴. 웹훅 payload에 sheet:'coffee' 지정.
 * @param radiusM 반경(m). 기본 1000 = 후식 확장 반경과 정합.
 */
export async function syncNewCafes(radiusM = 1000): Promise<CoffeeSyncResult> {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) {
    return { scanned: 0, fresh: 0, added: 0, skipped: 0, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };
  }

  const [kakao, parsed, allNames] = await Promise.all([
    searchNearby(COMPANY_COORDS, radiusM, 'CE7'),
    loadCafes(),
    loadCafeNames(),
  ]);

  // 중복 비교 대상: 파싱본(좌표 O) + 원본 상호명(좌표 없는 스킵 행까지 커버)
  const existing: KnownPlace[] = [
    ...parsed.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng })),
    ...allNames.map((name) => ({ name })),
  ];

  let skipped = 0;
  const rows: string[][] = [];
  for (const p of kakao) {
    const lat = Number(p.y);
    const lng = Number(p.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped++;
      continue;
    }
    if (haversineMeters(COMPANY_COORDS, { lat, lng }) > radiusM) {
      skipped++;
      continue;
    }
    // 시트에 이미 있으면 중복 → 제외 (이름 완전일치=거리 무관, 부분일치=150m)
    if (isDuplicatePlace({ name: p.place_name, lat, lng }, existing)) {
      skipped++;
      continue;
    }
    rows.push(buildCafeRow(p));
  }

  if (rows.length === 0) {
    return { scanned: kakao.length, fresh: 0, added: 0, skipped };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // sheet:'coffee' → Apps Script가 coffee 탭에 append (미지정 시 restaurants)
      body: JSON.stringify({ secret, sheet: 'coffee', rows }),
    });
    if (!res.ok) {
      return { scanned: kakao.length, fresh: rows.length, added: 0, skipped, error: `웹훅 ${res.status}` };
    }
    const j = (await res.json().catch(() => ({}))) as { added?: number };
    return { scanned: kakao.length, fresh: rows.length, added: j.added ?? rows.length, skipped };
  } catch (err) {
    return {
      scanned: kakao.length,
      fresh: rows.length,
      added: 0,
      skipped,
      error: `웹훅 호출 실패: ${(err as Error).message}`,
    };
  }
}
