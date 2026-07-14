// ── 역세권 후식 매장 시드 (한티/매봉/대치역 반경 500m) ──
// 사원들이 실제로 식사하는 3개 역 인근 카페·디저트를 카카오 CE7로 긁어와,
// coffee 시트에 "붙여넣을 행"만 TSV로 저장. 역끼리 중복 + 기존 시트 중복은 제외.
//
// 실행: npx tsx scripts/seed-coffee-stations.mts        (기본 반경 500m)
//       npx tsx scripts/seed-coffee-stations.mts 700    (반경 조정)
//
// 출력: coffee-stations.tsv (헤더 없이 데이터 행만 → coffee 탭 마지막 행 아래에 붙여넣기)
// 자동: name / category_sub / address / lat / lng / phone / active=TRUE / weight=1
// 손으로: signature_menu / price_note / comment / visited / recommended / 아아INDEX

import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
import { mapKakaoCafe } from '../src/lib/categories.ts';
import { haversineMeters } from '../src/lib/geo.ts';
import { isDuplicatePlace, type KnownPlace } from '../src/lib/syncDedupe.ts';
import { buildCafeRow } from '../src/lib/classify.ts';

const RADIUS = Number(process.argv[2]) || 500;
const OUT = 'coffee-stations.tsv';

// 카카오 지오코딩으로 확정한 좌표 (2026-07)
const STATIONS = [
  { name: '한티역', lat: 37.4963, lng: 127.0529 },
  { name: '매봉역', lat: 37.4869, lng: 127.0467 },
  { name: '대치역', lat: 37.4945, lng: 127.0632 },
];

const KEYWORDS = [
  '카페', '커피', '베이커리', '제과', '빵', '디저트', '케이크',
  '타르트', '도넛', '와플', '아이스크림', '젤라또', '빙수', '마카롱',
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

function env(name: string): string {
  try {
    const txt = readFileSync('.env.local', 'utf8');
    const m = txt.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm'));
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* noop */
  }
  return (process.env[name] ?? '').trim();
}

async function kakao(path: string, params: Record<string, string>, key: string) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}?${qs}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) throw new Error(`카카오 ${res.status} — ${await res.text()}`);
  return (await res.json()) as { documents: KakaoDoc[]; meta: { is_end: boolean } };
}

/** coffee 탭의 기존 매장(중복 판정용) */
async function loadExisting(sheetId: string): Promise<KnownPlace[]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=coffee`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const { data } = Papa.parse<Record<string, string>>(await r.text(), {
    header: true,
    skipEmptyLines: true,
  });
  return data
    .filter((row) => row.name)
    .map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? { name: row.name, lat, lng }
        : { name: row.name };
    });
}

/** 한 역 주변 CE7 수집 (카테고리 3페이지 + 키워드 다양성) */
async function collectAround(center: { lat: number; lng: number }, key: string) {
  const seen = new Map<string, KakaoDoc>();
  const base = { x: String(center.lng), y: String(center.lat), radius: String(RADIUS), sort: 'distance' };

  for (let page = 1; page <= 3; page++) {
    const { documents, meta } = await kakao(
      'category.json',
      { ...base, category_group_code: 'CE7', size: '15', page: String(page) },
      key,
    );
    documents.forEach((d) => seen.set(d.id, d));
    if (meta.is_end) break;
  }
  for (const q of KEYWORDS) {
    try {
      const { documents } = await kakao(
        'keyword.json',
        { ...base, query: q, category_group_code: 'CE7', size: '15', page: '1' },
        key,
      );
      documents.forEach((d) => seen.set(d.id, d));
    } catch {
      /* 개별 키워드 실패 무시 */
    }
  }
  return seen;
}

async function main() {
  const key = env('KAKAO_REST_KEY');
  const sheetId = env('GOOGLE_SHEET_ID');
  if (!key) {
    console.error('✖ KAKAO_REST_KEY 없음 (.env.local 확인)');
    process.exit(1);
  }

  const existing = sheetId ? await loadExisting(sheetId) : [];
  console.log(`기존 coffee 시트 매장: ${existing.length}곳 (이들과 중복되면 제외)\n`);

  // 역별 수집 → 해당 역 반경 내만, 가장 가까운 역으로 태깅
  const picked = new Map<string, { d: KakaoDoc; station: string; dist: number }>();
  for (const st of STATIONS) {
    const found = await collectAround(st, key);
    let inRange = 0;
    for (const d of found.values()) {
      const lat = Number(d.y);
      const lng = Number(d.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const dist = haversineMeters(st, { lat, lng });
      if (dist > RADIUS) continue;
      inRange++;
      const prev = picked.get(d.id);
      if (!prev || dist < prev.dist) picked.set(d.id, { d, station: st.name, dist });
    }
    console.log(`  ${st.name} 반경 ${RADIUS}m → ${inRange}곳 (누적 유니크 ${picked.size})`);
  }

  // 기존 시트와 중복 제거 (동기화와 동일한 판정 로직)
  const fresh: typeof picked extends Map<string, infer V> ? V[] : never[] = [];
  let dup = 0;
  for (const item of picked.values()) {
    const lat = Number(item.d.y);
    const lng = Number(item.d.x);
    if (isDuplicatePlace({ name: item.d.place_name, lat, lng }, existing)) {
      dup++;
      continue;
    }
    fresh.push(item);
  }
  fresh.sort((a, b) => (a.station === b.station ? a.dist - b.dist : a.station.localeCompare(b.station)));

  const rows = fresh.map((x) => buildCafeRow(x.d));
  writeFileSync(OUT, rows.map((r) => r.join('\t')).join('\n'), 'utf8');

  console.log(`\n✓ 3개 역 유니크 ${picked.size}곳 중 기존 중복 ${dup}곳 제외 → 신규 ${rows.length}곳 저장 → ${OUT}`);
  console.log(`  붙여넣을 위치: coffee 탭 ${existing.length + 2}행 (A열)\n`);

  const byStation: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  fresh.forEach((x) => {
    byStation[x.station] = (byStation[x.station] ?? 0) + 1;
    const sub = mapKakaoCafe(x.d.category_name).sub;
    byCat[sub] = (byCat[sub] ?? 0) + 1;
  });
  console.log('  역별:', Object.entries(byStation).map(([k, v]) => `${k} ${v}곳`).join(' · '));
  console.log('  카테고리:', Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('\n  미리보기 (역별 가까운 순 3곳씩):');
  for (const st of STATIONS) {
    fresh
      .filter((x) => x.station === st.name)
      .slice(0, 3)
      .forEach((x) => console.log(`   [${st.name}] ${x.d.place_name} — ${Math.round(x.dist)}m`));
  }
}

main().catch((e) => {
  console.error('\n✖ 실패:', e.message);
  process.exit(1);
});
