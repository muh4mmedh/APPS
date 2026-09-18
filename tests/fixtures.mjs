/*
 * Test fixtures: synthetic photographs of a cube.
 *
 * Six images, each lit differently on purpose — a warm dim lamp, bright cool
 * daylight, a strong falloff across the face — because reading one photo is
 * easy and reconciling six taken in different light is the actual problem.
 * Written as PNGs so the tests can feed them through a real file input and
 * exercise the whole path a person's photos take.
 */
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Colour = require('../apps/rubiks-solver/js/colour.js');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (stride + 1)] = 0;
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// exposure, colour cast, and how sharply brightness falls across the face
const LIGHTING = [
  { exposure: 1.00, cast: [1.00, 1.00, 1.00], falloff: 0.05 },
  { exposure: 0.62, cast: [1.14, 1.00, 0.88], falloff: 0.22 },
  { exposure: 1.28, cast: [0.92, 1.00, 1.12], falloff: 0.10 },
  { exposure: 0.80, cast: [1.06, 1.00, 0.95], falloff: 0.30 },
  { exposure: 1.05, cast: [1.00, 1.02, 1.00], falloff: 0.08 },
  { exposure: 0.70, cast: [1.10, 1.00, 0.92], falloff: 0.18 }
];

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SIZE = 300;
const MARGIN = 0.12;   // the face does not fill the frame, as it would not in life

/**
 * Write six face photos of `state` into `dir`. Returns their paths, in the
 * order the app asks for the faces.
 */
export function writeCubePhotos(dir, state, palette) {
  mkdirSync(dir, { recursive: true });
  const colours = palette || Colour.defaultPalette();
  const paths = [];

  FACES.forEach((face, fi) => {
    const light = LIGHTING[fi];
    const buf = Buffer.alloc(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE, v = y / SIZE;
        let sticker = null;
        if (u > MARGIN && u < 1 - MARGIN && v > MARGIN && v < 1 - MARGIN) {
          const cu = (u - MARGIN) / (1 - 2 * MARGIN);
          const cv = (v - MARGIN) / (1 - 2 * MARGIN);
          const col = Math.min(2, Math.floor(cu * 3));
          const row = Math.min(2, Math.floor(cv * 3));
          // leave the dark gaps a real cube has between its stickers
          if (cu * 3 - col > 0.06 && cu * 3 - col < 0.94 &&
              cv * 3 - row > 0.06 && cv * 3 - row < 0.94) {
            sticker = state[fi * 9 + row * 3 + col];
          }
        }
        const lin = sticker
          ? Colour.srgbToLinear(Colour.hexToRgb(colours[sticker]))
          : [0.02, 0.02, 0.025];
        const shade = 1 + light.falloff * (u - 0.5) + light.falloff * 0.6 * (v - 0.5);
        const out = Colour.linearToSrgb([
          lin[0] * light.exposure * light.cast[0] * shade,
          lin[1] * light.exposure * light.cast[1] * shade,
          lin[2] * light.exposure * light.cast[2] * shade
        ]);
        const i = (y * SIZE + x) * 4;
        buf[i] = out.r; buf[i + 1] = out.g; buf[i + 2] = out.b; buf[i + 3] = 255;
      }
    }
    const path = join(dir, `${fi}-${face}.png`);
    writeFileSync(path, encodePng(SIZE, SIZE, buf));
    paths.push(path);
  });

  return paths;
}
