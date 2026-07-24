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

/**
 * 이 필드마스크가 SKU를 결정한다 — rating·userRatingCount 때문에 Enterprise로 과금된다.
 * regularOpeningHours도 **같은 Enterprise 등급**이라 얹어도 비용·호출 수는 그대로다(공짜로 추가됨).
 * (reviews 텍스트만 한 등급 위 Enterprise+Atmosphere라 쓰지 않는다.)
 */
const FIELD_MASK =
  'places.displayName,places.location,places.rating,places.userRatingCount,places.regularOpeningHours';

/** 이름이 같아도 이 거리보다 멀면 다른 가게로 본다 */
const MATCH_DISTANCE_M = 120;

export interface PlaceRating {
  rating: number | null;
  reviews: number | null;
  /**
   * 평일(월~금) 중 가장 이른 오픈 시각(자정 기준 분). 예: 11:00 → 660, 12:00 → 720.
   * 저녁 장사만 하는 곳(전부 17:00 오픈)을 점심 추천에서 거르는 데 쓴다.
   * 구글이 영업시간을 안 주면(신규·소규모) null → 판정 안 함(기존 게이트만 적용).
   */
  weekdayOpenMinute?: number | null;
  /** 구글에서 매칭된 상호 (오매칭 점검용) */
  matchedName?: string;
  /** 매칭 실패 사유 */
  miss?: 'no-result' | 'too-far' | 'error';
}

/** 구글 regularOpeningHours.periods 한 점 (day 0=일 … 6=토) */
interface OpenPoint {
  day?: number;
  hour?: number;
  minute?: number;
}

/**
 * 평일(1=월 … 5=금) 오픈 시각 중 **가장 이른 분**. 평일 데이터가 없으면 null.
 * 저녁 장사만 하는 곳은 평일 오픈이 전부 오후라 값이 크게 나오고, 24시간·이른 오픈은 작게 나온다.
 * 24시간 매장은 구글이 close 없는 단일 period(일요일 00:00)로 주므로 평일 값이 없어 null → 통과 처리된다(옳음).
 */
function earliestWeekdayOpenMinute(periods: { open?: OpenPoint }[] | undefined): number | null {
  if (!periods || periods.length === 0) return null;
  let min: number | null = null;
  for (const p of periods) {
    const o = p.open;
    if (!o || o.day == null || o.hour == null) continue;
    if (o.day < 1 || o.day > 5) continue; // 평일만 — 직장인 점심 앱이라 주말은 무시
    const m = o.hour * 60 + (o.minute ?? 0);
    if (min == null || m < min) min = m;
  }
  return min;
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
        regularOpeningHours?: { periods?: { open?: OpenPoint }[] };
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
      weekdayOpenMinute: earliestWeekdayOpenMinute(best.regularOpeningHours?.periods),
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
  /** 평점으로 통과할 때 요구하는 최소 리뷰 수 — 리뷰 1~2개짜리 ★5는 표본이 없는 것 */
  minRatingReviews: number;
  /** 지뢰 컷 — 이 평점 이하면 리뷰가 아무리 많아도 탈락 (많은 사람이 별로라고 한 곳) */
  badRating: number;
  /**
   * 점심 오픈 컷 — 평일 오픈이 이 시각(자정 기준 분)보다 늦으면 점심 부적합.
   * 기본 720(=12:00). 저녁 장사만 하는 곳을 점심 룰렛에서 사전에 거른다.
   */
  lunchOpenBy: number;
}

/** "HH:MM"(예 "12:00") 또는 분 단위 숫자를 자정 기준 분으로. 파싱 실패 시 dflt. */
function parseClockToMinutes(v: string | undefined, dflt: number): number {
  if (!v) return dflt;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function qualityGate(): QualityGate {
  return {
    minRating: Number(process.env.MIN_GOOGLE_RATING ?? 4.0),
    minReviews: Number(process.env.MIN_GOOGLE_REVIEWS ?? 200),
    minRatingReviews: Number(process.env.MIN_RATING_REVIEWS ?? 10),
    badRating: Number(process.env.BAD_GOOGLE_RATING ?? 3.0),
    lunchOpenBy: parseClockToMinutes(process.env.LUNCH_OPEN_BY, 12 * 60),
  };
}

/**
 * 통과 판정.
 * ① **지뢰 컷**: 평점이 badRating(기본 3.0) 이하면 무조건 탈락 — 리뷰가 많다는 건 검증됐다는
 *    뜻인데도 평점이 낮으면 오히려 '많은 사람이 별로라고 한' 피해야 할 곳이다.
 * ② 리뷰 ≥ minReviews(200) 이면 통과 — 표본이 충분히 크면 평점이 좀 낮아도 유명한 곳.
 * ③ 평점 ≥ minRating(4.0) **그리고** 리뷰 ≥ minRatingReviews(10) 이면 통과.
 *    평점만으로 통과시키되 리뷰 하한을 둬서, 리뷰 1~2개짜리 ★5(표본 없음)를 거른다.
 * 평점을 못 받은 곳(신규 오픈·매칭 실패)은 통과시키지 않는다.
 */
export function passesGate(r: PlaceRating, gate: QualityGate = qualityGate()): boolean {
  if (r.rating != null && r.rating <= gate.badRating) return false; // ① 지뢰 컷 (리뷰 수 무관)
  if (r.reviews != null && r.reviews >= gate.minReviews) return true; // ② 리뷰 많으면 통과
  if (r.rating != null && r.rating >= gate.minRating && (r.reviews ?? 0) >= gate.minRatingReviews) {
    return true; // ③ 평점 좋고 + 리뷰 하한 충족
  }
  return false;
}

/**
 * 점심에 부적합할 만큼 늦게 여는가 — 평일 오픈이 gate.lunchOpenBy(기본 12:00)보다 늦으면 true.
 * **품질 게이트와 독립**이다: passesGate(맛집이냐)로 먼저 거른 뒤, 통과한 곳에만 이 컷을 적용해
 * '좋은 집인데 점심엔 안 여는 곳'을 verdict=late로 따로 뽑아낸다.
 * 영업시간을 못 받은 곳(weekdayOpenMinute=null)은 판정하지 않는다 → 통과(데이터 없다고 좋은 집을 버리지 않음).
 * 정각 경계는 포함(12:00 오픈은 통과, 12:01부터 late).
 */
export function opensTooLate(r: PlaceRating, gate: QualityGate = qualityGate()): boolean {
  if (r.weekdayOpenMinute == null) return false;
  return r.weekdayOpenMinute > gate.lunchOpenBy;
}
