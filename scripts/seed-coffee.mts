// ── 카카오 검색으로 후식(coffee) 시트 초안 채우기 (Phase 0 보조 도구) ──
// 군인공제회관 기준 반경 500m(기본) 카페·디저트를 카카오 로컬 API(CE7)로 긁어와,
// coffee 시트 형식의 TSV(phase0-coffee.tsv)로 저장 → 구글 시트 coffee 탭에 붙여넣고 손으로 큐레이션.
//
// 실행: .env.local에 KAKAO_REST_KEY 넣은 뒤
//   npx tsx scripts/seed-coffee.mts            (기본 반경 500m — 후식 모드와 동일)
//   npx tsx scripts/seed-coffee.mts 700        (반경 700m로 조금 넓게)
//
// 자동으로 채워지는 칸: name / category_sub(CE7 매핑) / address / lat / lng / phone
//   + active=TRUE / weight=1
// 손으로 채울 칸(비어 있음): signature_menu / price_note / comment / visited / recommended

import { readFileSync, writeFileSync } from 'node:fs';
import { mapKakaoCafe } from '../src/lib/categories.ts';
import { COMPANY_COORDS, haversineMeters } from '../src/lib/geo.ts';

const RADIUS = Number(process.argv[2]) || 500;
const OUT = 'phase0-coffee.tsv';
const MAX_ROWS = 250;

// 헤더 (coffee 시트 1행과 동일)
const HEADER = [
  'name', 'category_sub', 'signature_menu', 'price_note', 'address',
  'lat', 'lng', 'comment', 'active', 'weight', 'phone', 'visited', 'recommended',
];

// 다양성 확보용 카페 키워드 (후식 5종 커버)
const KEYWORDS = [
  '카페', '커피', '베이커리', '제과', '빵', '디저트', '케이크', '타르트',
  '도넛', '와플', '아이스크림', '젤라또', '빙수', '마카롱', '스무디', '차',
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
  const base = {
    x: String(COMPANY_COORDS.lng),
    y: String(COMPANY_COORDS.lat),
    radius: String(RADIUS),
    sort: 'distance',
  };

  // 1) 카페 카테고리(CE7) 전체 — 최대 3페이지(45곳)
  for (let page = 1; page <= 3; page++) {
    const { documents, meta } = await kakao(
      'category.json',
      { ...base, category_group_code: 'CE7', size: '15', page: String(page) },
      key,
    );
    documents.forEach((d) => seen.set(d.id, d));
    process.stdout.write(`\r카페 카테고리 검색 ${page}/3 · 누적 ${seen.size}곳   `);
    if (meta.is_end) break;
  }

  // 2) 키워드별 다양성 검색 — 각 1페이지(15곳), CE7만
  for (const q of KEYWORDS) {
    try {
      const { documents } = await kakao(
        'keyword.json',
        { ...base, query: q, category_group_code: 'CE7', size: '15', page: '1' },
        key,
      );
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

function toRow(d: KakaoDoc): string[] {
  const mapped = mapKakaoCafe(d.category_name);
  const address = d.road_address_name || d.address_name;
  return [
    tsvCell(d.place_name), // name
    mapped.sub,            // category_sub (CE7 매핑)
    '',                    // signature_menu (손으로)
    '',                    // price_note (손으로)
    tsvCell(address),      // address
    d.y,                   // lat
    d.x,                   // lng
    '',                    // comment (손으로)
    'TRUE',                // active
    '1',                   // weight
    tsvCell(d.phone),      // phone
    'FALSE',               // visited (손으로)
    'FALSE',               // recommended (손으로: 방문 후 추천이면 TRUE)
  ];
}

async function main() {
  const key = readKey();
  if (!key) {
    console.error('✖ KAKAO_REST_KEY가 없습니다. .env.local에 넣거나 환경변수로 전달하세요.');
    process.exit(1);
  }

  console.log(`군인공제회관 기준 반경 ${RADIUS}m 카페·디저트 수집 중…`);
  const all = await collect(key);

  const center = COMPANY_COORDS;
  const inArea = [...all.values()]
    .map((d) => ({ d, dist: haversineMeters(center, { lat: Number(d.y), lng: Number(d.x) }) }))
    .filter((x) => Number.isFinite(x.dist) && x.dist <= RADIUS)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_ROWS);

  const rows = inArea.map((x) => toRow(x.d));
  const tsv = [HEADER, ...rows].map((r) => r.join('\t')).join('\n');
  writeFileSync(OUT, tsv, 'utf8');

  console.log(`\n✓ 반경 ${RADIUS}m 내 카페 ${rows.length}곳 저장 → ${OUT}`);
  console.log('  카테고리 분포:');
  const dist: Record<string, number> = {};
  inArea.forEach((x) => {
    const sub = mapKakaoCafe(x.d.category_name).sub;
    dist[sub] = (dist[sub] ?? 0) + 1;
  });
  Object.entries(dist).forEach(([k, v]) => console.log(`   · ${k}: ${v}곳`));
  console.log('  미리보기 (가까운 순 6곳):');
  inArea.slice(0, 6).forEach((x) =>
    console.log(`   · ${x.d.place_name}  [${mapKakaoCafe(x.d.category_name).sub}]  ${Math.round(x.dist)}m`),
  );
  console.log('\n다음: phase0-coffee.tsv를 열어 전체 복사 → 구글 시트 coffee 탭 A1에 붙여넣기');
  console.log('      (헤더 포함. 이후 signature_menu/comment/visited/recommended를 손으로 큐레이션)');
}

main().catch((e) => {
  console.error('\n✖ 실패:', e.message);
  process.exit(1);
});
