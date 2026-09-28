import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'public', 'gpt-observatory.ico')
await mkdir(dirname(output), { recursive: true })

const sizes = [16, 24, 32, 48, 64, 96, 128]
const images = sizes.map(renderDibIcon)

const headerSize = 6 + sizes.length * 16
const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)

let offset = headerSize
for (let i = 0; i < sizes.length; i += 1) {
  const size = sizes[i]
  const image = images[i]
  const entry = 6 + i * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header[entry + 2] = 0
  header[entry + 3] = 0
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
}

await writeFile(output, Buffer.concat([header, ...images]))
console.log(output)

function renderDibIcon(size) {
  const xorStride = size * 4
  const andStride = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(xorStride * size, 20)

  const pixels = Buffer.alloc(xorStride * size)
  const mask = Buffer.alloc(andStride * size)
  const samples = 4

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let rr = 0
      let gg = 0
      let bb = 0
      let aa = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size
          const y = (py + (sy + 0.5) / samples) / size
          const [r, g, b, a] = sample(x, y)
          rr += r * a
          gg += g * a
          bb += b * a
          aa += a
        }
      }
      const n = samples * samples
      const alpha = aa / n
      const r = aa > 0 ? rr / aa : 0
      const g = aa > 0 ? gg / aa : 0
      const b = aa > 0 ? bb / aa : 0
      const row = size - 1 - py
      const index = row * xorStride + px * 4
      pixels[index] = Math.round(b)
      pixels[index + 1] = Math.round(g)
      pixels[index + 2] = Math.round(r)
      pixels[index + 3] = Math.round(alpha * 255)
    }
  }

  return Buffer.concat([header, pixels, mask])
}

function sample(x, y) {
  const background = roundedRect(x, y, 0.06, 0.06, 0.88, 0.88, 0.23)
  let color = [0, 0, 0, 0]

  if (background > 0) {
    const t = Math.max(0, Math.min(1, (x + y - 0.15) / 1.7))
    color = mix(color, [72 - 32 * t, 87 - 37 * t, 97 - 41 * t, background])
  }

  const orbit1 = ellipseStroke(x, y, 0.5, 0.5, 0.31, 0.15, 28 * Math.PI / 180, 0.027)
  color = mix(color, [174, 191, 203, orbit1 * 0.95])

  const orbit2 = ellipseStroke(x, y, 0.5, 0.5, 0.31, 0.15, -28 * Math.PI / 180, 0.022)
  color = mix(color, [175, 192, 170, orbit2 * 0.82])

  color = mix(color, [245, 242, 232, circle(x, y, 0.5, 0.5, 0.075)])
  color = mix(color, [198, 170, 128, circle(x, y, 0.722, 0.36, 0.052)])
  color = mix(color, [175, 192, 170, circle(x, y, 0.278, 0.64, 0.044)])
  color = mix(color, [170, 187, 200, circle(x, y, 0.28, 0.32, 0.036)])

  return color
}

function roundedRect(x, y, left, top, width, height, radius) {
  const cx = Math.max(left + radius, Math.min(x, left + width - radius))
  const cy = Math.max(top + radius, Math.min(y, top + height - radius))
  const distance = Math.hypot(x - cx, y - cy)
  return smooth(radius + 0.012 - distance, 0, 0.012)
}

function circle(x, y, cx, cy, radius) {
  return smooth(radius + 0.009 - Math.hypot(x - cx, y - cy), 0, 0.009)
}

function ellipseStroke(x, y, cx, cy, rx, ry, angle, thickness) {
  const dx = x - cx
  const dy = y - cy
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const xr = dx * ca + dy * sa
  const yr = -dx * sa + dy * ca
  const d = Math.sqrt((xr * xr) / (rx * rx) + (yr * yr) / (ry * ry))
  return smooth(thickness - Math.abs(d - 1), 0, thickness * 0.55)
}

function smooth(value, edge0, edge1) {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function mix(base, top) {
  const ba = base[3]
  const ta = top[3]
  const oa = ta + ba * (1 - ta)
  if (oa <= 0) return [0, 0, 0, 0]
  return [
    (top[0] * ta + base[0] * ba * (1 - ta)) / oa,
    (top[1] * ta + base[1] * ba * (1 - ta)) / oa,
    (top[2] * ta + base[2] * ba * (1 - ta)) / oa,
    oa,
  ]
}
