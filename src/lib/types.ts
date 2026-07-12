// ── 도메인 타입 정의 ──────────────────────────────────────

/** 식사 모드 (최상위 분기 + 하위 분기) */
export type Mode = 'lunch-solo' | 'lunch-group' | 'dinner-flash' | 'dinner-team';

export type MealType = '점심' | '저녁' | '둘다';

/** 예산 등급. '회식' = 인당 5만+α */
export type PriceTier = '가성비' | '보통' | '플렉스' | '회식';

/** 거리 필터 (이동수단) */
export type DistanceMode = 'walk' | 'bike' | 'taxi';

// 시작점(군인공제회관)으로부터 직선거리(하버사인) 반경 상한 (m)
export const DISTANCE_METERS: Record<DistanceMode, number> = {
  walk: 1300,
  bike: 2000,
  taxi: 5000,
};

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
  /** 미식가 직접 방문 검증 여부 (관리자DB만) */
  visited?: boolean;
  /** 미식가 주관적 평점 (0~10, 관리자DB만) */
  rating?: number;
  /** 룰렛 가중치 (최종 계산값) */
  weight: number;
  kakaoPlaceUrl?: string;
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
  /** 악천후 판정 → 거리 기본값 택시 전환 */
  badWeather: boolean;
  /** 사용자 안내 메시지 */
  message: string | null;
  /** 날씨 API 사용 불가 시 true (조용히 비활성) */
  unavailable: boolean;
}
