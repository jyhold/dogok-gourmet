// ── 샤브샤브 매장 시드 (군인공제회관 반경) ──
// 카카오는 샤브샤브를 최상위 대분류('음식점 > 샤브샤브')로 준다. 그래서
//   ① seed-sheet.mts의 KEYWORDS에 '샤브'가 없었고
//   ② 매핑 규칙이 없어 '기타'로 떨어져 classifyKakao에서 버려졌다
// → 시트에 한 곳도 안 들어갔다. 매핑을 고친 지금, 누락분만 골라 TSV로 뽑는다.
//
// 실행: npx tsx scripts/seed-shabu.mts        (기본 반경 1500m = 기존 시트와 동일)
//       npx tsx scripts/seed-shabu.mts 2000   (반경 조정)
//
// 출력: shabu-seed.tsv (헤더 없이 데이터 행만 → restaurants 탭 마지막 행 아래 A열에 붙여넣기)
// 자동: name / category(한식·샤브샤브) / address / lat / lng / phone / price_tier / active / weight / meal_type
// 손으로: signature_menu / price_note / comment / group_seating / group_capacity / solo_friendly / visited / rating / access_mode

import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
import { mapKakaoCategory } from '../src/lib/categories.ts';
import { COMPANY_COORDS, haversineMeters } from '../src/lib/geo.ts';
import { buildSheetRow, type KakaoLike } from '../src/lib/classify.ts';
import { isDuplicatePlace, type KnownPlace } from '../src/lib/syncDedupe.ts';

const RADIUS = Number(process.argv[2]) || 1500;
const OUT = 'shabu-seed.tsv';
const DISTRICTS = ['서초구', '강남구', '동작구', '송파구'];
const KEYWORDS = ['샤브샤브', '샤브', '월남쌈', '스키야키'];

interface KakaoDoc extends KakaoLike {
  id: string;
  distance: string;
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

async function kakao(params: Record<string, string>, key: string) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) throw new Error(`카카오 ${res.status} — ${await res.text()}`);
  return (await res.json()) as { documents: KakaoDoc[]; meta: { is_end: boolean } };
}

/** restaurants 탭의 기존 매장 (중복 판정용) */
async function loadExisting(sheetId: string): Promise<{ known: KnownPlace[]; rows: number }> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=restaurants`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`시트 로드 실패: ${r.status}`);
  const { data } = Papa.parse<Record<string, string>>(await r.text(), {
    header: true,
    skipEmptyLines: true,
  });
  const known = data
    .filter((row) => row.name)
    .map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { name: row.name, lat, lng } : { name: row.name };
    });
  return { known, rows: data.length };
}

async function main() {
  const key = env('KAKAO_REST_KEY');
  const sheetId = env('GOOGLE_SHEET_ID');
  if (!key) {
    console.error('✖ KAKAO_REST_KEY 없음 (.env.local 확인)');
    process.exit(1);
  }

  const { known, rows: existingRows } = sheetId
    ? await loadExisting(sheetId)
    : { known: [] as KnownPlace[], rows: 0 };
  console.log(`기존 restaurants 시트: ${existingRows}행 (이들과 중복되면 제외)\n`);

  // 키워드 검색으로 수집 → 카카오가 '샤브'로 분류한 것만 채택
  const seen = new Map<string, KakaoDoc>();
  const base = {
    x: String(COMPANY_COORDS.lng),
    y: String(COMPANY_COORDS.lat),
    radius: String(RADIUS),
    sort: 'distance',
  };
  for (const q of KEYWORDS) {
    for (let page = 1; page <= 3; page++) {
      try {
        const { documents, meta } = await kakao({ ...base, query: q, size: '15', page: String(page) }, key);
        // 상호에 '샤브'가 들어가도 카카오 분류가 샤브샤브가 아니면 제외
        // (예: 일본식주점·월남쌈 전문점) → 매핑 결과로 판정해 코드와 시트를 일치시킨다
        documents.forEach((d) => {
          if (mapKakaoCategory(d.category_name).sub === '샤브샤브') seen.set(d.id, d);
        });
        if (meta.is_end) break;
      } catch {
        break;
      }
    }
    process.stdout.write(`\r'${q}' 검색 · 누적 ${seen.size}곳            `);
  }
  process.stdout.write('\n\n');

  let outArea = 0;
  let dup = 0;
  const fresh: { d: KakaoDoc; dist: number }[] = [];
  for (const d of seen.values()) {
    const lat = Number(d.y);
    const lng = Number(d.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dist = haversineMeters(COMPANY_COORDS, { lat, lng });
    const addr = d.road_address_name || d.address_name || '';
    if (dist > RADIUS || !DISTRICTS.some((g) => addr.includes(g))) {
      outArea++;
      continue;
    }
    if (isDuplicatePlace({ name: d.place_name, lat, lng }, known)) {
      dup++;
      continue;
    }
    fresh.push({ d, dist });
  }
  fresh.sort((a, b) => a.dist - b.dist);

  const rows = fresh.map((x) => buildSheetRow(x.d, '둘다'));
  writeFileSync(OUT, rows.map((r) => r.join('\t')).join('\n'), 'utf8');

  console.log(`✓ 카카오 샤브샤브 ${seen.size}곳 → 반경/구역 밖 ${outArea}곳, 시트 중복 ${dup}곳 제외`);
  console.log(`  신규 ${rows.length}곳 저장 → ${OUT}`);
  console.log(`  붙여넣을 위치: restaurants 탭 ${existingRows + 2}행 A열\n`);
  fresh.forEach((x) => console.log(`   ${String(Math.round(x.dist)).padStart(4)}m  ${x.d.place_name.padEnd(26)} ${x.d.category_name}`));
}

main().catch((e) => {
  console.error('\n✖ 실패:', e.message);
  process.exit(1);
});
