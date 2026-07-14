// ── 카카오 신규 식당 → 관리자 시트 자동 추가 (주기적 동기화) ──
// /api/sync 에서 호출. Vercel Cron이 하루 1회 트리거.
import { COMPANY_COORDS, haversineMeters, inAllowedDistrict } from './geo';
import { searchNearby } from './kakao';
import { loadRestaurants, loadRestaurantNames } from './sheet';
import { classifyKakao, buildSheetRow } from './classify';
import { isDuplicatePlace, type KnownPlace } from './syncDedupe';

export interface SyncResult {
  scanned: number; // 카카오에서 훑은 수
  fresh: number; // 시트에 없어 새로 추가할 수
  added: number; // 실제 append된 수
  skipped: number; // 중복/필터로 제외된 수
  error?: string;
}

/**
 * 웹훅 쓰기 경로 점검용 — 표시용 테스트 행 1개를 대상 탭에 append.
 * active=FALSE라 앱 룰렛엔 안 나옴. 확인 후 시트에서 그 행만 삭제하면 됨.
 * @param target 'restaurants'(기본) | 'coffee'
 */
export async function pingWebhook(
  target: 'restaurants' | 'coffee' = 'restaurants',
): Promise<{ ok: boolean; sheet: string; added?: number; error?: string }> {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, sheet: target, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };

  // active=FALSE → 앱에 미노출. name에 눈에 띄는 표식. 각 시트 헤더 열수에 맞춤.
  const testRow =
    target === 'coffee'
      ? // coffee 14열: name,category_sub,signature_menu,price_note,address,lat,lng,comment,active,weight,phone,visited,recommended,아아INDEX
        [
          '__동기화_테스트__', '커피·음료', '', '', '웹훅 테스트 행 — 확인 후 삭제하세요',
          '37.4891', '127.0529', '', 'FALSE', '1', '', 'FALSE', 'FALSE', '',
        ]
      : // restaurants 20열
        [
          '__동기화_테스트__', '기타', '기타', '', '보통', '',
          '웹훅 테스트 행 — 확인 후 삭제하세요', '37.4891', '127.0529', '',
          'FALSE', '1', '둘다', 'FALSE', '', '', 'FALSE', 'FALSE', '', '',
        ];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, sheet: target, rows: [testRow] }),
    });
    if (!res.ok) return { ok: false, sheet: target, error: `웹훅 ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as { added?: number; error?: string };
    if (j.error) return { ok: false, sheet: target, error: `웹훅 응답: ${j.error}` };
    return { ok: true, sheet: target, added: j.added ?? 1 };
  } catch (err) {
    return { ok: false, sheet: target, error: `웹훅 호출 실패: ${(err as Error).message}` };
  }
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

  const [kakao, parsed, allNames] = await Promise.all([
    searchNearby(COMPANY_COORDS, radiusM),
    loadRestaurants(),
    loadRestaurantNames(),
  ]);

  // 중복 비교 대상: 파싱본(좌표 O) + 원본 상호명(좌표 없는 스킵 행까지 커버)
  const existing: KnownPlace[] = [
    ...parsed.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng })),
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
    // 시트에 이미 있으면 중복 → 제외 (이름 완전일치=거리 무관, 부분일치=150m)
    if (isDuplicatePlace({ name: p.place_name, lat, lng }, existing)) {
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
