import type { Placement } from '../lesson/schema'

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }

export const SIDE_X = 1180

const REGIONS = {
  title: { x: 40, y: 40 },
  main: { x: 40, y: 140 },
  side: { x: SIDE_X, y: 140 },
} as const

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export class Layout {
  private items = new Map<string, Rect>()
  private side = new Set<string>()

  reset() {
    this.items.clear()
    this.side.clear()
  }

  place(id: string, at: Placement, size: Size): Rect {
    const pos = this.origin(at, size)
    const rect = { x: pos.x, y: pos.y, width: size.width, height: size.height }
    for (let n = 0; n < 24 && [...this.items].some(([k, r]) => k !== id && overlaps(rect, r)); n++) {
      if ('right_of' in at) rect.x += 32
      else if ('left_of' in at) rect.x -= 32
      else if ('above' in at) rect.y -= 32
      else rect.y += 32
    }
    if (this.anchorsSide(at)) this.side.add(id)
    this.items.set(id, rect)
    return rect
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

  private anchorsSide(at: Placement) {
    if ('region' in at) return at.region === 'side'
    const id = 'below' in at ? at.below : 'right_of' in at ? at.right_of : 'left_of' in at ? at.left_of : at.above
    return this.side.has(id)
  }

  private origin(at: Placement, size: Size): { x: number; y: number } {
    if ('region' in at) return REGIONS[at.region]
    const id = 'below' in at ? at.below : 'right_of' in at ? at.right_of : 'left_of' in at ? at.left_of : at.above
    const a = this.items.get(id)
    if (!a) return REGIONS.main
    const midY = a.y + (a.height - size.height) / 2
    if ('below' in at) return { x: a.x + (a.width - size.width) / 2, y: a.y + a.height + 80 }
    if ('right_of' in at) return { x: a.x + a.width + 100, y: midY }
    if ('left_of' in at) return { x: a.x - 88 - size.width, y: midY }
    return { x: a.x, y: a.y - 48 - size.height }
  }
}
