import type { Candidate, PriceTier } from './types';

// ── 프론트 필터 + 가중치 추첨 (기획서 §7.2 step 3~4) ─────────

export interface FrontFilter {
  /** 제외할 하위 카테고리 */
  excludedSubs: string[];
  /** 예산 필터 (null이면 미적용 — 번개/팀회식) */
  priceTier: PriceTier | null;
  /** 세션 내 이미 나온 후보 id */
  seenIds: string[];
}

/** 후보군에 프론트 필터 적용 */
export function applyFilters(candidates: Candidate[], f: FrontFilter): Candidate[] {
  const seen = new Set(f.seenIds);
  const excluded = new Set(f.excludedSubs);
  return candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    if (excluded.has(c.categorySub)) return false;
    if (f.priceTier && c.priceTier !== f.priceTier) return false;
    return true;
  });
}

/** 미식가 인증 맛집 우선 부스트 배율 */
export const VISITED_BOOST = 6;

/**
 * '미식가 인증 맛집 우선' 옵션 적용 — visited 후보의 가중치를 크게 높인다.
 * 하드 필터가 아니라 확률 부스트라, 인증 맛집이 적어도 후보가 비지 않는다.
 */
export function boostVisited(candidates: Candidate[], on: boolean): Candidate[] {
  if (!on) return candidates;
  return candidates.map((c) =>
    c.visited ? { ...c, weight: c.weight * VISITED_BOOST } : c,
  );
}

/**
 * 후식 '미식가 추천 우선' 옵션 — recommended 후보의 가중치를 크게 높인다.
 * boostVisited의 후식판(평점 대신 추천 T/F 기준). 확률 부스트, 하드 필터 아님.
 */
export function boostRecommended(candidates: Candidate[], on: boolean): Candidate[] {
  if (!on) return candidates;
  return candidates.map((c) =>
    c.recommended ? { ...c, weight: c.weight * VISITED_BOOST } : c,
  );
}

/** 가중치 랜덤 1곳 추첨. 후보 없으면 null. */
export function weightedPick(candidates: Candidate[], rng: () => number = Math.random): Candidate | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((s, c) => s + Math.max(0.01, c.weight), 0);
  let r = rng() * total;
  for (const c of candidates) {
    r -= Math.max(0.01, c.weight);
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}
