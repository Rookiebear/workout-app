// Draws the app icon (a loaded bar, side view) into PNGs without extra dependencies.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x14, 0x14, 0x15]
const PLATE = [0xed, 0xed, 0xed]
const SLEEVE = [0x85, 0x85, 0x8b]
const ACCENT = [0xf0, 0xb4, 0x3c]

// Shapes in a 100×100 design space: [x, y, w, h, radius, color]
const shapes = [
  [12, 47, 30, 6, 1.5, SLEEVE], // shaft
  [40, 41, 5, 18, 1.5, SLEEVE], // collar
  [47, 22, 9, 56, 2.5, PLATE], // 20
  [58, 27, 8, 46, 2.5, PLATE], // 15
  [68, 33, 6, 34, 2, ACCENT], // 10, the one that was just added
  [76, 45, 12, 10, 2, SLEEVE], // sleeve end
]

function inRound(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function draw(size, { pad = 0 } = {}) {
  const ss = 4
  const px = Buffer.alloc(size * size * 3)
  const scale = (100 + pad * 2) / size
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let acc = [0, 0, 0]
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = (i + (sx + 0.5) / ss) * scale - pad
          const y = (j + (sy + 0.5) / ss) * scale - pad
          let c = BG
          for (const s of shapes) if (inRound(x, y, s)) c = s[5]
          acc = acc.map((v, k) => v + c[k])
        }
      const o = (j * size + i) * 3
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(acc[k] / (ss * ss))
    }
  return png(size, px)
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icons/icon-192.png', draw(192, { pad: 10 }))
writeFileSync('public/icons/icon-512.png', draw(512, { pad: 10 }))
writeFileSync('public/icons/apple-touch-icon.png', draw(180, { pad: 6 }))

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${hex(BG)}"/>${shapes
  .map(([x, y, w, h, r, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${hex(c)}"/>`)
  .join('')}</svg>\n`
writeFileSync('public/favicon.svg', svg)
console.log('icons written')
