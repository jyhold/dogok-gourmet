// ── 도트 음식 아이콘 24종 + fallback 생성 파이프라인 (기획서 §3.4) ──
// 16×16 픽셀 그리드를 문자로 정의 → 나머지 후처리(팔레트/투명/PNG)는 코드로.
// 재실행: `node scripts/gen-icons.mjs` (§9.1 규칙 5: 결정적 작업은 스크립트로).
// 유료 생성도구 미사용 — 전부 여기서 손도트 → PNG 인코딩.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'icons');

// ── 팔레트 (디자인 시스템 따뜻한 파스텔과 정합) ──
const PALETTE = {
  '.': [0, 0, 0, 0], // 투명
  K: [58, 46, 42, 255], // 아웃라인(먹색)
  W: [255, 250, 240, 255], // 크림/밥
  R: [229, 101, 78, 255], // 토마토레드
  r: [194, 74, 55, 255], // 진한 레드(고기속살)
  Y: [242, 177, 52, 255], // 머스터드
  G: [242, 193, 78, 255], // 골드
  L: [127, 176, 105, 255], // 잎/파
  l: [93, 143, 76, 255], // 진초록
  B: [176, 122, 74, 255], // 빵/튀김옷
  b: [122, 74, 43, 255], // 진한 갈색
  T: [232, 201, 154, 255], // 면/탄수
  O: [224, 138, 60, 255], // 국물(주황)
  P: [229, 138, 160, 255], // 핑크(어묵/새우)
  S: [108, 180, 217, 255], // 하늘
  A: [176, 168, 158, 255], // 회색
  N: [42, 42, 46, 255], // 김(진회색)
  M: [240, 147, 107, 255], // 연어/살
  F: [242, 201, 160, 255], // 피부(마스코트)
  V: [63, 110, 168, 255], // 넥타이 네이비(마스코트)
};

// ── 공통 그릇 템플릿 (국물요리 계열) ──
// 'c' = 내용물(국물색), 'W' = 그릇 몸통, 'K' = 아웃라인.
const BOWL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..KKKKKKKKKKKK..',
  '.KccccccccccccK.',
  '.KccccccccccccK.',
  '.KKKKKKKKKKKKKK.',
  '.KWWWWWWWWWWWWK.',
  '.KWWWWWWWWWWWWK.',
  '..KWWWWWWWWWWK..',
  '...KWWWWWWWWK...',
  '....KKKKKKKK....',
  '................',
];

// 김 오르는 연출 (선택) — 그릇 위 rows 2~5
const STEAM = [
  [5, 2], [5, 3], [5, 4],
  [8, 1], [8, 2], [8, 3],
  [10, 3], [10, 4], [10, 5],
];

/** 그릇 아이콘 조립: 국물색 + 고명(overlay) + 김 여부 */
function bowl(broth, garnish = [], steam = true) {
  const g = BOWL.map((row) => row.replaceAll('c', broth).split(''));
  if (steam) for (const [x, y] of STEAM) if (g[y][x] === '.') g[y][x] = 'A';
  for (const [x, y, ch] of garnish) g[y][x] = ch;
  return g.map((r) => r.join(''));
}

// 고명 좌표는 내용물 영역(rows 7~8, cols 2~13) 기준.
const ICONS = {
  // ── 국물/밥 계열 (그릇 템플릿) ──
  gukbap: bowl('O', [[4, 7, 'W'], [5, 8, 'W'], [7, 7, 'L'], [9, 8, 'L'], [11, 7, 'W']]), // 국밥·탕
  'noodle-ko': bowl('T', [[4, 7, 'L'], [6, 8, 'W'], [9, 7, 'L'], [11, 8, 'r']]), // 면류(칼국수·냉면)
  guksu: bowl('T', [[5, 7, 'P'], [6, 7, 'P'], [9, 8, 'L'], [10, 8, 'L']]), // 국수·우동
  jjajang: bowl('b', [[5, 7, 'L'], [8, 8, 'W'], [10, 7, 'b']], false), // 짜장·짬뽕
  mala: bowl('R', [[4, 7, 'r'], [7, 8, 'K'], [9, 7, 'r'], [11, 8, 'K']]), // 마라·훠궈
  juk: bowl('W', [[6, 7, 'r'], [9, 8, 'L']]), // 죽·건강식
  ramen: bowl('O', [[3, 7, 'N'], [3, 8, 'N'], [6, 7, 'L'], [10, 7, 'Y'], [10, 8, 'Y'], [11, 8, 'r']]), // 라멘·우동
  donburi: bowl('T', [[4, 7, 'M'], [5, 7, 'M'], [8, 8, 'L'], [10, 7, 'M'], [11, 8, 'r']], false), // 덮밥
  pho: bowl('T', [[4, 8, 'L'], [6, 7, 'L'], [9, 7, 'M'], [10, 8, 'M'], [11, 7, 'M']]), // 쌀국수·베트남
  curry: bowl('O', [[3, 7, 'W'], [4, 7, 'W'], [3, 8, 'W'], [9, 8, 'Y'], [11, 7, 'b']], false), // 인도·커리
  salad: bowl('L', [[4, 7, 'R'], [7, 8, 'Y'], [10, 7, 'R'], [6, 7, 'l']], false), // 샐러드·포케
  jjigae: bowl('R', [[4, 8, 'W'], [6, 7, 'W'], [9, 8, 'L'], [10, 7, 'W']]), // 찌개·백반

  // ── 개별 도트 (고유 실루엣) ──
  grill: [ // 고기구이
    '................',
    '................',
    '..RRRR....RRRR..',
    '.RbbbbR..RbbbbR.',
    '.RbrrbR..RbrrbR.',
    '.RbbbbR..RbbbbR.',
    '..RRRR....RRRR..',
    '................',
    'KKKKKKKKKKKKKKKK',
    'K..K..K..K..K..K',
    'KKKKKKKKKKKKKKKK',
    '.K..K..K..K..K..',
    '.KKKKKKKKKKKKKK.',
    '................',
    '................',
    '................',
  ],
  gimbap: [ // 떡볶이·김밥
    '................',
    '.....KKKK.......',
    '...KKNNNNKK.....',
    '..KNNWWWWNNK....',
    '..KNWLRYGWNK....',
    '.KNWWLRYGWWNK...',
    '.KNWWLRYGWWNK...',
    '..KNWLRYGWNK....',
    '..KNNWWWWNNK....',
    '...KKNNNNKK.....',
    '.....KKKK.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  skewer: [ // 양꼬치·중식당
    '.......K........',
    '.......K........',
    '....KKKKKKK.....',
    '...KbbbbbbbK....',
    '...KbrrrrrbK....',
    '...KbbbbbbbK....',
    '....KKKKKKK.....',
    '.......K........',
    '....KKKKKKK.....',
    '...KbbbbbbbK....',
    '...KbrrrrrbK....',
    '...KbbbbbbbK....',
    '....KKKKKKK.....',
    '.......K........',
    '.......K........',
    '................',
  ],
  sushi: [ // 초밥·회
    '................',
    '................',
    '................',
    '....KKKKKKKK....',
    '...KMMMMMMMMK...',
    '...KMWMMWMMMK...',
    '...KMMMMMMMMK...',
    '..KWWWWWWWWWWK..',
    '..KWWWWWWWWWWK..',
    '..KWWWWWWWWWWK..',
    '...KKKKKKKKKK...',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  katsu: [ // 돈카츠·카레
    '................',
    '................',
    '..KKKKKKKKKKKK..',
    '.KYBYBYBYBYBYK..',
    '.KBYBYBYBYBYBK..',
    '.KYBYBYBYBYBYK..',
    '.KKKKKKKKKKKKK..',
    '................',
    '..KKKKKKKKKKKK..',
    '.KBYBYBYBYBYBK..',
    '.KYBYBYBYBYBYK..',
    '.KBYBYBYBYBYBK..',
    '.KKKKKKKKKKKKK..',
    '................',
    '................',
    '................',
  ],
  pizza: [ // 파스타·피자
    '................',
    '...KKKKKKKKKK...',
    '..KBBBBBBBBBBK..',
    '..KYYYYYYYYYYK..',
    '..KYYRYYYYRYYK..',
    '...KYYYYYYYYK...',
    '...KYYRYYYYYK...',
    '....KYYYYYYK....',
    '....KYYYYRYK....',
    '.....KYYYYK.....',
    '.....KYYYYK.....',
    '......KYYK......',
    '......KYYK......',
    '.......KK.......',
    '................',
    '................',
  ],
  burger: [ // 버거
    '................',
    '....KKKKKKKK....',
    '..KKBBBBBBBBKK..',
    '.KBBWBBBBWBBBK..',
    '.KBBBBBBBBBBBK..',
    '.KKKKKKKKKKKKK..',
    '.KLLLLLLLLLLLK..',
    '.KRRRRRRRRRRRK..',
    '.KbbbbbbbbbbbK..',
    '.KKKKKKKKKKKKK..',
    '.KYBBBBBBBBYK...',
    '.KBBBBBBBBBBK...',
    '..KKBBBBBBKK....',
    '....KKKKKK......',
    '................',
    '................',
  ],
  steak: [ // 스테이크·비스트로
    '................',
    '................',
    '.....KKKKKK.....',
    '...KKbbbbbbKK...',
    '..KbbBBBBBBbbK..',
    '..KbBBrrrrBBbK..',
    '..KbBrrrrrrBbK..',
    '..KbBBrrrrBBbK..',
    '..KbbBBBBBBbbK..',
    '...KKbbbbbbKK...',
    '.....KKKKKK.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  thai: [ // 태국·팟타이
    '................',
    '................',
    '.....YYYYY......',
    '....YYPYYYY.....',
    '...YYYYYYYPY....',
    '...YYPYYYYYY....',
    '..YYYYYYYYYYY...',
    '.KKKKKKKKKKKKKK.',
    'KWWWWWWWWWWWWWWK',
    '.KWWWWWWWWWWWWK.',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  sandwich: [ // 샌드위치·브런치
    '................',
    '.........KKK....',
    '........KTTTK...',
    '.......KTTTTK...',
    '......KTLLLTK...',
    '.....KTRRRTK....',
    '....KTWWWTK.....',
    '...KTTTTTK......',
    '..KTTTTTK.......',
    '.KKKKKKK........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  bento: [ // 도시락
    '................',
    '.KKKKKKKKKKKKKK.',
    '.KWWWWWWWWWWWWK.',
    '.KWRRWWLLWWYYWK.',
    '.KWRRWWLLWWYYWK.',
    '.KWWWWWWWWWWWWK.',
    '.KLLWWYYWWRRWWK.',
    '.KLLWWYYWWRRWWK.',
    '.KWWWWWWWWWWWWK.',
    '.KKKKKKKKKKKKKK.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  buffet: [ // 뷔페·구내식당
    '................',
    '................',
    '...RR...LL......',
    '..RRRR.LLLL.YY..',
    '..RRRR.LLLLYYYY.',
    '...RR...LL..YY..',
    '................',
    'KKKKKKKKKKKKKKKK',
    'KWWWWWWWWWWWWWWK',
    '.KWWWWWWWWWWWWK.',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  fallback: [ // 매핑 실패
    '..K........K....',
    '..K.K.K....K....',
    '..K.K.K....K....',
    '..KKKKK....KK...',
    '...KKK.....KK...',
    '....K......KK...',
    '....K......K....',
    '....K......K....',
    '....K......K....',
    '....K......K....',
    '....K......K....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

// ── PNG 인코더 (zlib만 사용, 외부 의존 0) ──
function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const raw = Buffer.alloc(h * (1 + w * 4));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // 필터 타입 None
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      const rgba = PALETTE[ch];
      if (!rgba) throw new Error(`알 수 없는 팔레트 문자 '${ch}' (${x},${y})`);
      raw[p++] = rgba[0];
      raw[p++] = rgba[1];
      raw[p++] = rgba[2];
      raw[p++] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 검증 + 생성 ──
function validate(slug, grid) {
  if (grid.length !== 16) throw new Error(`${slug}: 행 개수 ${grid.length}≠16`);
  grid.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`${slug}: row ${y} 길이 ${row.length}≠16 ("${row}")`);
  });
}

export { ICONS, PALETTE, encodePng, validate };

// 직접 실행 시에만 PNG 파일 생성 (import 시엔 데이터만 노출)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const [slug, grid] of Object.entries(ICONS)) {
    validate(slug, grid);
    writeFileSync(join(OUT_DIR, `${slug}.png`), encodePng(grid));
    count++;
  }
  console.log(`✓ ${count}개 아이콘 생성 → ${OUT_DIR}`);
}
