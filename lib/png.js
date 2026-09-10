// Minimal PNG encoder, 5x7 bitmap font and a bar-chart renderer — pure Node (node:zlib),
// no external dependencies. Used to put generated charts into Feishu documents.

import { deflateSync } from "node:zlib";

// ---------- PNG encoding ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode raw RGB pixel data (width*height*3) as a PNG buffer. */
export function encodePNG(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 5x7 bitmap font (uppercase ASCII subset) ----------
const GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export function textWidth(text, scale = 1) {
  return String(text).length * 6 * scale;
}

/** Tiny RGB canvas with rectangle and bitmap-text drawing. */
export class Canvas {
  constructor(width, height, background = [255, 255, 255]) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }

  fillRect(x, y, w, h, [r, g, b]) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.width + xx) * 3;
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
  }

  drawText(x, y, text, color = [0, 0, 0], scale = 1) {
    let cursor = x;
    for (const ch of String(text).toUpperCase()) {
      const glyph = GLYPHS[ch] ?? GLYPHS[" "];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === "1") {
            this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += 6 * scale;
    }
    return cursor;
  }

  toPNG() {
    return encodePNG(this.width, this.height, this.data);
  }
}

function niceNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? n.toFixed(0) : abs >= 10 ? n.toFixed(0) : n.toFixed(1);
  return s.replace(/\.0$/, "");
}

/**
 * Render a bar chart PNG (no dependencies).
 * Title and category labels are drawn with a 5x7 uppercase ASCII font;
 * non-ASCII characters are dropped, so keep labels ASCII or omit them.
 */
export function renderBarChart({ title = "", categories = [], values = [], width = 900, height = 520 } = {}) {
  const canvas = new Canvas(width, height, [255, 255, 255]);
  const axisColor = [180, 184, 190];
  const gridColor = [232, 235, 240];
  const palette = [
    [51, 112, 255],
    [54, 207, 201],
    [255, 197, 61],
    [245, 63, 63],
    [134, 97, 245],
    [0, 168, 112],
  ];
  const padLeft = 70;
  const padRight = 30;
  const padTop = title ? 60 : 30;
  const padBottom = categories.length ? 60 : 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (title) canvas.drawText(padLeft, 24, title, [30, 34, 40], 2);

  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(1, ...nums);
  const bars = Math.max(nums.length, 1);
  const slot = plotW / bars;
  const barW = Math.max(6, Math.min(90, slot * 0.55));

  // horizontal gridlines + value scale
  for (let g = 0; g <= 4; g++) {
    const y = padTop + (plotH * g) / 4;
    canvas.fillRect(padLeft, y, plotW, 1, gridColor);
    const label = niceNumber((max * (4 - g)) / 4);
    canvas.drawText(padLeft - 12 - textWidth(label, 1), y - 3, label, [140, 146, 155], 1);
  }

  // axes
  canvas.fillRect(padLeft, padTop, 1, plotH, axisColor);
  canvas.fillRect(padLeft, padTop + plotH, plotW, 1, axisColor);

  nums.forEach((value, i) => {
    const h = Math.max(1, (value / max) * plotH);
    const x = padLeft + slot * i + (slot - barW) / 2;
    const y = padTop + plotH - h;
    canvas.fillRect(x, y, barW, h, palette[i % palette.length]);
    const label = niceNumber(value);
    canvas.drawText(x + (barW - textWidth(label, 1)) / 2, y - 12, label, [60, 66, 76], 1);
    const cat = categories[i];
    if (cat) {
      const text = String(cat).toUpperCase();
      canvas.drawText(padLeft + slot * i + (slot - textWidth(text, 1)) / 2, padTop + plotH + 12, text, [90, 96, 106], 1);
    }
  });

  return canvas.toPNG();
}
