// ── 예비 시트(candidates) 구글 교차검증 + 승격 (기획서 §12) ──
//
// ⚠️ 이 프로젝트에서 **돈이 나가는 유일한 코드**다. 그래서 수동 실행 전용이고,
//    배치 상한 없이는 절대 돌지 않는다.
//    구글 Text Search Enterprise: $35/1,000 · 무료 월 1,000회 (평점 필드가 Enterprise 등급)
//
// 하는 일:
//   1) candidates 로드 → verdict가 빈 행(=미검증)만 대상, 가까운 순
//   2) 배치 수만큼만 구글 조회 → google_rating / google_reviews / verdict / checked_at 기록
//   3) verdict=pass → restaurants에 승격(append). 승격 직전 중복 재확인
//   4) 승격분은 verdict=promoted로 바꿔 candidates 전체를 replace
//
// 실행:
//   npx tsx scripts/verify-candidates.mts                      # 기본 20건 (안전)
//   npx tsx scripts/verify-candidates.mts 100                  # 100건
//   npx tsx scripts/verify-candidates.mts 100 --max-dist 800   # 800m 이내만
//   npx tsx scripts/verify-candidates.mts 5 --dry              # 대상만 보고 종료 (호출 0)

import { readFileSync } from 'node:fs';
import {
  loadCandidates,
  isUnchecked,
  coordsOf,
  withVerdict,
  withVerdictOnly,
  toRestaurantRow,
  type Verdict,
} from '../src/lib/candidatesSheet.ts';
import { fetchRating, passesGate, qualityGate, googleEnabled } from '../src/lib/googlePlaces.ts';
import { loadRestaurants, loadRestaurantNames } from '../src/lib/sheet.ts';
import { isDuplicatePlace, type KnownPlace } from '../src/lib/syncDedupe.ts';
import { postRows, postRowsChunked } from '../src/lib/sheetWebhook.ts';
import { COMPANY_COORDS, haversineMeters } from '../src/lib/geo.ts';
import { toKstStamp } from '../src/lib/stats.ts';

// ── .env.local 로드 (스크립트는 Next 런타임 밖이라 직접 읽는다) ──
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.USE_MOCK = 'FALSE'; // 실제 시트를 봐야 의미가 있다

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BATCH = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const distIdx = args.indexOf('--max-dist');
const MAX_DIST = distIdx >= 0 ? Number(args[distIdx + 1]) : Infinity;

const PRICE_PER_1K = 35; // Text Search Enterprise
const FREE_PER_MONTH = 1000;
const money = (n: number) => `$${n.toFixed(2)}`;

async function main() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID 미설정');
  if (!googleEnabled()) {
    throw new Error(
      'GOOGLE_PLACES_KEY 미설정 — docs/candidates-setup.md의 구글 키 발급을 먼저 하세요.\n' +
        '  이 키는 .env.local에만 넣습니다. Vercel엔 넣지 마세요 —\n' +
        '  서버가 실수로 호출할 경로를 아예 없애는 게 가장 확실한 비용 안전장치입니다.',
    );
  }
  if (!Number.isFinite(BATCH) || BATCH <= 0) throw new Error(`배치 수가 잘못됐습니다: ${BATCH}`);

  const { rows } = await loadCandidates(sheetId);

  // 인덱스를 들고 다닌다 — 동명 체인점(예: 한솥도시락 ○○점)이 있어 상호명 키는 충돌한다
  const unchecked = rows
    .map((r, i) => ({ r, i, dist: haversineMeters(COMPANY_COORDS, coordsOf(r)) }))
    .filter((x) => isUnchecked(x.r) && x.dist <= MAX_DIST)
    .sort((a, b) => a.dist - b.dist);
  const target = unchecked.slice(0, BATCH);

  const gate = qualityGate();
  const totalUnchecked = rows.filter(isUnchecked).length;
  console.log(`■ candidates ${rows.length}행 · 미검증 ${totalUnchecked}행`);
  if (Number.isFinite(MAX_DIST)) console.log(`   ${MAX_DIST}m 이내 미검증: ${unchecked.length}행`);
  console.log(`   이번 대상: ${target.length}건 (배치 ${BATCH})`);
  console.log(`   통과 기준: (평점 ≥ ${gate.minRating} 또는 리뷰 ≥ ${gate.minReviews}) · 단 평점 ≤ ${gate.badRating}이면 리뷰 무관 탈락`);
  console.log(`\n■ 비용 (구글 Text Search Enterprise $${PRICE_PER_1K}/1,000 · 무료 월 ${FREE_PER_MONTH}회)`);
  console.log(`   이번 실행: 최대 ${target.length}회 → 무료 한도 내면 $0, 전부 유료면 ${money((target.length / 1000) * PRICE_PER_1K)}`);
  console.log(`   남은 것 전부: ${unchecked.length}회 → 유료분 ${money((Math.max(0, unchecked.length - FREE_PER_MONTH) / 1000) * PRICE_PER_1K)}\n`);

  if (target.length === 0) return console.log('검증할 게 없습니다.');
  if (DRY) {
    console.log('--dry — 구글 호출 없이 종료. 대상 미리보기:');
    target.slice(0, 10).forEach((x) => console.log(`   ${String(Math.round(x.dist)).padStart(4)}m  ${x.r.name}`));
    return;
  }

  // ── 구글 조회 (순차 — 속도보다 쿼터·과금 통제가 중요) ──
  const now = toKstStamp(new Date());
  const patched = new Map<number, { raw: string[]; verdict: Verdict }>();
  let pass = 0, fail = 0, miss = 0;

  for (const [n, x] of target.entries()) {
    const g = await fetchRating(x.r.name, coordsOf(x.r));
    const verdict: Verdict = g.miss ? 'miss' : passesGate(g, gate) ? 'pass' : 'fail';
    if (verdict === 'pass') pass++;
    else if (verdict === 'fail') fail++;
    else miss++;

    patched.set(x.i, {
      raw: withVerdict(x.r, { googleRating: g.rating, googleReviews: g.reviews, verdict, checkedAt: now }),
      verdict,
    });

    const mark = verdict === 'pass' ? '✅' : verdict === 'fail' ? '· ' : '❓';
    const score = g.rating != null ? `★${g.rating} (리뷰 ${g.reviews ?? 0})` : `매칭실패(${g.miss})`;
    console.log(`  ${String(n + 1).padStart(3)}/${target.length} ${mark} ${x.r.name.padEnd(22)} ${score}`);
  }
  console.log(`\n■ 결과: pass ${pass} · fail ${fail} · miss ${miss}`);

  // ── 승격: pass만 restaurants로. 직전에 중복 재확인 → 재실행해도 안전 ──
  const [parsed, allNames] = await Promise.all([loadRestaurants(), loadRestaurantNames()]);
  const known: KnownPlace[] = [
    ...parsed.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng })),
    ...allNames.map((name) => ({ name })),
  ];

  const promote: { idx: number; row: string[] }[] = [];
  for (const [idx, v] of patched) {
    if (v.verdict !== 'pass') continue;
    const r = rows[idx];
    if (isDuplicatePlace({ name: r.name, lat: r.lat, lng: r.lng }, known)) {
      console.log(`   (이미 restaurants에 있어 승격 생략: ${r.name})`);
      continue;
    }
    promote.push({ idx, row: toRestaurantRow(v.raw) });
  }

  if (promote.length > 0) {
    const res = await postRowsChunked('restaurants', promote.map((p) => p.row));
    if (!res.ok) {
      console.error(`\n✖ 승격 실패 — ${res.error}`);
      console.error('  candidates는 아직 안 건드렸습니다. 원인 해결 후 다시 실행하세요(같은 곳을 다시 조회하니 비용은 한 번 더 듭니다).');
      process.exit(1);
    }
    console.log(`\n✓ restaurants에 ${res.added}곳 승격`);
    promote.forEach((p) => patched.set(p.idx, { raw: withVerdictOnly(patched.get(p.idx)!.raw, 'promoted'), verdict: 'promoted' }));
  } else {
    console.log('\n승격할 곳 없음');
  }

  // ── candidates 되쓰기 (승격 append 성공 후) ──
  const nextRows = rows.map((r, i) => patched.get(i)?.raw ?? r.raw);
  const rep = await postRows('candidates', nextRows, 'replace');
  if (!rep.ok) {
    console.error(`\n✖ candidates 되쓰기 실패 — ${rep.error}`);
    console.error('  ⚠️ 승격은 이미 끝났습니다. 다시 실행해도 중복 검사가 막아주지만, 같은 곳을 재조회해 비용이 듭니다.');
    process.exit(1);
  }
  console.log(`✓ candidates ${rep.replaced}행 갱신 (검증 결과 기록)`);
}

main().catch((e) => {
  console.error('\n✖ 실패:', e.message);
  process.exit(1);
});
