export type Rect = { x: number; y: number; width: number; height: number }

type Pt = { x: number; y: number }
type Side = 'top' | 'bottom' | 'left' | 'right'

const PAD = 6
const GAP = 16

export function routeArrow(from: Rect, to: Rect, blocks: Rect[], fromDrop = 0, toDrop = 0) {
  const a = port(from, fromDrop, side(from, to))
  const b = port(to, toDrop, side(to, from))
  return norm(link(a, b, blocks))
}

function side(self: Rect, other: Rect): Side {
  const dx = other.x + other.width / 2 - (self.x + self.width / 2)
  const dy = other.y + other.height / 2 - (self.y + self.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function port(r: Rect, drop: number, edge: Side): Pt {
  const mx = r.x + r.width / 2
  const my = r.y + r.height / 2
  if (edge === 'top') return { x: mx, y: r.y - GAP }
  if (edge === 'bottom') return { x: mx, y: r.y + r.height + drop + GAP }
  if (edge === 'left') return { x: r.x - GAP, y: my }
  return { x: r.x + r.width + GAP, y: my }
}

function link(a: Pt, b: Pt, blocks: Rect[]): Pt[] {
  if (Math.abs(a.x - b.x) <= 12 && !hits([a, { x: a.x, y: b.y }], blocks)) {
    return [a, { x: a.x, y: b.y }]
  }
  if (Math.abs(a.y - b.y) <= 12 && !hits([a, { x: b.x, y: a.y }], blocks)) {
    return [a, { x: b.x, y: a.y }]
  }
  const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x)
  const elbow = vertical ? [a, { x: a.x, y: b.y }, b] : [a, { x: b.x, y: a.y }, b]
  const flip = vertical ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]
  if (!hits(elbow, blocks)) return elbow
  if (!hits(flip, blocks)) return flip
  return vertical ? detourY(a, b, blocks) : detourX(a, b, blocks)
}

function detourY(a: Pt, b: Pt, blocks: Rect[]): Pt[] {
  let best = [a, b]
  let bestN = Infinity
  for (const rail of rails(blocks, 'x', a, b)) {
    const y1 = hopY(a, b.y, rail, blocks)
    const y2 = hopY(b, a.y, rail, blocks)
    const path = dedupe([
      a,
      { x: a.x, y: y1 },
      { x: rail, y: y1 },
      { x: rail, y: y2 },
      { x: b.x, y: y2 },
      b,
    ])
    const n = count(path, blocks)
    if (n === 0) return path
    if (n < bestN) {
      best = path
      bestN = n
    }
  }
  return best
}

function detourX(a: Pt, b: Pt, blocks: Rect[]): Pt[] {
  let best = [a, b]
  let bestN = Infinity
  for (const rail of rails(blocks, 'y', a, b)) {
    const x1 = hopX(a, b.x, rail, blocks)
    const x2 = hopX(b, a.x, rail, blocks)
    const path = dedupe([
      a,
      { x: x1, y: a.y },
      { x: x1, y: rail },
      { x: x2, y: rail },
      { x: x2, y: b.y },
      b,
    ])
    const n = count(path, blocks)
    if (n === 0) return path
    if (n < bestN) {
      best = path
      bestN = n
    }
  }
  return best
}

function hopY(from: Pt, towardY: number, rail: number, blocks: Rect[]) {
  const dir = Math.sign(towardY - from.y) || 1
  const limit = Math.abs(towardY - from.y)
  for (let d = 0; d <= limit; d += 8) {
    const y = from.y + dir * d
    if (!hits([from, { x: from.x, y }, { x: rail, y }], blocks)) return y
  }
  return from.y
}

function hopX(from: Pt, towardX: number, rail: number, blocks: Rect[]) {
  const dir = Math.sign(towardX - from.x) || 1
  const limit = Math.abs(towardX - from.x)
  for (let d = 0; d <= limit; d += 8) {
    const x = from.x + dir * d
    if (!hits([from, { x, y: from.y }, { x, y: rail }], blocks)) return x
  }
  return from.x
}

function rails(blocks: Rect[], axis: 'x' | 'y', a: Pt, b: Pt) {
  const vals = axis === 'x' ? [a.x, b.x] : [a.y, b.y]
  for (const r of blocks) {
    if (axis === 'x') vals.push(r.x, r.x + r.width)
    else vals.push(r.y, r.y + r.height)
  }
  const lo = Math.min(...vals) - 48
  const hi = Math.max(...vals) + 48
  const mid = axis === 'x' ? (a.x + b.x) / 2 : (a.y + b.y) / 2
  return [hi, lo].sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid))
}

function norm(path: Pt[]) {
  const pts = dedupe(path)
  const minX = Math.min(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const points = pts.map((p) => [p.x - minX, p.y - minY] as [number, number])
  const last = points[points.length - 1]
  if (last[0] === 0 && points.every((p) => p[0] === 0)) last[0] = 1
  if (last[1] === 0 && points.every((p) => p[1] === 0)) last[1] = 1
  return { x: minX, y: minY, points }
}

function dedupe(path: Pt[]) {
  const out: Pt[] = []
  for (const p of path) {
    const prev = out[out.length - 1]
    if (!prev || Math.abs(prev.x - p.x) > 0.5 || Math.abs(prev.y - p.y) > 0.5) out.push(p)
  }
  return out.length >= 2 ? out : path
}

function hits(path: Pt[], blocks: Rect[]) {
  return count(path, blocks) > 0
}

function count(path: Pt[], blocks: Rect[]) {
  let n = 0
  for (let i = 1; i < path.length; i++) {
    for (const r of blocks) if (crosses(path[i - 1], path[i], r)) n++
  }
  return n
}

function crosses(p: Pt, q: Pt, r: Rect) {
  const x0 = r.x - PAD
  const y0 = r.y - PAD
  const x1 = r.x + r.width + PAD
  const y1 = r.y + r.height + PAD
  if (inside(p, x0, y0, x1, y1) || inside(q, x0, y0, x1, y1)) return true
  return (
    seg(p, q, { x: x0, y: y0 }, { x: x1, y: y0 }) ||
    seg(p, q, { x: x1, y: y0 }, { x: x1, y: y1 }) ||
    seg(p, q, { x: x1, y: y1 }, { x: x0, y: y1 }) ||
    seg(p, q, { x: x0, y: y1 }, { x: x0, y: y0 })
  )
}

function inside(p: Pt, x0: number, y0: number, x1: number, y1: number) {
  return p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1
}

function seg(a: Pt, b: Pt, c: Pt, d: Pt) {
  const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)
  const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y)
  const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y)
  const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}
