// ── 마스코트 도트 캐릭터 '도곡이' — 젓가락 든 꼬마 직장인 (기획서 §3.4) ──
// 24×24. 로딩·빈결과·악천후 상태별 표정/소품 변형.
// 재실행: `node scripts/gen-mascot.mjs`. PNG 인코더/팔레트는 gen-icons.mjs 공유.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { encodePng } from './gen-icons.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'mascot');
const S = 24;

// ── 공통 몸체 (머리+얼굴 베이스+셔츠+넥타이). 입/소품은 패치로. ──
const BODY = [
  '........................',
  '........................',
  '........KKKKKKKK........',
  '.......KbbbbbbbbK.......',
  '......KbbbbbbbbbbK......',
  '......KbFFFFFFFFbK......',
  '......KFFFFFFFFFFK......',
  '......KFFFFFFFFFFK......',
  '......KFFKFFFFKFFK......',
  '......KFFFFFFFFFFK......',
  '......KFPFFFFFFPFK......',
  '.......KFFFFFFFFK.......',
  '........KFFFFFFK........',
  '.....KWWWWWWWWWWWWK.....',
  '.....KWWWWWVVWWWWWK.....',
  '.....KWWWWWVVWWWWWK.....',
  '.....KWWWWWVVWWWWWK.....',
  '.....KWWWWWWWWWWWWK.....',
  '.....KWWWWWWWWWWWWK.....',
  '......KWWWWWWWWWWK......',
  '......KKKKKKKKKKKK......',
  '........................',
  '........................',
  '........................',
];

const toGrid = (rows) => rows.map((r) => r.split(''));
const clone = (g) => g.map((r) => [...r]);
const put = (g, patches) => {
  for (const [x, y, c] of patches) if (g[y] && g[y][x] !== undefined) g[y][x] = c;
  return g;
};

// 오른손으로 든 젓가락 (정체성 소품)
const CHOPSTICKS = [
  // 젓가락 2개 (갈색)
  [18, 6, 'b'], [18, 7, 'b'], [18, 8, 'b'], [18, 9, 'b'], [18, 10, 'b'],
  [20, 6, 'b'], [20, 7, 'b'], [20, 8, 'b'], [20, 9, 'b'], [20, 10, 'b'],
  // 쥔 손
  [17, 11, 'K'], [21, 11, 'K'],
  [17, 12, 'K'], [18, 12, 'F'], [19, 12, 'F'], [20, 12, 'F'], [21, 12, 'K'],
  [17, 13, 'K'], [18, 13, 'F'], [19, 13, 'F'], [20, 13, 'F'], [21, 13, 'K'],
  [18, 14, 'K'], [19, 14, 'K'], [20, 14, 'K'],
];

// 표정 패치 (입/눈 추가)
const SMILE = [[10, 10, 'K'], [13, 10, 'K'], [11, 11, 'K'], [12, 11, 'K']];
const FROWN = [[11, 10, 'K'], [12, 10, 'K'], [10, 11, 'K'], [13, 11, 'K']];
const SWEAT = [[17, 7, 'S'], [17, 8, 'S']]; // 땀방울

// 우산 소품 (악천후) — 오른쪽에 파란 우산 + 빗방울
const UMBRELLA = [
  [19, 3, 'K'], // 꼭지
  [18, 4, 'S'], [19, 4, 'S'], [20, 4, 'S'],
  [17, 5, 'S'], [18, 5, 'S'], [19, 5, 'S'], [20, 5, 'S'], [21, 5, 'S'],
  [16, 6, 'K'], [17, 6, 'K'], [18, 6, 'K'], [19, 6, 'K'], [20, 6, 'K'], [21, 6, 'K'], [22, 6, 'K'],
  [19, 7, 'K'], [19, 8, 'K'], [19, 9, 'K'], [19, 10, 'K'], [19, 11, 'K'], // 손잡이 대
  [18, 12, 'F'], [19, 12, 'F'], [20, 12, 'F'], // 쥔 손
  [18, 13, 'K'], [19, 13, 'F'], [20, 13, 'K'],
  // 빗방울
  [4, 4, 'S'], [3, 8, 'S'], [6, 15, 'S'], [22, 16, 'S'], [2, 18, 'S'],
];

const MASCOTS = {
  'mascot-happy': put(clone(toGrid(BODY)), [...CHOPSTICKS, ...SMILE]),
  'mascot-sad': put(clone(toGrid(BODY)), [...CHOPSTICKS, ...FROWN, ...SWEAT]),
  'mascot-rain': put(clone(toGrid(BODY)), [...UMBRELLA, ...SMILE]),
};

// ── 검증 + 생성 ──
function validate(name, g) {
  if (g.length !== S) throw new Error(`${name}: 행 ${g.length}≠${S}`);
  g.forEach((row, y) => {
    if (row.length !== S) throw new Error(`${name}: row ${y} 길이 ${row.length}≠${S}`);
  });
}

// 직접 실행 시에만 PNG 파일 생성 (import 시엔 MASCOTS 데이터만 노출)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const [name, grid] of Object.entries(MASCOTS)) {
    const rows = grid.map((r) => r.join(''));
    validate(name, rows);
    writeFileSync(join(OUT_DIR, `${name}.png`), encodePng(rows));
    n++;
  }
  console.log(`✓ 마스코트 ${n}종 생성 → ${OUT_DIR}`);
}

export { MASCOTS };
