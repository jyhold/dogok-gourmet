// ── 카테고리별 도트 아이콘 매핑 (기획서 §3.4) ──────────────
// 16×16 PNG는 scripts/gen-icons.mjs로 생성 (public/assets/icons/{slug}.png).
// 아이콘 수정: gen-icons.mjs의 그리드 편집 후 `node scripts/gen-icons.mjs` 재실행.

const SUB_SLUG: Record<string, string> = {
  '국밥·탕': 'gukbap',
  '고기구이': 'grill',
  '찌개·백반': 'jjigae',
  '칼국수': 'kalguksu',
  '냉면·갈비탕': 'naengmyeon',
  '샤브샤브': 'shabu',
  '죽·건강식': 'juk',
  '떡볶이·김밥': 'gimbap',
  '국수·우동': 'guksu',
  '만두': 'mandu',
  '짜장·짬뽕': 'jjajang',
  '마라·훠궈': 'mala',
  '양꼬치·중식당': 'skewer',
  '초밥·회': 'sushi',
  '라멘·우동': 'ramen',
  '돈카츠·카레': 'katsu',
  '덮밥': 'donburi',
  '장어요리': 'eel',
  '파스타·피자': 'pizza',
  '버거': 'burger',
  '스테이크·비스트로': 'steak',
  '멕시칸·타코': 'taco',
  '쌀국수·베트남': 'pho',
  '태국·팟타이': 'thai',
  '인도·커리': 'curry',
  '홍콩·딤섬': 'dimsum',
  '샐러드·포케': 'salad',
  '샌드위치·브런치': 'sandwich',
  '도시락': 'bento',
  '뷔페·구내식당': 'buffet',
  // 후식(dessert) 5종
  '커피·음료': 'coffee',
  '베이커리·빵': 'bakery',
  '케이크·디저트': 'cake',
  '도넛·와플': 'donut',
  '아이스크림·빙수': 'icecream',
  '기타': 'fallback',
};

export function iconSlugForSub(sub: string): string {
  return SUB_SLUG[sub] ?? 'fallback';
}

export function iconPathForSub(sub: string): string {
  return `/assets/icons/${iconSlugForSub(sub)}.png`;
}
