// ── 통계 이벤트 읽기 (구글 시트 stats 탭) ──────────────────
// gviz CSV → StatRow[]. 대시보드 새로고침이 잦을 수 있어 짧게(1분) 캐시한다.
import Papa from 'papaparse';
import { rowToStat, type StatRow } from './stats';
import { MOCK_STAT_ROWS } from './mockData';

const CACHE_TTL_MS = 60 * 1000;

let cache: { rows: StatRow[]; at: number } | null = null;

function useMock(): boolean {
  return (process.env.USE_MOCK ?? 'TRUE').toUpperCase() === 'TRUE';
}

/** stats 탭 전체 이벤트 로드 (1분 캐시). 탭이 없거나 비어 있으면 빈 배열. */
export async function loadStats(): Promise<StatRow[]> {
  if (useMock()) return MOCK_STAT_ROWS;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID 미설정');
  const tab = process.env.GOOGLE_STATS_SHEET_TAB ?? 'stats';

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    tab,
  )}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`stats 시트 fetch 실패: ${res.status} (탭이 없을 수 있음)`);

  const parsed = Papa.parse<Record<string, string>>(await res.text(), {
    header: true,
    skipEmptyLines: true,
  });
  const rows: StatRow[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const s = rowToStat(row);
    if (s) rows.push(s);
    else skipped++;
  }
  if (skipped > 0) console.warn(`[stats] 형식 불량으로 건너뛴 행 ${skipped}개`);

  cache = { rows, at: Date.now() };
  return rows;
}

/** 대시보드에서 강제 새로고침 시 캐시 무효화 */
export function invalidateStatsCache(): void {
  cache = null;
}
