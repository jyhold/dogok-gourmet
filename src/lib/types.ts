// ── 도메인 타입 정의 ──────────────────────────────────────

/**
 * 식사 모드.
 * - lunch-solo / lunch-group: 점심(군인공제회관 고정 시작점)
 * - dessert: 후식(하위 분기 없음, 현재 위치 반경 500m — 위치기반)
 */
export type Mode = 'lunch-solo' | 'lunch-group' | 'dessert';

export type MealType = '점심' | '저녁' | '둘다';

/** 예산 등급. '회식' = 인당 5만+α */
export type PriceTier = '가성비' | '보통' | '플렉스' | '회식';

/** 거리 필터 (이동수단) */
export type DistanceMode = 'walk' | 'bike' | 'taxi';

// ── 이동수단별 거리 밴드 (군인공제회관 직선거리, m) ──────────
// access_mode가 없는 매장은 이 밴드로 '단 하나의 모드'에만 배정된다(서로 겹치지 않음).
// distanceM은 Math.round된 정수라 700/701, 1500/1501 경계에 빈틈이 없다.
export const DISTANCE_BANDS: Record<DistanceMode, { min: number; max: number }> = {
  walk: { min: 0, max: 700 },
  bike: { min: 701, max: 1500 },
  taxi: { min: 1501, max: 3000 },
};

// 카카오 반경 검색 상한(m). 각 모드 밴드의 최댓값이면 그 밴드를 모두 덮는다.
export const DISTANCE_METERS: Record<DistanceMode, number> = {
  walk: DISTANCE_BANDS.walk.max,
  bike: DISTANCE_BANDS.bike.max,
  taxi: DISTANCE_BANDS.taxi.max,
};

// 후식 모드 반경(직선거리, m). 소스별 차등 + 결과 부족 시 확장.
/** 현재 위치(브라우저 Geolocation) 기준 — 식후 바로 근처라 촘촘하게 */
export const DESSERT_RADIUS_LOCATION_M = 300;
/** 군인공제회관 폴백 기준(위치 거부·서비스지역 밖) */
export const DESSERT_RADIUS_COMPANY_M = 500;
/** 결과 부족 시 확장 반경 */
export const DESSERT_RADIUS_EXPANDED_M = 1000;
/** 확장 트리거: base 반경 후보가 이 수 미만이면 반경을 넓힌다 */
export const DESSERT_MIN_RESULTS = 3;

/** 관리자DB(구글 시트) 한 행 = 큐레이션된 맛집 */
export interface Restaurant {
  name: string;
  categoryMain: string;
  categorySub: string;
  signatureMenu: string;
  priceTier: PriceTier;
  priceNote: string;
  address: string;
  lat: number;
  lng: number;
  comment: string;
  active: boolean;
  weight: number;
  mealType: MealType;
  groupSeating: boolean;
  groupCapacity?: number;
  phone?: string;
  soloFriendly: boolean;
  /** 관리자 지정 최소 이동수단 (시트 access_mode 1/2/3). 있으면 직선거리 대신 이 등급으로 노출 판정. 없으면 직선거리 */
  accessMode?: DistanceMode;
  /** 관리자(미식가) 직접 방문 검증 여부 (미기입=미방문) */
  visited?: boolean;
  /** 미식가 주관적 평점 (0~10, 10점 단위 저장. 표시는 ÷2 = 별 0~5) */
  rating?: number;
}

/** 룰렛 후보 (관리자DB + 카카오 결과 통합 표현) */
export interface Candidate {
  id: string;
  name: string;
  categoryMain: string;
  categorySub: string;
  /** 관리자DB 큐레이션 여부 (👑 배지) */
  curated: boolean;
  lat: number;
  lng: number;
  address: string;
  /** 기준점으로부터 직선거리 보정치 (m) */
  distanceM: number;
  walkMinutes: number;
  /** 예산 등급 (관리자DB=정확, 카카오=추정) */
  priceTier: PriceTier;
  /** 예산이 추정치인지 (UI에 ~ 표기) */
  priceEstimated: boolean;
  priceNote?: string;
  signatureMenu?: string;
  comment?: string;
  phone?: string;
  groupSeating?: boolean;
  groupCapacity?: number;
  /** 팀회식 모드에서 단체석 미확인 보조 후보 */
  groupUnconfirmed?: boolean;
  soloFriendly?: boolean;
  /** 관리자 지정 최소 이동수단 (관리자DB만). 있으면 직선거리 대신 이 등급으로 노출 판정 */
  accessMode?: DistanceMode;
  /** 미식가 직접 방문 검증 여부 (관리자DB만) */
  visited?: boolean;
  /** 미식가 주관적 평점 (0~10, 관리자DB만) */
  rating?: number;
  /** 후식 미식가 추천 여부 (coffee DB만. 평점 대신 추천 T/F) */
  recommended?: boolean;
  /** 아아INDEX — 아이스아메리카노 가격(원). coffee DB만. 향후 가격대 필터용 */
  iceAmericano?: number;
  /** 룰렛 가중치 (최종 계산값) */
  weight: number;
  kakaoPlaceUrl?: string;
}

/**
 * 후식(coffee) 시트 한 행 = 큐레이션된 카페·디저트 매장.
 * 식당(Restaurant)과 분리된 전용 스키마 — 대분류는 항상 '후식'이라 시트엔 없음(로더에서 채움).
 * 평점(rating) 대신 추천(recommended) T/F만 관리(커피는 정밀 평점이 어려움).
 */
export interface Cafe {
  name: string;
  /** 후식 하위 카테고리 (categories.ts DESSERT_SUBS 중 하나) */
  categorySub: string;
  signatureMenu: string;
  /** 대표 가격 메모 (예: '아메리카노 4.5천'). 예산 등급 대신 자유 텍스트 */
  priceNote: string;
  address: string;
  lat: number;
  lng: number;
  comment: string;
  active: boolean;
  weight: number;
  phone?: string;
  /** 미식가 직접 방문 검증 여부 */
  visited?: boolean;
  /** 미식가 추천 여부 (방문 후 '추천'만 판정) */
  recommended?: boolean;
  /** 아아INDEX — 아이스아메리카노 가격(원). 향후 가격대 필터 기준 */
  iceAmericano?: number;
}

export interface Coords {
  lat: number;
  lng: number;
}

export interface WeatherInfo {
  /** 강수 형태 코드 (0=없음). PTY */
  precipitationType: number;
  /** 기온 (℃) */
  temperature: number | null;
  /** 특보 목록 (폭염/한파/호우 등) */
  warnings: string[];
  /** 악천후 판정 (강수 중이거나 특보 발효) — 안내·추천용. v1.14부터 필터를 바꾸지 않는다 */
  badWeather: boolean;
  /** 날씨 API 사용 불가 시 true (조용히 비활성) */
  unavailable: boolean;
}
