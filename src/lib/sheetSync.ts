// ── 카카오 신규 식당 → 예비 시트(candidates) 자동 추가 (기획서 §12) ──
// /api/sync 에서 호출. Vercel Cron이 하루 1회 트리거.
//
// v1.16 두 가지가 바뀌었다:
//  1) searchNearby(45건 상한) → scanAll(적응형 격자). 반경 1.3km에 실제로 844곳이 있는데
//     45곳만 보고 있었다 → 신규 매장을 사실상 못 찾던 원인.
//  2) append 대상 restaurants → **candidates**. 손으로 큐레이션한 DB에 미검증 수백 행이
//     쏟아지지 않도록, 스캔 결과는 예비 시트에 가둔다. 룰렛은 candidates를 보지 않는다.
//     구글 평점 검증을 통과한 것만 scripts/verify-candidates.mts가 restaurants로 승격한다.
import { COMPANY_COORDS, haversineMeters, inAllowedDistrict } from './geo';
import { scanAll, type ScanStats } from './kakaoScan';
import { loadRestaurants, loadRestaurantNames } from './sheet';
import { loadCandidates } from './candidatesSheet';
import { classifyKakao, buildCandidateRow } from './classify';
import { isDuplicatePlace, type KnownPlace } from './syncDedupe';
import { postRows, postRowsChunked } from './sheetWebhook';

/** 예비 시트 스캔 기본 반경 — 따릉이 모드(2km)까지 커버 */
export const SCAN_RADIUS_M = 2000;

export interface SyncResult {
  scanned: number; // 격자 스캔으로 회수한 수 (기존 방식이면 45가 상한이었다)
  fresh: number; // 시트에 없어 새로 추가할 수
  added: number; // 실제 append된 수
  skipped: number; // 중복/필터로 제외된 수
  /** 스캔 관측치 — 호출 수·포화 셀로 한계 도달 여부를 본다 */
  scan?: ScanStats;
  /** dry=1이면 쓰지 않고 여기까지만 */
  dry?: boolean;
  error?: string;
}

/**
 * 웹훅 쓰기 경로 점검용 — 표시용 테스트 행 1개를 대상 탭에 append.
 * active=FALSE라 앱 룰렛엔 안 나옴. 확인 후 시트에서 그 행만 삭제하면 됨.
 * @param target 'restaurants'(기본) | 'coffee'
 */
export async function pingWebhook(
  target: 'restaurants' | 'coffee' | 'candidates' = 'restaurants',
): Promise<{ ok: boolean; requested: string; wroteTo?: string; added?: number; error?: string }> {
  // active=FALSE → 앱에 미노출. name에 눈에 띄는 표식. 각 시트 헤더 열수에 맞춤.
  const restaurantRow = [
    '__동기화_테스트__', '기타', '기타', '', '보통', '',
    '웹훅 테스트 행 — 확인 후 삭제하세요', '37.4891', '127.0529', '',
    'FALSE', '1', '둘다', 'FALSE', '', '', 'FALSE', 'FALSE', '', '',
  ];
  const testRow =
    target === 'coffee'
      ? // coffee 14열: name,category_sub,signature_menu,price_note,address,lat,lng,comment,active,weight,phone,visited,recommended,아아INDEX
        [
          '__동기화_테스트__', '커피·음료', '', '', '웹훅 테스트 행 — 확인 후 삭제하세요',
          '37.4891', '127.0529', '', 'FALSE', '1', '', 'FALSE', 'FALSE', '',
        ]
      : target === 'candidates'
        ? [...restaurantRow, '', '', '', ''] // candidates 24열
        : restaurantRow;

  const res = await postRows(target, [testRow], 'append');
  return { ok: res.ok, requested: target, wroteTo: res.wroteTo, added: res.added, error: res.error };
}

/** 중복 판정 대상 = restaurants + candidates 양쪽. 예비에 이미 있는 걸 또 넣지 않게. */
async function loadKnownPlaces(): Promise<{ known: KnownPlace[]; candidatesError?: string }> {
  const [parsed, allNames] = await Promise.all([loadRestaurants(), loadRestaurantNames()]);
  // 파싱본(좌표 O) + 원본 상호명(좌표 없는 스킵 행까지 커버)
  const known: KnownPlace[] = [
    ...parsed.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng })),
    ...allNames.map((name) => ({ name })),
  ];

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return { known };
  try {
    const c = await loadCandidates(sheetId);
    known.push(...c.rows.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng })));
    known.push(...c.allNames.map((name) => ({ name })));
    return { known };
  } catch (err) {
    // 탭이 아직 없는 상태 — restaurants 기준으로만 판정하되 사실대로 알린다.
    // (이 상태로 append하면 매일 같은 후보가 중복 적재되므로 호출부가 막아야 한다)
    return { known, candidatesError: (err as Error).message };
  }
}

/**
 * 카카오 격자 스캔 → restaurants·candidates 어디에도 없는 신규만 예비 시트에 append.
 * 잡음 필터(카페 제외, 치킨·호프=저녁)는 시드와 동일 로직(classifyKakao) 재사용.
 * @param dry true면 시트에 쓰지 않고 집계만 (탭·Apps Script 준비 전 점검용)
 */
export async function syncNewRestaurants(radiusM = SCAN_RADIUS_M, dry = false): Promise<SyncResult> {
  if (!dry && (!process.env.SHEET_WEBHOOK_URL || !process.env.SHEET_WEBHOOK_SECRET)) {
    return { scanned: 0, fresh: 0, added: 0, skipped: 0, error: 'SHEET_WEBHOOK_URL/SECRET 미설정' };
  }

  const [scan, knownLoad] = await Promise.all([
    scanAll(COMPANY_COORDS, radiusM, 'FD6'),
    loadKnownPlaces(),
  ]);
  const { places, stats } = scan;

  let skipped = 0;
  const rows: string[][] = [];
  for (const p of places) {
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
    // 이미 아는 곳이면 제외 (이름 완전일치=거리 무관, 부분일치=150m)
    if (isDuplicatePlace({ name: p.place_name, lat, lng }, knownLoad.known)) {
      skipped++;
      continue;
    }
    rows.push(buildCandidateRow(p, cls.mealType));
  }

  const base = { scanned: places.length, fresh: rows.length, skipped, scan: stats };

  if (dry) return { ...base, added: 0, dry: true, error: knownLoad.candidatesError };

  // candidates를 못 읽는데 쓰기부터 하면 매일 같은 후보가 중복 적재된다 → 중단.
  if (knownLoad.candidatesError) {
    return {
      ...base,
      added: 0,
      error: `candidates 탭을 읽지 못해 중단했습니다(중복 적재 방지) — ${knownLoad.candidatesError}`,
    };
  }
  if (rows.length === 0) return { ...base, added: 0 };

  // 첫 스캔은 2,000행이 넘을 수 있어 나눠 보낸다
  const res = await postRowsChunked('candidates', rows);
  return { ...base, added: res.added ?? 0, error: res.ok ? undefined : res.error };
}
