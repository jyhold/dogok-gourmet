import type { PriceTier } from './types';

// ── 2단계 메뉴 카테고리 체계 (기획서 §3.3) ──────────────────
// 대분류 8개 + 하위 24개

export interface CategoryDef {
  main: string;
  subs: string[];
}

export const CATEGORY_TREE: CategoryDef[] = [
  { main: '한식', subs: ['국밥·탕', '고기구이', '찌개·백반', '면류(칼국수·냉면)', '죽·건강식'] },
  { main: '분식', subs: ['떡볶이·김밥', '국수·우동'] },
  { main: '중식', subs: ['짜장·짬뽕', '마라·훠궈', '양꼬치·중식당'] },
  { main: '일식', subs: ['초밥·회', '라멘·우동', '돈카츠·카레', '덮밥', '장어요리'] },
  { main: '양식', subs: ['파스타·피자', '버거', '스테이크·비스트로'] },
  { main: '아시안', subs: ['쌀국수·베트남', '태국·팟타이', '인도·커리'] },
  { main: '카페·간편', subs: ['샐러드·포케', '샌드위치·브런치', '도시락'] },
  { main: '기타', subs: ['뷔페·구내식당', '기타'] },
];

/** 하위 카테고리 → 대분류 역참조 */
export const SUB_TO_MAIN: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const c of CATEGORY_TREE) for (const s of c.subs) map[s] = c.main;
  return map;
})();

export interface MappedCategory {
  main: string;
  sub: string;
}

const FALLBACK: MappedCategory = { main: '기타', sub: '기타' };

// ── 카카오 category_name → 자체 카테고리 매핑 (병목 7) ────────
// 세부(뒤쪽) 키워드부터 검사 → 실패 시 대분류 → 최종 fallback.
// 카카오 category_name 예: "음식점 > 한식 > 국밥"

interface MappingRule {
  keywords: string[];
  result: MappedCategory;
}

// 세부 규칙 먼저 (구체적인 것 위로)
const SUB_RULES: MappingRule[] = [
  // 카페·베이커리 — '베이커리'가 '커리'로 오매칭되지 않게 최우선에 둔다
  { keywords: ['베이커리', '제과', '도넛', '베이글'], result: { main: '카페·간편', sub: '샌드위치·브런치' } },
  // 장어 — '구이'/'일식' 등 일반 규칙보다 먼저 매칭
  { keywords: ['장어', '아나고', '붕장어', '풍천장어'], result: { main: '일식', sub: '장어요리' } },
  // 한식
  { keywords: ['국밥', '설렁탕', '곰탕', '해장국', '순대국', '감자탕', '탕'], result: { main: '한식', sub: '국밥·탕' } },
  { keywords: ['육류', '고기', '삼겹', '갈비', '곱창', '구이', '숯불'], result: { main: '한식', sub: '고기구이' } },
  { keywords: ['냉면', '칼국수', '국수', '수제비'], result: { main: '한식', sub: '면류(칼국수·냉면)' } },
  { keywords: ['죽', '보양', '삼계', '건강식'], result: { main: '한식', sub: '죽·건강식' } },
  { keywords: ['백반', '한정식', '찌개', '김치찌개', '된장', '가정식', '기사식당'], result: { main: '한식', sub: '찌개·백반' } },
  // 분식
  { keywords: ['떡볶이', '김밥', '분식'], result: { main: '분식', sub: '떡볶이·김밥' } },
  { keywords: ['우동', '잔치국수'], result: { main: '분식', sub: '국수·우동' } },
  // 중식
  { keywords: ['마라', '훠궈', '양꼬치'], result: { main: '중식', sub: '마라·훠궈' } },
  { keywords: ['짜장', '짬뽕', '중식', '중국집', '중국요리'], result: { main: '중식', sub: '짜장·짬뽕' } },
  // 일식
  { keywords: ['초밥', '스시', '회', '횟집', '사시미', '오마카세'], result: { main: '일식', sub: '초밥·회' } },
  { keywords: ['라멘', '라면', '우동'], result: { main: '일식', sub: '라멘·우동' } },
  { keywords: ['돈카츠', '돈까스', '카츠', '카레'], result: { main: '일식', sub: '돈카츠·카레' } },
  { keywords: ['덮밥', '규동', '가츠동', '일식'], result: { main: '일식', sub: '덮밥' } },
  // 양식
  { keywords: ['파스타', '피자', '이탈리안', '스파게티'], result: { main: '양식', sub: '파스타·피자' } },
  { keywords: ['버거', '햄버거'], result: { main: '양식', sub: '버거' } },
  { keywords: ['스테이크', '비스트로', '스테이크하우스'], result: { main: '양식', sub: '스테이크·비스트로' } },
  // 아시안
  { keywords: ['쌀국수', '베트남', '분짜'], result: { main: '아시안', sub: '쌀국수·베트남' } },
  { keywords: ['태국', '팟타이', '똠양'], result: { main: '아시안', sub: '태국·팟타이' } },
  { keywords: ['인도', '커리', '카레(인도)'], result: { main: '아시안', sub: '인도·커리' } },
  // 카페·간편
  { keywords: ['샐러드', '포케'], result: { main: '카페·간편', sub: '샐러드·포케' } },
  { keywords: ['샌드위치', '브런치', '베이글'], result: { main: '카페·간편', sub: '샌드위치·브런치' } },
  { keywords: ['도시락'], result: { main: '카페·간편', sub: '도시락' } },
  // 기타
  { keywords: ['뷔페', '구내식당', '푸드코트'], result: { main: '기타', sub: '뷔페·구내식당' } },
];

// 대분류 폴백 (세부 매칭 실패 시)
const MAIN_RULES: MappingRule[] = [
  { keywords: ['한식'], result: { main: '한식', sub: '찌개·백반' } },
  { keywords: ['일식'], result: { main: '일식', sub: '덮밥' } },
  { keywords: ['중식', '중국'], result: { main: '중식', sub: '짜장·짬뽕' } },
  { keywords: ['양식'], result: { main: '양식', sub: '파스타·피자' } },
  { keywords: ['분식'], result: { main: '분식', sub: '떡볶이·김밥' } },
  { keywords: ['아시아', '동남아'], result: { main: '아시안', sub: '쌀국수·베트남' } },
  { keywords: ['카페', '베이커리'], result: { main: '카페·간편', sub: '샌드위치·브런치' } },
];

/** 카카오 category_name 문자열 → 자체 카테고리 (세부→대분류→fallback) */
export function mapKakaoCategory(categoryName: string): MappedCategory {
  if (!categoryName) return FALLBACK;
  for (const rule of SUB_RULES) {
    if (rule.keywords.some((k) => categoryName.includes(k))) return rule.result;
  }
  for (const rule of MAIN_RULES) {
    if (rule.keywords.some((k) => categoryName.includes(k))) return rule.result;
  }
  return FALLBACK;
}

// ── 예산 추정 테이블 (병목 2) ──────────────────────────────
// 카카오 일반 결과는 가격 데이터가 없어 하위 카테고리로 추정.

const PRICE_BY_SUB: Record<string, PriceTier> = {
  '국밥·탕': '가성비',
  '찌개·백반': '가성비',
  '면류(칼국수·냉면)': '가성비',
  '죽·건강식': '보통',
  '떡볶이·김밥': '가성비',
  '국수·우동': '가성비',
  '짜장·짬뽕': '가성비',
  '마라·훠궈': '보통',
  '양꼬치·중식당': '보통',
  '초밥·회': '플렉스',
  '라멘·우동': '가성비',
  '돈카츠·카레': '가성비',
  '덮밥': '가성비',
  '장어요리': '플렉스',
  '파스타·피자': '보통',
  '버거': '가성비',
  '스테이크·비스트로': '플렉스',
  '쌀국수·베트남': '가성비',
  '태국·팟타이': '보통',
  '인도·커리': '보통',
  '샐러드·포케': '보통',
  '샌드위치·브런치': '보통',
  '도시락': '가성비',
  '뷔페·구내식당': '가성비',
  '고기구이': '보통',
};

export function estimatePriceTier(sub: string): PriceTier {
  return PRICE_BY_SUB[sub] ?? '보통';
}

// ── 혼밥 휴리스틱 (병목 1) ─────────────────────────────────
// 좌석 데이터가 없어도 카테고리로 혼밥 적합도 추정.

/** 혼밥 친화 하위 카테고리 (가중치↑) */
export const SOLO_FRIENDLY_SUBS = new Set<string>([
  '국밥·탕',
  '면류(칼국수·냉면)',
  '떡볶이·김밥',
  '국수·우동',
  '라멘·우동',
  '돈카츠·카레',
  '덮밥',
  '버거',
  '쌀국수·베트남',
  '샐러드·포케',
  '샌드위치·브런치',
  '도시락',
  '짜장·짬뽕',
]);

/** 다인 전제 → 혼밥 모드에서 제외 */
export const SOLO_EXCLUDED_SUBS = new Set<string>([
  '고기구이',
  '양꼬치·중식당',
  '마라·훠궈',
  '뷔페·구내식당',
  '스테이크·비스트로',
]);

/** 팀회식 보조 후보로 넣을 회식형 카테고리 (단체석 미확인 라벨) */
export const TEAM_DINNER_SUBS = new Set<string>([
  '고기구이',
  '초밥·회',
  '양꼬치·중식당',
  '마라·훠궈',
  '스테이크·비스트로',
  '장어요리',
]);

/** 점심형(저녁에 닫는) 카테고리 → 저녁 모드에서 가중치↓/제외 (리스크 대응) */
export const LUNCH_ONLY_SUBS = new Set<string>(['찌개·백반', '뷔페·구내식당', '죽·건강식']);
