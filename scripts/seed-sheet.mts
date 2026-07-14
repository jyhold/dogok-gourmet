// ── 카카오 검색으로 맛집 시트 초안 채우기 (Phase 0 보조 도구) ──
// 군인공제회관 기준 반경 내 음식점을 카카오 로컬 API로 긁어와,
// 시트 20열 형식의 TSV(phase0-seed.tsv)로 저장 → 구글 시트에 붙여넣고 손으로 큐레이션.
//
// 실행: .env.local에 KAKAO_REST_KEY 넣은 뒤
//   npx tsx scripts/seed-sheet.mts            (기본 반경 2500m)
//   npx tsx scripts/seed-sheet.mts 4000       (반경 4000m로 넓게)
//
// 자동으로 채워지는 칸: name / category_main·sub / address / lat / lng / phone
//   + price_tier(카테고리 추정) / active=TRUE / weight=1 / meal_type=둘다
// 손으로 채울 칸(비어 있음): signature_menu / price_note / comment / group_seating
//   / group_capacity / solo_friendly / visited / rating / access_mode

import { readFileSync, writeFileSync } from 'node:fs';
import { mapKakaoCategory, estimatePriceTier } from '../src/lib/categories.ts';
import { COMPANY_COORDS, haversineMeters } from '../src/lib/geo.ts';

const RADIUS = Number(process.argv[2]) || 2500;
const DISTRICTS = ['서초구', '강남구', '동작구', '송파구'];
const OUT = 'phase0-seed.tsv';
const MAX_ROWS = 250;

// 헤더 (시트 A1과 동일, 20열)
const HEADER = [
  'name', 'category_main', 'category_sub', 'signature_menu', 'price_tier', 'price_note',
  'address', 'lat', 'lng', 'comment', 'active', 'weight', 'meal_type',
  'group_seating', 'group_capacity', 'phone', 'solo_friendly', 'visited', 'rating', 'access_mode',
];

// 다양성 확보용 키워드 (카테고리 체계 커버)
const KEYWORDS = [
  '한식', '국밥', '고기', '칼국수', '백반', '분식', '김밥', '떡볶이',
  '중식', '짜장', '마라', '일식', '초밥', '라멘', '돈카츠', '우동',
  '양식', '파스타', '피자', '버거', '스테이크', '쌀국수', '베트남',
  '태국', '인도', '커리', '샐러드', '포케', '샌드위치', '브런치', '도시락',
];

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  phone: string;
}

// ── 분류/필터 ──
// 카페·베이커리·디저트는 제외. 치킨·호프·술집은 저녁용으로 유지(meal_type=저녁).
// 카테고리 미매칭('기타') 중 저녁 스팟이 아닌 것은 제외.
const CAFE_RE = /카페|커피|베이커리|제과|디저트|도넛|아이스크림|빙수|케이크|타르트|스무디|주스전문|와플|츄러스|마카롱|젤라또|생과일/;
const DINNER_RE = /치킨|호프|맥주|비어|펍|포차|이자카야|주점|술집|와인|바베큐|생맥주|치맥|BBQ|닭강정/;

function classify(d: KakaoDoc): { keep: boolean; mealType: string } {
  const cat = d.category_name || '';
  const name = d.place_name || '';
  const mapped = mapKakaoCategory(cat);
  if (DINNER_RE.test(cat) || DINNER_RE.test(name)) return { keep: true, mealType: '저녁' };
  if (CAFE_RE.test(cat)) return { keep: false, mealType: '' };
  if (mapped.main === '기타') return { keep: false, mealType: '' };
  return { keep: true, mealType: '둘다' };
}

function readKey(): string {
  try {
    const txt = readFileSync('.env.local', 'utf8');
    const m = txt.match(/^\s*KAKAO_REST_KEY\s*=\s*(.+)\s*$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* noop */
  }
  return (process.env.KAKAO_REST_KEY ?? '').trim();
}

async function kakao(path: string, params: Record<string, string>, key: string) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}?${qs}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) {
    throw new Error(`카카오 ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const json = (await res.json()) as { documents: KakaoDoc[]; meta: { is_end: boolean } };
  return json;
}

async function collect(key: string): Promise<Map<string, KakaoDoc>> {
  const seen = new Map<string, KakaoDoc>();
  const base = { x: String(COMPANY_COORDS.lng), y: String(COMPANY_COORDS.lat), radius: String(RADIUS), sort: 'distance' };

  // 1) 음식점 카테고리(FD6) 전체 — 최대 3페이지(45곳)
  for (let page = 1; page <= 3; page++) {
    const { documents, meta } = await kakao('category.json', { ...base, category_group_code: 'FD6', size: '15', page: String(page) }, key);
    documents.forEach((d) => seen.set(d.id, d));
    process.stdout.write(`\r카테고리 검색 ${page}/3 · 누적 ${seen.size}곳   `);
    if (meta.is_end) break;
  }

  // 2) 키워드별 다양성 검색 — 각 1페이지(15곳), 음식점만
  for (const q of KEYWORDS) {
    try {
      const { documents } = await kakao('keyword.json', { ...base, query: q, category_group_code: 'FD6', size: '15', page: '1' }, key);
      documents.forEach((d) => seen.set(d.id, d));
    } catch {
      /* 개별 키워드 실패는 무시 */
    }
    process.stdout.write(`\r키워드 '${q}' 검색 · 누적 ${seen.size}곳            `);
  }
  process.stdout.write('\n');
  return seen;
}

function tsvCell(v: string): string {
  return (v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function toRow(d: KakaoDoc, mealType: string): string[] {
  const mapped = mapKakaoCategory(d.category_name);
  const address = d.road_address_name || d.address_name;
  return [
    tsvCell(d.place_name),        // name
    mapped.main,                  // category_main
    mapped.sub,                   // category_sub
    '',                           // signature_menu (손으로)
    estimatePriceTier(mapped.sub),// price_tier (추정)
    '',                           // price_note
    tsvCell(address),             // address
    d.y,                          // lat
    d.x,                          // lng
    '',                           // comment
    'TRUE',                       // active
    '1',                          // weight
    mealType,                     // meal_type (저녁 스팟은 '저녁', 그 외 '둘다')
    'FALSE',                      // group_seating (손으로)
    '',                           // group_capacity
    tsvCell(d.phone),             // phone
    'FALSE',                      // solo_friendly (손으로)
    'FALSE',                      // visited (손으로)
    '',                           // rating (손으로)
    '',                           // access_mode (손으로: 1=도보/2=따릉이/3=택시, 비우면 직선거리)
  ];
}

async function main() {
  const key = readKey();
  if (!key) {
    console.error('✖ KAKAO_REST_KEY가 없습니다. .env.local에 넣거나 환경변수로 전달하세요.');
    process.exit(1);
  }

  console.log(`군인공제회관 기준 반경 ${RADIUS}m 음식점 수집 중…`);
  const all = await collect(key);

  const center = COMPANY_COORDS;
  const inArea = [...all.values()].filter((d) => {
    const lat = Number(d.y), lng = Number(d.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (haversineMeters(center, { lat, lng }) > RADIUS) return false;
    const addr = d.road_address_name || d.address_name || '';
    return DISTRICTS.some((g) => addr.includes(g));
  });

  let dropped = 0;
  const kept = inArea
    .map((d) => ({ d, cls: classify(d) }))
    .filter((x) => {
      if (!x.cls.keep) dropped++;
      return x.cls.keep;
    })
    .sort((a, b) => haversineMeters(center, { lat: Number(a.d.y), lng: Number(a.d.x) }) - haversineMeters(center, { lat: Number(b.d.y), lng: Number(b.d.x) }))
    .slice(0, MAX_ROWS);

  const rows = kept.map((x) => toRow(x.d, x.cls.mealType));
  const dinnerCount = kept.filter((x) => x.cls.mealType === '저녁').length;

  const tsv = [HEADER, ...rows].map((r) => r.join('\t')).join('\n');
  writeFileSync(OUT, tsv, 'utf8');

  console.log(`\n✓ 반경 ${RADIUS}m · 지역 내 ${inArea.length}곳 중 ${rows.length}곳 저장 (카페/기타 ${dropped}곳 제외) → ${OUT}`);
  console.log(`  이 중 치킨·호프·술집 ${dinnerCount}곳은 meal_type='저녁'으로 표시됨.`);
  console.log('  미리보기 (가까운 순 6곳):');
  rows.slice(0, 6).forEach((r) => console.log(`   · ${r[0]}  [${r[1]}/${r[2]}]  ${r[12]}`));
  console.log('\n다음: phase0-seed.tsv를 열어 전체 복사 → 구글 시트 restaurants 탭 A1에 붙여넣기');
  console.log('      (헤더 포함이라 빈 시트면 A1에 그대로 붙이면 끝. 이후 손으로 큐레이션)');
}

main().catch((e) => {
  console.error('\n✖ 실패:', e.message);
  process.exit(1);
});
