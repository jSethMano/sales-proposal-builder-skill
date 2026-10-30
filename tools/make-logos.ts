// Draws the fictional demo logos as PNGs, so they are reproducible from the repo:
//   npm run logos
// The marks are wordless shapes in each pack's colors. The company name appears in the document
// itself, so the logo doesn't need text.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

type RGBA = [number, number, number, number];
type Shader = (x: number, y: number) => RGBA;

// 4×4 samples per pixel smooths the edges enough for a logo shown at 110–220 px wide.
const SAMPLES = 4;
const TRANSPARENT: RGBA = [0, 0, 0, 0];

function hex(h: string, alpha = 255): RGBA {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function render(width: number, height: number, shade: Shader): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [cr, cg, cb, ca] = shade(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          // Premultiply so transparent samples don't darken the edge.
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round(a / (SAMPLES * SAMPLES));
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10–12: deflate compression, adaptive filtering, no interlace (all zero)
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x: number, y: number, w: number, h: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function lineThrough(points: [number, number][], x: number): number {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] as [number, number];
    const [x1, y1] = points[i] as [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return (points[points.length - 1] as [number, number])[1];
}

// Lumen Ridge IT: a navy panel with an orange ridge line and a low sun. 3:1, to exercise wide logos.
function lumenRidge(): Buffer {
  const W = 360;
  const H = 120;
  const navy = hex("#1F3A5F");
  const orange = hex("#E07A2E");
  const sun = hex("#F4B183");
  const ridge: [number, number][] = [[0, 96], [70, 60], [112, 78], [172, 30], [232, 72], [272, 56], [360, 90]];
  return encodePng(W, H, render(W, H, (x, y) => {
    if (!insideRoundedRect(x, y, W, H, 18)) return TRANSPARENT;
    if (y > lineThrough(ridge, x)) return orange;
    if ((x - 262) ** 2 + (y - 34) ** 2 <= 14 ** 2) return sun;
    return navy;
  }));
}

// Ironbark Managed Services: green growth rings on a sand disc. Square, to exercise tall logos.
function ironbark(): Buffer {
  const S = 160;
  const sand = hex("#D8C3A5");
  const green = hex("#2F5D3A");
  const rings: [number, number][] = [[0, 7], [16, 24], [33, 41], [50, 58], [67, 73]];
  return encodePng(S, S, render(S, S, (x, y) => {
    if ((x - 80) ** 2 + (y - 80) ** 2 > 78 ** 2) return TRANSPARENT;
    // The rings' center sits slightly off the disc's center, the way real growth rings do.
    const d = Math.hypot(x - 85, y - 76);
    return rings.some(([from, to]) => d >= from && d <= to) ? green : sand;
  }));
}

// A plain test logo for fixtures: 40×20, one color.
function testLogo(): Buffer {
  return encodePng(40, 20, render(40, 20, () => hex("#336699")));
}

const outputs: [string, Buffer][] = [
  ["packs/lumen-ridge-it/logo.png", lumenRidge()],
  ["packs/ironbark-msp/logo.png", ironbark()],
  ["test/fixtures/packs/test-usd/logo.png", testLogo()],
];
for (const [file, data] of outputs) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`${file}  ${data.length} bytes`);
}
