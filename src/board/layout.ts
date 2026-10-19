import type { Placement } from '../lesson/schema'

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }

const SIDE_X = 1180
const SIDE_GAP = 120
const COLUMN_HEIGHT = 1000
const COLUMN_GAP = 160

const REGIONS = {
  title: { x: 40, y: 40 },
  main: { x: 40, y: 140 },
} as const

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export class Layout {
  private items = new Map<string, Rect>()
  private side = new Set<string>()
  private columnX: number = REGIONS.main.x

  reset() {
    this.items.clear()
    this.side.clear()
    this.columnX = REGIONS.main.x
  }

  place(id: string, at: Placement, size: Size): Rect {
    const pos = this.origin(id, at, size)
    const dir = 'right_of' in at ? 'right' : 'left_of' in at ? 'left' : 'above' in at ? 'up' : 'down'
    const rect = this.fit(id, { x: pos.x, y: pos.y, width: size.width, height: size.height }, dir, 24)
    if (this.onSide(at)) this.side.add(id)
    return rect
  }

  // Takes the spot, moving away from anything already there (keeping `gap` clear around it).
  fit(id: string, rect: Rect, dir: 'right' | 'left' | 'up' | 'down' = 'down', gap = 0): Rect {
    const r = { ...rect }
    const near = (o: Rect) => overlaps({ x: r.x - gap, y: r.y - gap, width: r.width + gap * 2, height: r.height + gap * 2 }, o)
    for (let n = 0; n < 80 && [...this.items].some(([k, o]) => k !== id && near(o)); n++) {
      if (dir === 'right') r.x += 32
      else if (dir === 'left') r.x -= 32
      else if (dir === 'up') r.y -= 32
      else r.y += 32
    }
    this.items.set(id, r)
    return r
  }

  resize(id: string, width: number, height: number) {
    const r = this.items.get(id)
    if (r) this.items.set(id, { ...r, width, height })
  }

  get(id: string) {
    return this.items.get(id)
  }

  remove(id: string) {
    this.items.delete(id)
    this.side.delete(id)
  }

  isSide(id: string) {
    return this.side.has(id)
  }

  markSide(id: string) {
    this.side.add(id)
  }

  sideIds() {
    return [...this.side]
  }

  clearSide() {
    for (const id of this.side) this.items.delete(id)
    this.side.clear()
  }

  onSide(at: Placement) {
    if ('region' in at) return at.region === 'side'
    const id = 'below' in at ? at.below : 'right_of' in at ? at.right_of : 'left_of' in at ? at.left_of : at.above
    return this.side.has(id)
  }

  private sideOrigin() {
    let x = SIDE_X
    for (const [id, r] of this.items) if (!this.side.has(id)) x = Math.max(x, r.x + r.width + SIDE_GAP)
    return { x, y: REGIONS.main.y }
  }

  // A new idea starts a fresh row under the current column. Once the column is tall, the next
  // idea starts a new column to the right, like a teacher moving across the board.
  // `self` is left out so drawing an item again (after a pause or skip) keeps its spot.
  private nextRow(self: string) {
    const main = [...this.items].filter(([id, r]) => id !== self && !this.side.has(id) && r.y >= REGIONS.main.y)
    let y: number = REGIONS.main.y
    for (const [, r] of main) if (r.x >= this.columnX - 40) y = Math.max(y, r.y + r.height + 80)
    if (y > COLUMN_HEIGHT) {
      this.columnX = Math.max(...main.map(([, r]) => r.x + r.width)) + COLUMN_GAP
      y = REGIONS.main.y
    }
    return { x: this.columnX, y }
  }

  private origin(self: string, at: Placement, size: Size): { x: number; y: number } {
    if ('region' in at) {
      if (at.region === 'side') return this.sideOrigin()
      return at.region === 'main' ? this.nextRow(self) : REGIONS.title
    }
    const id = 'below' in at ? at.below : 'right_of' in at ? at.right_of : 'left_of' in at ? at.left_of : at.above
    const a = this.items.get(id)
    if (!a) return this.nextRow(self)
    const midY = a.y + (a.height - size.height) / 2
    if ('below' in at) return { x: a.x + (a.width - size.width) / 2, y: a.y + a.height + 80 }
    if ('right_of' in at) return { x: a.x + a.width + 100, y: midY }
    if ('left_of' in at) return { x: a.x - 88 - size.width, y: midY }
    return { x: a.x, y: a.y - 48 - size.height }
  }
}
