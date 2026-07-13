// ── 카카오 신규 식당 → 관리자 시트 자동 추가 (주기적 동기화) ──
// /api/sync 에서 호출. Vercel Cron이 하루 1회 트리거.
import { COMPANY_COORDS, haversineMeters, inAllowedDistrict } from './geo';
import { searchNearby } from './kakao';
import { loadRestaurants } from './sheet';
import { classifyKakao, buildSheetRow } from './classify';

export interface SyncResult {
  scanned: number; // 카카오에서 훑은 수
  fresh: number; // 시트에 없어 새로 추가할 수
  added: number; // 실제 append된 수
  skipped: number; // 중복/필터로 제외된 수
  error?: string;
}

/** 상호 핵심어(지점명 제거) 정규화 — 중복 판정용 */
function normName(s: string): string {
  return s.replace(/\s|점$|본점|지점|역점/g, '');
}

/**
 * 카카오 반경 검색 → 시트에 없는(중복 아닌) 신규만 골라 Apps Script 웹훅으로 append.
 * 잡음 필터(카페 제외, 치킨·호프=저녁)는 시드와 동일 로직 재사용.
 */
export async function syncNewRestaurants(radiusM = 2500): Promise<SyncResult> {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) {
    return { scanned: 0, fresh: 0, added: 0, skipped: 0, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };
  }

  const [kakao, existing] = await Promise.all([
    searchNearby(COMPANY_COORDS, radiusM),
    loadRestaurants(),
  ]);

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
    // 4개구(서초·강남·동작·송파) 안만
    if (!inAllowedDistrict(p.road_address_name || p.address_name, 'taxi')) {
      skipped++;
      continue;
    }
    const cls = classifyKakao(p);
    if (!cls.keep) {
      skipped++;
      continue;
    }
    // 시트에 이미 있으면(이름+50m) 중복 → 제외
    const dup = existing.some(
      (r) =>
        haversineMeters({ lat: r.lat, lng: r.lng }, { lat, lng }) <= 50 &&
        (r.name.includes(p.place_name) ||
          p.place_name.includes(r.name) ||
          normName(r.name) === normName(p.place_name)),
    );
    if (dup) {
      skipped++;
      continue;
    }
    rows.push(buildSheetRow(p, cls.mealType));
  }

  if (rows.length === 0) {
    return { scanned: kakao.length, fresh: 0, added: 0, skipped };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, rows }),
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
