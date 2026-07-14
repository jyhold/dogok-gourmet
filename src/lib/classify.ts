// ── 카카오 결과 → 시트 행 변환 + 잡음 필터 (시드/동기화 공용) ──
import { mapKakaoCategory, estimatePriceTier, mapKakaoCafe } from './categories';

/** 시트 헤더 20열 (A~T 순서, 시트 1행과 동일) */
export const SHEET_HEADER = [
  'name', 'category_main', 'category_sub', 'signature_menu', 'price_tier', 'price_note',
  'address', 'lat', 'lng', 'comment', 'active', 'weight', 'meal_type',
  'group_seating', 'group_capacity', 'phone', 'solo_friendly', 'visited', 'rating', 'access_mode',
];

/** classify/buildSheetRow가 쓰는 카카오 필드만 (KakaoPlace·KakaoDoc 둘 다 호환) */
export interface KakaoLike {
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  phone: string;
}

// 카페·베이커리·디저트는 제외. 치킨·호프·술집은 저녁용. 미매칭(기타)은 제외.
const CAFE_RE = /카페|커피|베이커리|제과|디저트|도넛|아이스크림|빙수|케이크|타르트|스무디|주스전문|와플|츄러스|마카롱|젤라또|생과일/;
const DINNER_RE = /치킨|호프|맥주|비어|펍|포차|이자카야|주점|술집|와인|바베큐|생맥주|치맥|BBQ|닭강정/;

/** 시트에 넣을지 + 넣는다면 meal_type */
export function classifyKakao(p: KakaoLike): { keep: boolean; mealType: string } {
  const cat = p.category_name || '';
  const name = p.place_name || '';
  const mapped = mapKakaoCategory(cat);
  if (DINNER_RE.test(cat) || DINNER_RE.test(name)) return { keep: true, mealType: '저녁' };
  if (CAFE_RE.test(cat)) return { keep: false, mealType: '' };
  if (mapped.main === '기타') return { keep: false, mealType: '' };
  return { keep: true, mealType: '둘다' };
}

function cell(v: string | undefined): string {
  return (v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/** 카카오 결과 → 시트 20열 행. 자동값만 채우고 큐레이션 칸(메뉴·평점·이동수단)은 빈 값. */
export function buildSheetRow(p: KakaoLike, mealType: string): string[] {
  const mapped = mapKakaoCategory(p.category_name);
  const address = p.road_address_name || p.address_name;
  return [
    cell(p.place_name), // name
    mapped.main, // category_main
    mapped.sub, // category_sub
    '', // signature_menu (손)
    estimatePriceTier(mapped.sub), // price_tier (추정)
    '', // price_note
    cell(address), // address
    p.y, // lat
    p.x, // lng
    '', // comment
    'TRUE', // active
    '1', // weight
    mealType, // meal_type
    'FALSE', // group_seating (손)
    '', // group_capacity
    cell(p.phone), // phone
    'FALSE', // solo_friendly (손)
    'FALSE', // visited (손)
    '', // rating (손)
    '', // access_mode (손: 1=도보/2=따릉이/3=택시, 비우면 직선거리)
  ];
}

// ── 후식(coffee) 시트 헤더 13열 (coffee 탭 1행과 동일) ──
export const COFFEE_SHEET_HEADER = [
  'name', 'category_sub', 'signature_menu', 'price_note', 'address',
  'lat', 'lng', 'comment', 'active', 'weight', 'phone', 'visited', 'recommended',
];

/** 카카오 CE7(카페) 결과 → coffee 시트 13열 행. 큐레이션 칸(메뉴·추천)은 빈 값. */
export function buildCafeRow(p: KakaoLike): string[] {
  const mapped = mapKakaoCafe(p.category_name);
  const address = p.road_address_name || p.address_name;
  return [
    cell(p.place_name), // name
    mapped.sub, // category_sub (CE7 매핑, 실패 시 커피·음료)
    '', // signature_menu (손)
    '', // price_note (손)
    cell(address), // address
    p.y, // lat
    p.x, // lng
    '', // comment (손)
    'TRUE', // active
    '1', // weight
    cell(p.phone), // phone
    'FALSE', // visited (손)
    'FALSE', // recommended (손: 방문 후 추천이면 TRUE)
  ];
}
