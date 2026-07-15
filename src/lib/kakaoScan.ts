// ── 카카오 45건 한계 우회: 적응형 격자 스캔 (병목 7·v1.16) ──
//
// 카카오 로컬 검색은 한 질의당 최대 45건(3페이지×15)만 준다. meta.total_count는 진짜 총계를
// 알려주지만 그 이상은 못 가져온다. 실측(군인공제회관 기준):
//   반경  200m →   37곳 (45 미만 → 전부 회수 가능)
//   반경 1300m →  844곳 → 45곳만 회수 (95% 실명)
//   반경 1500m → 1365곳 → 45곳만 회수
// → 영역을 잘게 쪼개 각 조각이 45건 미만이 되게 하면 전부 회수할 수 있다.
//
// 사각형 쿼드트리로 분할한다. 한 셀(정사각형)을 덮는 원의 반경 = 반변길이 × √2.
// total_count가 45를 넘는 셀만 4등분해 재귀 → 밀집 지역만 깊게 파고, 한산한 곳은 1회로 끝난다.
import type { Coords } from './types';
import type { KakaoPlace } from './mockData';
import { haversineMeters } from './geo';
import { MOCK_KAKAO_PLACES, MOCK_KAKAO_CAFES } from './mockData';

/** 한 질의로 회수 가능한 최대치 (카카오 하드 한계) */
const PAGE_CAP = 45;
/** 이 반변길이(m) 밑으로는 더 쪼개지 않는다 — 무한 재귀·호출 폭발 방지 */
const MIN_HALF_SIDE_M = 60;
/** 동시 호출 수 — 너무 높이면 카카오가 429를 준다 */
const CONCURRENCY = 6;

const LAT_M_PER_DEG = 111_320;
const lngMPerDeg = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export interface ScanStats {
  /** 실제 호출 수 */
  calls: number;
  /** 분할한 셀 수 */
  cells: number;
  /** 45건 상한에 걸렸는데 더 못 쪼갠 셀 (여기선 일부 누락 가능) */
  saturated: number;
  /** 카카오가 알려준 총계(최상위 셀 기준, 참고용) */
  reportedTotal: number;
}

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

interface Meta {
  total_count: number;
  is_end: boolean;
}

async function fetchPage(
  center: Coords,
  radius: number,
  page: number,
  groupCode: string,
  key: string,
): Promise<{ docs: KakaoPlace[]; meta: Meta }> {
  const params = new URLSearchParams({
    category_group_code: groupCode,
    x: String(center.lng),
    y: String(center.lat),
    radius: String(Math.round(radius)),
    size: '15',
    page: String(page),
    sort: 'distance',
  });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`카카오 ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { documents: KakaoPlace[]; meta: Meta };
  return { docs: j.documents, meta: j.meta };
}

/** 배열을 n개씩 끊어 순차 실행 (동시성 제한) */
async function inBatches<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

interface Cell {
  center: Coords;
  halfSide: number;
}

/** 정사각 셀을 4등분 */
function quarters(cell: Cell): Cell[] {
  const h = cell.halfSide / 2;
  const dLat = h / LAT_M_PER_DEG;
  const dLng = h / lngMPerDeg(cell.center.lat);
  return [
    { center: { lat: cell.center.lat + dLat, lng: cell.center.lng - dLng }, halfSide: h },
    { center: { lat: cell.center.lat + dLat, lng: cell.center.lng + dLng }, halfSide: h },
    { center: { lat: cell.center.lat - dLat, lng: cell.center.lng - dLng }, halfSide: h },
    { center: { lat: cell.center.lat - dLat, lng: cell.center.lng + dLng }, halfSide: h },
  ];
}

/**
 * 반경 내 매장을 '전부' 회수 (45건 한계 우회).
 * @param center 중심
 * @param radiusM 반경(m) — 이 원을 덮는 정사각형에서 시작해 필요한 곳만 쪼갠다
 * @param groupCode FD6=음식점 / CE7=카페
 * @param maxCalls 호출 상한 (서버리스 타임아웃·쿼터 안전장치). 도달하면 거기까지만.
 */
export async function scanAll(
  center: Coords,
  radiusM: number,
  groupCode = 'FD6',
  maxCalls = 400,
): Promise<{ places: KakaoPlace[]; stats: ScanStats }> {
  const stats: ScanStats = { calls: 0, cells: 0, saturated: 0, reportedTotal: 0 };

  if (useMock()) {
    const source = groupCode === 'CE7' ? MOCK_KAKAO_CAFES : MOCK_KAKAO_PLACES;
    const places = source.filter(
      (p) => haversineMeters(center, { lat: Number(p.y), lng: Number(p.x) }) <= radiusM,
    );
    return { places, stats: { ...stats, reportedTotal: places.length } };
  }

  const key = process.env.KAKAO_REST_KEY;
  if (!key) throw new Error('KAKAO_REST_KEY 미설정');

  const byId = new Map<string, KakaoPlace>();
  // 원을 덮는 정사각형에서 시작
  let queue: Cell[] = [{ center, halfSide: radiusM }];

  while (queue.length > 0 && stats.calls < maxCalls) {
    const next: Cell[] = [];
    const budget = Math.max(0, maxCalls - stats.calls);
    const batch = queue.slice(0, budget);

    const results = await inBatches(batch, CONCURRENCY, async (cell) => {
      const radius = cell.halfSide * Math.SQRT2; // 셀 전체를 덮는 원
      try {
        const r = await fetchPage(cell.center, radius, 1, groupCode, key);
        return { cell, ...r };
      } catch (err) {
        console.error('[scan] 셀 실패:', (err as Error).message);
        return null;
      }
    });
    stats.calls += batch.length;

    for (const r of results) {
      if (!r) continue;
      stats.cells++;
      if (queue.length === 1 && stats.reportedTotal === 0) stats.reportedTotal = r.meta.total_count;
      r.docs.forEach((d) => byId.set(d.id, d));

      if (r.meta.total_count > PAGE_CAP) {
        // 45건에 걸린다 → 더 쪼갠다. 더 못 쪼개면 45건만 건지고 포기(기록).
        if (r.cell.halfSide > MIN_HALF_SIDE_M) {
          next.push(...quarters(r.cell));
          continue; // 자식 셀이 전부 훑을 것이므로 이 셀의 나머지 페이지는 안 받는다
        }
        stats.saturated++;
      }
      // 45건 이하 → 남은 페이지까지 받아서 이 셀은 완결
      if (!r.meta.is_end) {
        const pages = [2, 3];
        const more = await inBatches(pages, CONCURRENCY, async (p) => {
          try {
            return await fetchPage(r.cell.center, r.cell.halfSide * Math.SQRT2, p, groupCode, key);
          } catch {
            return null;
          }
        });
        stats.calls += pages.length;
        for (const m of more) m?.docs.forEach((d) => byId.set(d.id, d));
      }
    }
    queue = next;
  }

  // 셀이 원 밖까지 덮으므로 반경으로 최종 컷
  const places = [...byId.values()].filter(
    (p) => haversineMeters(center, { lat: Number(p.y), lng: Number(p.x) }) <= radiusM,
  );
  return { places, stats };
}
