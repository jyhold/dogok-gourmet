// ── 예비 시트(candidates) 로더 (기획서 §12) ────────────────
// 카카오 격자 스캔이 쌓아두는 '미검증 후보' 탭. **룰렛은 이 시트를 절대 보지 않는다.**
// 오염(미검증 매장)과 비용(구글 조회)을 여기에 가둬두고, 검증 통과분만 restaurants로 승격한다.
import Papa from 'papaparse';
import type { Coords } from './types';

const TAB = () => process.env.GOOGLE_CANDIDATES_SHEET_TAB ?? 'candidates';

/** 시트 열 인덱스 (CANDIDATE_HEADER와 1:1) */
const COL = { name: 0, lat: 7, lng: 8, googleRating: 20, googleReviews: 21, verdict: 22, checkedAt: 23 };
export const CANDIDATE_COLS = 24;

/** verdict 상태 — 빈칸('')은 미검증 = 아직 비용이 나가지 않은 행 */
export type Verdict = '' | 'pass' | 'fail' | 'miss' | 'promoted';
const VERDICTS: Verdict[] = ['', 'pass', 'fail', 'miss', 'promoted'];

export interface CandidateRow {
  /** 시트 원본 24열 — 검증 결과를 채워 그대로 되쓰기(replace) 위해 손실 없이 보관 */
  raw: string[];
  name: string;
  lat: number;
  lng: number;
  googleRating: number | null;
  googleReviews: number | null;
  verdict: Verdict;
  checkedAt: string;
}

/** 아직 구글 조회를 안 한 행인가 (= 다음 검증에서 비용이 나갈 대상) */
export function isUnchecked(r: CandidateRow): boolean {
  return r.verdict === '';
}

export function coordsOf(r: CandidateRow): Coords {
  return { lat: r.lat, lng: r.lng };
}

function num(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * candidates 탭 원본 행 (헤더 제외). 한 번만 읽고 아래 두 용도가 나눠 쓴다.
 * 헤더 이름이 아니라 **열 순서**로 읽는다 — 승격·replace 때 원본 24열을 그대로 되써야 하므로
 * 배열이 header 모드보다 안전하다.
 *
 * ⚠️ gviz는 **없는 탭을 요청하면 404가 아니라 200 + 첫 번째 탭(restaurants) 내용**을 돌려준다.
 * 그대로 믿으면 restaurants 235행을 '미검증 후보'로 착각해 구글 조회비를 태우고, 되쓰기까지 갈 수 있다.
 * → 헤더로 정체를 확인한다. (Apps Script의 조용한 폴백과 같은 부류의 함정)
 */
async function fetchRows(sheetId: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    TAB(),
  )}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`candidates 시트 fetch 실패: ${res.status}`);
  const parsed = Papa.parse<string[]>(await res.text(), { header: false, skipEmptyLines: true });
  const rows = parsed.data;

  const header = (rows[0] ?? []).map((h) => (h ?? '').trim());
  const marker = header[COL.verdict];
  if (marker !== 'verdict') {
    throw new Error(
      `'${TAB()}' 탭이 없거나 헤더가 다릅니다 (W열이 'verdict'가 아니라 '${marker ?? '(빈칸)'}'). ` +
        `구글 시트는 없는 탭을 요청하면 첫 번째 탭 내용을 돌려주므로, 탭을 만들고 ` +
        `docs/candidates-setup.md의 헤더 24열을 A1에 붙여넣으세요.`,
    );
  }
  return rows.slice(1);
}

export interface CandidatesLoad {
  rows: CandidateRow[];
  /** 좌표 없는 행까지 포함한 전체 상호 — 중복 판정을 놓치지 않게 */
  allNames: string[];
}

/** candidates 전체 로드. 탭이 없으면 예외 → 호출부에서 안내. */
export async function loadCandidates(sheetId: string): Promise<CandidatesLoad> {
  const raws = await fetchRows(sheetId);
  const rows: CandidateRow[] = [];
  const allNames: string[] = [];

  for (const raw of raws) {
    const name = (raw[COL.name] ?? '').trim();
    if (!name) continue;
    allNames.push(name);

    const lat = num(raw[COL.lat]);
    const lng = num(raw[COL.lng]);
    if (lat == null || lng == null) continue; // 좌표 없으면 검증도 승격도 불가 (이름은 중복판정에 남김)

    const v = (raw[COL.verdict] ?? '').trim() as Verdict;
    rows.push({
      // 24열로 정규화 — 시트에서 뒤쪽 빈칸이 잘려 오는 경우가 있어 길이를 맞춰둔다
      raw: Array.from({ length: CANDIDATE_COLS }, (_, i) => raw[i] ?? ''),
      name,
      lat,
      lng,
      googleRating: num(raw[COL.googleRating]),
      googleReviews: num(raw[COL.googleReviews]),
      verdict: VERDICTS.includes(v) ? v : '',
      checkedAt: (raw[COL.checkedAt] ?? '').trim(),
    });
  }
  return { rows, allNames };
}

/** 검증 결과를 원본 행에 채워 넣은 새 24열 배열 (원본 불변) */
export function withVerdict(
  r: CandidateRow,
  patch: { googleRating: number | null; googleReviews: number | null; verdict: Verdict; checkedAt: string },
): string[] {
  const raw = [...r.raw];
  raw[COL.googleRating] = patch.googleRating == null ? '' : String(patch.googleRating);
  raw[COL.googleReviews] = patch.googleReviews == null ? '' : String(patch.googleReviews);
  raw[COL.verdict] = patch.verdict;
  raw[COL.checkedAt] = patch.checkedAt;
  return raw;
}

/** verdict만 교체 (승격 표시용) */
export function withVerdictOnly(raw: string[], verdict: Verdict): string[] {
  const next = [...raw];
  next[COL.verdict] = verdict;
  return next;
}

/** candidates 24열 → restaurants 20열 (승격 = 앞 20열 그대로) */
export function toRestaurantRow(raw: string[]): string[] {
  return raw.slice(0, 20);
}
