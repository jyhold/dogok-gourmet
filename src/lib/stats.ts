// ── 관리자 통계 (기획서 §11) ────────────────────────────────
// 방문·룰렛·신고·지도클릭·재추첨 이벤트를 구글 시트 stats 탭에 append하고, 읽어서 집계한다.
// 쓰기는 statsSink.ts(서버), 읽기·집계는 여기. 순수 함수라 테스트 가능.

// 'like'는 폐지(→ 'report'로 대체)됐지만, 과거 시트 행 파싱이 깨지지 않게 타입·목록엔 남겨둔다.
// 신규 집계·표시에서는 쓰지 않는다.
export type StatEvent = 'visit' | 'spin' | 'like' | 'map' | 'reject' | 'report';

export const STAT_EVENTS: StatEvent[] = ['visit', 'spin', 'like', 'map', 'reject', 'report'];

/** 신고 사유 (detail의 reason=...). 폐점 / 점심 미영업 / 기타 */
export type ReportReason = 'closed' | 'no_lunch' | 'other';

/** stats 탭 헤더 7열 (A~G, 시트 1행과 동일) */
export const STATS_HEADER = ['ts', 'event', 'visitor', 'mode', 'place', 'category_sub', 'detail'];

export interface StatRow {
  /** KST 타임스탬프 'YYYYMMDD-HHmmss' */
  ts: string;
  event: StatEvent;
  visitor: string;
  mode: string;
  place: string;
  categorySub: string;
  detail: string;
}

// ── 타임스탬프 ────────────────────────────────────────────
// 시트는 '2026-07-15T10:23:45Z'류를 날짜 셀로 자동 변환해버리고, gviz로 되읽으면
// 로케일 형식('2026. 7. 15 오전 10:23')이 돌아와 파싱이 깨진다.
// → 시트가 날짜로도 숫자로도 해석하지 못하는 'YYYYMMDD-HHmmss'로 고정한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const p2 = (n: number) => String(n).padStart(2, '0');

/** Date → KST 'YYYYMMDD-HHmmss' */
export function toKstStamp(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS); // UTC 게터로 KST 값 읽기
  return (
    `${k.getUTCFullYear()}${p2(k.getUTCMonth() + 1)}${p2(k.getUTCDate())}` +
    `-${p2(k.getUTCHours())}${p2(k.getUTCMinutes())}${p2(k.getUTCSeconds())}`
  );
}

/** 'YYYYMMDD-HHmmss' → 'YYYY-MM-DD' (KST 기준 일자 버킷). 형식이 아니면 null */
export function stampToDate(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-\d{6}$/.exec((ts ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ── detail 인코딩 ('respin=1;price=보통;dist=walk') ─────────
export function formatDetail(obj: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 1 : 0) : v}`)
    .join(';');
}

export function parseDetail(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** 탭·개행 제거 (시트 셀 오염 방지) */
function cell(v: string | undefined): string {
  return (v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export interface TrackInput {
  event: StatEvent;
  visitor: string;
  mode?: string;
  place?: string;
  categorySub?: string;
  detail?: string;
}

/** 이벤트 → stats 시트 7열 행 */
export function buildStatsRow(e: TrackInput, now: Date): string[] {
  return [
    toKstStamp(now),
    e.event,
    cell(e.visitor).slice(0, 40),
    cell(e.mode),
    cell(e.place).slice(0, 80),
    cell(e.categorySub),
    cell(e.detail).slice(0, 120),
  ];
}

/** gviz CSV 행(헤더명 키) → StatRow. 형식 불량이면 null */
export function rowToStat(row: Record<string, string>): StatRow | null {
  const ts = (row.ts ?? '').trim();
  const event = (row.event ?? '').trim() as StatEvent;
  if (!stampToDate(ts) || !STAT_EVENTS.includes(event)) return null;
  return {
    ts,
    event,
    visitor: (row.visitor ?? '').trim(),
    mode: (row.mode ?? '').trim(),
    place: (row.place ?? '').trim(),
    categorySub: (row.category_sub ?? '').trim(),
    detail: (row.detail ?? '').trim(),
  };
}

// ── 집계 ──────────────────────────────────────────────────
export interface Counted {
  key: string;
  count: number;
}

export interface StatsSummary {
  visitors: number;
  visitorsToday: number;
  visits: number;
  spins: number;
  maps: number;
  respins: number;
  /** '다시 돌리기'로 버려진 이벤트 수 (기피 신호) */
  rejects: number;
  /** 신고(폐점·점심영업X 등) 이벤트 수 */
  reports: number;
  mapRate: number;
  respinRate: number;
  /** 버림 ÷ 룰렛 (0~1). 사용자가 결과를 얼마나 반려하는지 */
  rejectRate: number;
  daily: { date: string; visitors: number; spins: number }[];
  byMode: Counted[];
  topPlaces: { key: string; count: number }[];
  /** 기피 식당 랭킹 — count=버려진 횟수, spins=노출(당첨) 횟수, rate=count/spins */
  topRejected: { key: string; count: number; spins: number; rate: number }[];
  /** 신고 TOP 매장 — count=총 신고, 사유별(폐점/점심X/기타) 분해. 수기 제외 판단용 */
  topReported: { key: string; count: number; closed: number; noLunch: number; other: number }[];
  byCategory: Counted[];
  byPrice: Counted[];
  byDistance: Counted[];
  /** 인증우선 옵션 on/off */
  prioritize: { on: number; off: number };
  lastEventAt: string | null;
  totalRows: number;
}

function tally(items: string[]): Counted[] {
  const m = new Map<string, number>();
  for (const i of items) if (i) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

const rate = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * 이벤트 행 → 대시보드 지표.
 * @param todayKst 'YYYY-MM-DD' (KST 오늘). 호출부에서 주입해 테스트 가능하게.
 */
export function aggregate(rows: StatRow[], todayKst: string): StatsSummary {
  const visits = rows.filter((r) => r.event === 'visit');
  const spins = rows.filter((r) => r.event === 'spin');
  const maps = rows.filter((r) => r.event === 'map');
  const rejects = rows.filter((r) => r.event === 'reject');
  const reports = rows.filter((r) => r.event === 'report');

  // 방문자 = visitor distinct. visit 이벤트가 없더라도 다른 이벤트의 visitor는 방문한 것.
  const allVisitors = new Set(rows.map((r) => r.visitor).filter(Boolean));
  const todayVisitors = new Set(
    rows.filter((r) => stampToDate(r.ts) === todayKst).map((r) => r.visitor).filter(Boolean),
  );

  // 일별: 방문자(distinct) + 룰렛 수
  const dayMap = new Map<string, { v: Set<string>; s: number }>();
  for (const r of rows) {
    const d = stampToDate(r.ts);
    if (!d) continue;
    const e = dayMap.get(d) ?? { v: new Set<string>(), s: 0 };
    if (r.visitor) e.v.add(r.visitor);
    if (r.event === 'spin') e.s++;
    dayMap.set(d, e);
  }
  const daily = [...dayMap.entries()]
    .map(([date, e]) => ({ date, visitors: e.v.size, spins: e.s }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const details = spins.map((s) => parseDetail(s.detail));
  const respins = details.filter((d) => d.respin === '1').length;

  const topPlaces = tally(spins.map((s) => s.place)).slice(0, 10);

  // 기피 식당 — '다시 돌리기'로 버려진 횟수. 노출(당첨) 대비 기피율을 함께 붙여
  // '우연히 한 번 버려진 곳'과 '자주 떠도 자주 버려지는 지뢰'를 구분한다.
  const spinByPlace = new Map<string, number>();
  for (const s of spins) spinByPlace.set(s.place, (spinByPlace.get(s.place) ?? 0) + 1);
  const topRejected = tally(rejects.map((r) => r.place))
    .slice(0, 10)
    .map((p) => {
      const placeSpins = spinByPlace.get(p.key) ?? 0;
      return { ...p, spins: placeSpins, rate: rate(p.count, placeSpins) };
    });

  // 신고 TOP 매장 — 폐점·점심영업X 신고를 가게별로 집계 + 사유(reason) 분해.
  // 관리자가 수기로 룰렛에서 제외할 문제 매장을 찾는 용도.
  const reportReasons = new Map<string, { closed: number; noLunch: number; other: number }>();
  for (const r of reports) {
    const e = reportReasons.get(r.place) ?? { closed: 0, noLunch: 0, other: 0 };
    const reason = parseDetail(r.detail).reason;
    if (reason === 'closed') e.closed++;
    else if (reason === 'no_lunch') e.noLunch++;
    else e.other++; // 사유 없음·기타 모두 other로
    reportReasons.set(r.place, e);
  }
  const topReported = tally(reports.map((r) => r.place))
    .slice(0, 10)
    .map((p) => ({
      ...p,
      ...(reportReasons.get(p.key) ?? { closed: 0, noLunch: 0, other: 0 }),
    }));

  const lastTs = rows.map((r) => r.ts).sort().at(-1) ?? null;

  return {
    visitors: allVisitors.size,
    visitorsToday: todayVisitors.size,
    visits: visits.length,
    spins: spins.length,
    maps: maps.length,
    respins,
    rejects: rejects.length,
    reports: reports.length,
    mapRate: rate(maps.length, spins.length),
    respinRate: rate(respins, spins.length),
    rejectRate: rate(rejects.length, spins.length),
    daily,
    byMode: tally(spins.map((s) => s.mode)),
    topPlaces,
    topRejected,
    topReported,
    byCategory: tally(spins.map((s) => s.categorySub)),
    byPrice: tally(details.map((d) => d.price ?? '')),
    byDistance: tally(details.map((d) => d.dist ?? '')),
    prioritize: {
      on: details.filter((d) => d.boost === '1').length,
      off: details.filter((d) => d.boost === '0').length,
    },
    lastEventAt: lastTs,
    totalRows: rows.length,
  };
}
