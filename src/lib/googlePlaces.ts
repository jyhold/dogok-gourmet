// ── 구글 Places API — 평점·리뷰수 조회 (v1.16) ──────────────
//
// 왜 필요한가: 카카오 로컬 API는 평점·리뷰수를 주지 않는다(응답 필드에 아예 없음).
// 격자 스캔으로 도보권 845곳을 다 찾을 수 있게 됐지만, 그대로 시트에 넣으면
// 미검증 수백 행이 큐레이션 DB를 덮어버린다 → 구글 평점으로 자동 선별한다.
//
// ⚠️ 비용 구조 (2026-07 확인)
//   Text Search **Enterprise** $35/1000 · 무료 월 1,000회  ← rating/userRatingCount는 Enterprise 등급
//   (Pro는 $32/1000·무료 5,000이지만 평점 필드가 없어 쓸 수 없다)
//
//   그래서 절대 규칙: **시트에 없는 신규 후보만** 조회하고, **탈락한 곳도 시트에 기록**한다.
//   탈락분을 안 남기면 매일 같은 후보를 재조회해 월 36,000회($1,225)가 된다.
//   호출 상한(maxCalls)은 그 사고를 막는 마지막 안전핀이다.
import type { Coords } from './types';
import { haversineMeters } from './geo';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/** 이 필드마스크가 SKU를 결정한다 — rating·userRatingCount 때문에 Enterprise로 과금된다 */
const FIELD_MASK = 'places.displayName,places.location,places.rating,places.userRatingCount';

/** 이름이 같아도 이 거리보다 멀면 다른 가게로 본다 */
const MATCH_DISTANCE_M = 120;

export interface PlaceRating {
  rating: number | null;
  reviews: number | null;
  /** 구글에서 매칭된 상호 (오매칭 점검용) */
  matchedName?: string;
  /** 매칭 실패 사유 */
  miss?: 'no-result' | 'too-far' | 'error';
}

function key(): string | undefined {
  return process.env.GOOGLE_PLACES_KEY;
}

export function googleEnabled(): boolean {
  return !!key();
}

/**
 * 상호 + 좌표로 구글 평점 조회 (1건 = Text Search Enterprise 1회 과금).
 * 좌표가 MATCH_DISTANCE_M 밖이면 다른 가게로 보고 실패 처리 — 오매칭이 시트에 들어가는 것보다 낫다.
 */
export async function fetchRating(name: string, at: Coords): Promise<PlaceRating> {
  const k = key();
  if (!k) return { rating: null, reviews: null, miss: 'error' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': k,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: name,
        languageCode: 'ko',
        regionCode: 'KR',
        maxResultCount: 3,
        // 좌표 주변으로 강하게 편향 — 동명 체인점이 엉뚱한 지점으로 매칭되는 것 방지
        locationBias: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: 200 } },
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[google] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { rating: null, reviews: null, miss: 'error' };
    }
    const j = (await res.json()) as {
      places?: {
        displayName?: { text: string };
        location?: { latitude: number; longitude: number };
        rating?: number;
        userRatingCount?: number;
      }[];
    };
    const places = j.places ?? [];
    if (places.length === 0) return { rating: null, reviews: null, miss: 'no-result' };

    // 좌표가 가장 가까운 후보 채택
    let best: (typeof places)[number] | null = null;
    let bestDist = Infinity;
    for (const p of places) {
      if (!p.location) continue;
      const d = haversineMeters(at, { lat: p.location.latitude, lng: p.location.longitude });
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best || bestDist > MATCH_DISTANCE_M) {
      return { rating: null, reviews: null, miss: 'too-far' };
    }
    return {
      rating: best.rating ?? null,
      reviews: best.userRatingCount ?? null,
      matchedName: best.displayName?.text,
    };
  } catch (err) {
    console.error('[google] 호출 실패:', (err as Error).message);
    return { rating: null, reviews: null, miss: 'error' };
  }
}

// ── 품질 게이트 ───────────────────────────────────────────

/** 시트 active=TRUE로 넣을 기준. env로 조정 가능(튜닝 후 고정). */
export interface QualityGate {
  minRating: number;
  minReviews: number;
  /** 지뢰 컷 — 이 평점 이하면 리뷰가 아무리 많아도 탈락 (많은 사람이 별로라고 한 곳) */
  badRating: number;
}

export function qualityGate(): QualityGate {
  return {
    minRating: Number(process.env.MIN_GOOGLE_RATING ?? 4.0),
    minReviews: Number(process.env.MIN_GOOGLE_REVIEWS ?? 200),
    badRating: Number(process.env.BAD_GOOGLE_RATING ?? 3.0),
  };
}

/**
 * 통과 판정.
 * ① **지뢰 컷**: 평점이 badRating(기본 3.0) 이하면 무조건 탈락 — 리뷰가 많다는 건 검증됐다는
 *    뜻인데도 평점이 낮으면 오히려 '많은 사람이 별로라고 한' 피해야 할 곳이다.
 * ② 그 위에서 통과: 평점 ≥ minRating **또는** 리뷰 ≥ minReviews.
 * 평점을 못 받은 곳(신규 오픈·매칭 실패)은 통과시키지 않는다.
 */
export function passesGate(r: PlaceRating, gate: QualityGate = qualityGate()): boolean {
  if (r.rating != null && r.rating <= gate.badRating) return false; // 지뢰 컷 (리뷰 수 무관)
  if (r.rating != null && r.rating >= gate.minRating) return true;
  if (r.reviews != null && r.reviews >= gate.minReviews) return true;
  return false;
}
