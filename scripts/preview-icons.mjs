// 아이콘 검수용 컨택트 시트 (확대 타일). 임시 검수 도구.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { ICONS, PALETTE, encodePng } from './gen-icons.mjs';

const SCALE = 8;
const COLS = 5;
const PAD = 2; // 타일 사이 간격(px, 확대 후)
const CELL = 16 * SCALE;
const GAP = PAD * SCALE;
const BG = [40, 30, 25, 255]; // 슬롯 릴처럼 어두운 배경에서 검수

const slugs = Object.keys(ICONS);
const rows = Math.ceil(slugs.length / COLS);
const W = COLS * CELL + (COLS + 1) * GAP;
const H = rows * CELL + (rows + 1) * GAP;

// 확대 그리드 캔버스 (문자 그리드) — 배경은 특수 처리 위해 rgba 버퍼 직접 구성
const buf = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  buf[i * 4] = BG[0];
  buf[i * 4 + 1] = BG[1];
  buf[i * 4 + 2] = BG[2];
  buf[i * 4 + 3] = 255;
}

function blend(px, py, rgba) {
  if (rgba[3] === 0) return;
  const idx = (py * W + px) * 4;
  buf[idx] = rgba[0];
  buf[idx + 1] = rgba[1];
  buf[idx + 2] = rgba[2];
  buf[idx + 3] = 255;
}

slugs.forEach((slug, n) => {
  const grid = ICONS[slug];
  const col = n % COLS;
  const row = Math.floor(n / COLS);
  const ox = GAP + col * (CELL + GAP);
  const oy = GAP + row * (CELL + GAP);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const rgba = PALETTE[grid[y][x]];
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          blend(ox + x * SCALE + sx, oy + y * SCALE + sy, rgba);
        }
      }
    }
  }
});

// buf → PNG (encodePng는 문자 그리드 기반이라 여기선 자체 인코딩)
function crc32(b) {
  let c = ~0 >>> 0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
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
const raw = Buffer.alloc(H * (1 + W * 4));
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    raw[p++] = buf[i];
    raw[p++] = buf[i + 1];
    raw[p++] = buf[i + 2];
    raw[p++] = buf[i + 3];
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] ?? 'preview-icons.png';
writeFileSync(out, png);
console.log(`✓ 컨택트 시트 → ${out}  (${slugs.join(', ')})`);
