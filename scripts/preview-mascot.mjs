// 마스코트 검수용 확대 시트 (임시).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { PALETTE } from './gen-icons.mjs';
import { MASCOTS } from './gen-mascot.mjs';

const SCALE = 9;
const GAP = 12;
const S = 24;
const CELL = S * SCALE;
const names = Object.keys(MASCOTS);
const W = names.length * CELL + (names.length + 1) * GAP;
const H = CELL + GAP * 2;
const BG = [255, 250, 240, 255]; // paper

const buf = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255;
}
names.forEach((name, n) => {
  const g = MASCOTS[name];
  const ox = GAP + n * (CELL + GAP);
  const oy = GAP;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rgba = PALETTE[g[y][x]];
    if (rgba[3] === 0) continue;
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      const i = ((oy + y * SCALE + sy) * W + (ox + x * SCALE + sx)) * 4;
      buf[i] = rgba[0]; buf[i + 1] = rgba[1]; buf[i + 2] = rgba[2]; buf[i + 3] = 255;
    }
  }
});

function crc32(b) { let c = ~0 >>> 0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tt = Buffer.from(t, 'ascii'); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc32(Buffer.concat([tt, d])), 0); return Buffer.concat([l, tt, d, cc]); }
const raw = Buffer.alloc(H * (1 + W * 4)); let p = 0;
for (let y = 0; y < H; y++) { raw[p++] = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; raw[p++] = buf[i]; raw[p++] = buf[i + 1]; raw[p++] = buf[i + 2]; raw[p++] = buf[i + 3]; } }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = process.argv[2] ?? 'preview-mascot.png';
writeFileSync(out, png);
console.log(`✓ ${out}  (${names.join(', ')})`);
