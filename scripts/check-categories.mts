// ── 카테고리 배선 점검 (임시 검수용) ──
// CATEGORY_TREE의 모든 하위가 아이콘 PNG·예산 추정과 연결돼 있는지 확인.
// 실행: npx tsx scripts/check-categories.mts
import { existsSync } from 'node:fs';
import { CATEGORY_TREE, SUB_TO_MAIN, estimatePriceTier, SOLO_FRIENDLY_SUBS } from '../src/lib/categories.ts';
import { iconSlugForSub } from '../src/lib/icons.ts';

const han = CATEGORY_TREE.find((c) => c.main === '한식')!;
console.log('한식 하위 (필터 칩에 나오는 순서 그대로):');
for (const s of han.subs) {
  const slug = iconSlugForSub(s);
  const ok = existsSync(`public/assets/icons/${slug}.png`);
  console.log(
    `  ${s.padEnd(10)} 예산=${estimatePriceTier(s).padEnd(4)} 혼밥친화=${SOLO_FRIENDLY_SUBS.has(s) ? 'O' : 'X'} 아이콘=${slug}${ok ? '' : '  ✖ PNG 없음!'}`,
  );
}

const all = CATEGORY_TREE.flatMap((c) => c.subs);
const missing = all.filter((s) => !existsSync(`public/assets/icons/${iconSlugForSub(s)}.png`));
const fallback = all.filter((s) => s !== '기타' && iconSlugForSub(s) === 'fallback');
console.log(`\n전체 하위 ${all.length}종 · '면류' 잔존 ${all.filter((s) => s.includes('면류')).length}건`);
console.log('아이콘 PNG 누락:', missing.length ? missing : '없음');
console.log('아이콘 매핑 누락(fallback 처리됨):', fallback.length ? fallback : '없음');
console.log('SUB_TO_MAIN:', `칼국수→${SUB_TO_MAIN['칼국수']} · 냉면·갈비탕→${SUB_TO_MAIN['냉면·갈비탕']}`);
