// Compiled from src/skill/lib/image.cts. Edit the source, then run npm run build.
// Identifies a logo file from its first bytes and reads its pixel size, without any image library.

export type ImageKind = "png" | "jpg" | "gif" | "webp" | "svg" | "unknown";

export interface ImageHeader {
  kind: ImageKind;
  width: number | null;
  height: number | null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The first PNG chunk must be IHDR: 4-byte length, "IHDR", then width and height as big-endian
// 32-bit integers, which puts them at byte offsets 16 and 20.
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

export function readImageHeader(data: Buffer): ImageHeader {
  if (PNG_SIGNATURE.every((b, i) => data[i] === b) && data.length >= 24 && data.toString("latin1", 12, 16) === "IHDR") {
    return { kind: "png", width: data.readUInt32BE(PNG_WIDTH_OFFSET), height: data.readUInt32BE(PNG_HEIGHT_OFFSET) };
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: "jpg", ...jpegSize(data) };
  if (data.toString("latin1", 0, 4) === "GIF8") return { kind: "gif", width: null, height: null };
  if (data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    return { kind: "webp", width: null, height: null };
  }
  const head = data.toString("utf8", 0, Math.min(data.length, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return { kind: "svg", width: null, height: null };
  }
  return { kind: "unknown", width: null, height: null };
}

// JPEG start-of-frame markers carry the image size. C4 (Huffman tables), C8 (reserved) and
// CC (arithmetic coding) share the range but are not frames.
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(data: Buffer): { width: number | null; height: number | null } {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (SOF_MARKERS.has(marker)) {
      // Segment: FF Cx, 2-byte length, 1-byte precision, 2-byte height, 2-byte width.
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return { width: null, height: null };
}
