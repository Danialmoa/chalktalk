import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  FONT_FAMILY,
  newElementWith,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { Action } from '../lesson/schema'
import { Layout, type Rect } from './layout'
import { routeArrow } from './route'

type El = ReturnType<typeof convertToExcalidrawElements>[number]
type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number]
type Pt = { x: number; y: number }
type TextStyle = { size?: number; color?: string; family?: number }

const FONT = {
  hand: FONT_FAMILY.Excalifont,
  code: FONT_FAMILY['Comic Shanns'],
}

const FILLS = ['#e7f5ff', '#fff4e6', '#ebfbee', '#f3f0ff', '#fff0f6', '#e6fcf5']
const BAR_FILLS = ['#74c0fc', '#ffc078', '#8ce99a', '#b197fc', '#faa2c1', '#63e6be']

const SIZE = { title: 48, normal: 28, small: 20 }

const INK = '#1e1e1e'
const RED = '#e03131'
const BLUE = '#1971c2'
const GREY = '#495057'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const rectOf = (e: El): Rect => ({ x: e.x, y: e.y, width: e.width, height: e.height })
const center = (r: Rect): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const clean = (s: string) => s.toLowerCase().replace(/[\s.,:;!'"()]+/g, '')

function refsOf(action: Action): string[] {
  if ('id' in action && action.id && 'at' in action) return [action.id]
  if (action.type === 'arrow' || action.type === 'link') return [action.from, action.to]
  if ('target' in action) return [action.target]
  return []
}

export class Board {
  private layout = new Layout()
  private elements: El[] = []
  private fills = new Map<string, string>()
  private strokes = new Map<string, { strokeColor: string; strokeWidth: number }>()
  private run = 0
  private live = false
  private penAt: Pt | null = null
  private penMove = 0
  private api: ExcalidrawImperativeAPI
  private pen?: HTMLElement

  constructor(api: ExcalidrawImperativeAPI, pen?: HTMLElement) {
    this.api = api
    this.pen = pen
  }

  stop() {
    this.run++
    this.point(null)
  }

  reset() {
    this.stop()
    this.layout.reset()
    this.fills.clear()
    this.strokes.clear()
    this.elements = []
    this.sync()
  }

  private fillFor(id: string) {
    const known = this.fills.get(id)
    if (known) return known
    const color = FILLS[this.fills.size % FILLS.length]
    this.fills.set(id, color)
    return color
  }

  summary() {
    return this.elements
      .filter((e) => !e.id.includes('__') && !e.customData?.of && !('containerId' in e && e.containerId))
      .map((e) => {
        const text = e.customData?.text ?? (e.type === 'text' ? e.text : (this.labelOf(e.id)?.originalText ?? ''))
        return `${e.id} | ${e.customData?.kind ?? e.type} | ${String(text).replace(/\n/g, ' ')}`
      })
      .join('\n')
  }

  clearSide() {
    const ids = new Set(this.layout.sideIds())
    this.elements = this.elements
      .filter((e) => {
        if (ids.has(e.id)) return false
        if ('containerId' in e && e.containerId && ids.has(e.containerId)) return false
        if (e.customData?.of && ids.has(e.customData.of)) return false
        for (const id of ids) if (e.id.startsWith(`${id}__`)) return false
        return true
      })
      .map((e) => {
        const stroke = this.strokes.get(e.id)
        return stroke ? newElementWith(e, stroke) : e
      }) as El[]
    this.strokes.clear()
    this.layout.clearSide()
    this.sync()
  }

  async apply(action: Action, speed: number, aside = false) {
    const run = this.run
    this.live = Number.isFinite(speed)
    // Every draw places its item before its first pause, so the camera can head there while it's drawn.
    const drawing = this.draw(action, speed, aside)
    if (run === this.run) this.focus(action)
    await drawing
  }

  private async draw(action: Action, speed: number, aside: boolean) {
    // An answer stays on the side even when the model anchors it to the lesson, so it can be cleared after.
    if (aside && 'at' in action && !this.layout.onSide(action.at)) action = { ...action, at: { region: 'side' } }
    if (action.type === 'write') await this.write(action, speed)
    else if (action.type === 'box') await this.box(action, speed)
    else if (action.type === 'arrow') await this.arrow(action, speed, aside)
    else if (action.type === 'words') await this.words(action, speed)
    else if (action.type === 'link') await this.link(action, speed, aside)
    else if (action.type === 'table') await this.table(action, speed)
    else if (action.type === 'bars') await this.bars(action, speed)
    else if (action.type === 'list') await this.list(action, speed)
    else if (action.type === 'mark') await this.mark(action.target, action.style ?? 'underline', action.note, speed, aside)
    else if (action.type === 'circle') await this.mark(action.target, 'circle', undefined, speed, aside)
    else if (action.type === 'underline') await this.mark(action.target, 'underline', undefined, speed, aside)
    else if (action.type === 'strike') await this.strike(action.target, speed, aside)
    else if (action.type === 'highlight') this.highlight(action.target, aside)
    else if (action.type === 'erase') this.erase(action.target)
    else this.reset()
  }

  frame(actions: Action[]) {
    const els = [...new Set(actions.flatMap(refsOf).map((r) => this.host(r)))].filter((e) => !!e)
    if (els.length) this.zoom(els, els.length === 1 ? 0.55 : 0.72)
  }

  // The whole lesson at a glance once the last step is done.
  overview() {
    this.point(null)
    const side = new Set(this.layout.sideIds())
    const els = this.elements.filter((e) => !side.has(e.id))
    if (els.length) this.zoom(els, 0.9, 0.1)
  }

  // Keeps the pen on its board spot while the camera moves.
  placePen() {
    const pen = this.pen
    if (!pen) return
    if (!this.penAt) {
      pen.style.opacity = '0'
      return
    }
    const { scrollX, scrollY, zoom } = this.api.getAppState()
    const x = (this.penAt.x + scrollX) * zoom.value
    const y = (this.penAt.y + scrollY) * zoom.value
    pen.style.transform = `translate(${x}px, ${y}px)`
    pen.style.opacity = '1'
  }

  private point(at: Pt | null, glideMs = 0) {
    const move = ++this.penMove
    if (!at || !this.live || glideMs <= 0 || !this.penAt) {
      if (at && !this.live) return
      this.penAt = at
      this.placePen()
      return
    }
    const from = this.penAt
    const t0 = performance.now()
    const tick = () => {
      if (move !== this.penMove) return
      const t = Math.min(1, (performance.now() - t0) / glideMs)
      const e = t * (2 - t)
      this.penAt = { x: from.x + (at.x - from.x) * e, y: from.y + (at.y - from.y) * e }
      this.placePen()
      if (t < 1) requestAnimationFrame(tick)
    }
    tick()
  }

  private sync() {
    this.api.updateScene({
      elements: this.elements,
      captureUpdate: CaptureUpdateAction.NEVER,
    })
  }

  private find(id: string) {
    return this.elements.find((e) => e.id === id)
  }

  private host(ref: string) {
    return this.find(ref) ?? this.find(ref.split('.')[0])
  }

  private hostId(ref: string) {
    return this.find(ref) ? ref : ref.split('.')[0]
  }

  private labelOf(id: string) {
    const el = this.elements.find((e) => 'containerId' in e && e.containerId === id)
    return el?.type === 'text' ? el : undefined
  }

  // "id" is a whole item. "id.part" is one word, cell, bar or line of it, or a piece of its text.
  private resolve(ref: string): { rect: Rect; el?: El } | null {
    const whole = this.find(ref)
    if (whole) return { rect: this.content(whole), el: whole }
    const dot = ref.indexOf('.')
    if (dot < 0) return null
    const id = ref.slice(0, dot)
    const host = this.find(id)
    if (!host) return null
    const raw = ref.slice(dot + 1)
    const want = clean(raw)
    const parts = this.elements.filter((e) => e.customData?.of === id && e.customData.part !== undefined)
    const name = (e: El) => clean(String(e.customData?.part))
    // Exact first, then looser: the model sometimes writes a bit more or less than the part's text.
    const part =
      parts.find((e) => name(e) === want) ??
      parts.find((e) => name(e).includes(want)) ??
      parts.find((e) => want.startsWith(name(e)))
    if (part && want) return { rect: rectOf(part), el: part }
    const text = host.type === 'text' ? host : this.labelOf(id)
    const piece = text ? this.pieceOf(text, raw) : null
    return piece ? { rect: piece } : { rect: this.content(host), el: host }
  }

  // A holder is padded for its highlight outline; arrows and marks hug the content inside.
  private content(el: El): Rect {
    const r = rectOf(el)
    if (!el.customData?.kind) return r
    return { x: r.x + 14, y: r.y + 12, width: r.width - 28, height: r.height - 24 }
  }

  private pieceOf(el: El, part: string): Rect | null {
    if (el.type !== 'text' || !part) return null
    const lines = el.originalText.split('\n')
    const row = lines.findIndex((l) => l.toLowerCase().includes(part.toLowerCase()))
    if (row < 0) return null
    const line = lines[row]
    const at = line.toLowerCase().indexOf(part.toLowerCase())
    const style = { size: el.fontSize, family: el.fontFamily }
    const lineW = this.measure(line, style).width
    const left = el.textAlign === 'center' ? el.x + (el.width - lineW) / 2 : el.x
    const lineH = el.height / lines.length
    return {
      x: left + this.measure(line.slice(0, at), style).width,
      y: el.y + row * lineH,
      width: this.measure(line.slice(at, at + part.length), style).width,
      height: lineH,
    }
  }

  private add(els: El[]) {
    this.elements = [...this.elements, ...els]
    this.sync()
  }

  private setOpacity(ids: Set<string>, opacity: number) {
    this.elements = this.elements.map((e) => (ids.has(e.id) ? newElementWith(e, { opacity }) : e)) as El[]
    this.sync()
  }

  private async tween(ms: number, fn: (t: number) => void) {
    const run = this.run
    const t0 = performance.now()
    for (;;) {
      if (run !== this.run) return
      const t = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1
      fn(t)
      if (t >= 1) return
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
  }

  private shape(skeleton: Skeleton) {
    return convertToExcalidrawElements([skeleton], { regenerateIds: false })
  }

  private text(id: string, text: string, x: number, y: number, style: TextStyle = {}, data?: Record<string, unknown>) {
    return this.shape({
      type: 'text',
      id,
      x,
      y,
      text,
      fontSize: style.size ?? 22,
      fontFamily: style.family ?? FONT.hand,
      strokeColor: style.color ?? INK,
      customData: data,
    })[0]
  }

  private measure(text: string, style: TextStyle) {
    const el = this.text('measure', text || ' ', 0, 0, style)
    return { width: text ? el.width : 0, height: el.height }
  }

  private line(id: string, path: Pt[], color: string, width: number, data?: Record<string, unknown>) {
    return this.shape({
      type: 'line',
      id,
      ...linear(path),
      strokeColor: color,
      strokeWidth: width,
      roughness: 1,
      customData: data,
    })[0]
  }

  // An invisible frame around a many-part item, so the item's id can be found, pointed at and highlighted.
  private holder(id: string, kind: string, text: string, r: Rect) {
    return this.shape({
      type: 'rectangle',
      id,
      x: r.x - 14,
      y: r.y - 12,
      width: r.width + 28,
      height: r.height + 24,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      roughness: 1,
      roundness: { type: 3 },
      customData: { kind, text },
    })[0]
  }

  private removeItem(id: string) {
    this.elements = this.elements.filter(
      (e) =>
        e.id !== id &&
        e.id !== `${id}__note` &&
        e.customData?.of !== id &&
        !('containerId' in e && e.containerId === id),
    )
  }

  // Puts an item on the board with its pieces hidden; `show` then brings them in one by one.
  private put(id: string, all: El[], pieces: El[][], speed: number) {
    this.removeItem(id)
    const hidden = new Set(Number.isFinite(speed) ? pieces.flat().map((e) => e.id) : [])
    this.add(all.map((e) => (hidden.has(e.id) ? newElementWith(e, { opacity: 0 }) : e)) as El[])
  }

  // Callers pass the run their action started in: a skip or pause mid-action must stop the rest of
  // the pieces, or they animate over the instantly drawn version.
  private async show(pieces: El[][], speed: number, run: number, ms = 150) {
    if (!Number.isFinite(speed)) return
    for (const piece of pieces) {
      if (run !== this.run) return
      const last = piece[piece.length - 1]
      this.point({ x: last.x + last.width, y: last.y + last.height * 0.8 }, 120 / speed)
      const ids = new Set(piece.map((e) => e.id))
      await this.tween(ms / speed, (t) => this.setOpacity(ids, 100 * t))
    }
  }

  private focus(action: Action) {
    if ('at' in action) {
      const host = 'below' in action.at ? action.at.below : ''
      const spot = this.layout.get(action.id) ?? (host ? this.layout.get(host) : undefined)
      if (spot) this.zoomTo(spot, action.type === 'write' && action.size === 'title' ? 0.5 : 0.42)
      return
    }
    const ends = refsOf(action).map((ref) => this.host(ref)).filter((e) => !!e)
    if (ends.length) this.zoom(ends, ends.length > 1 ? 0.62 : 0.4)
  }

  // Items are still being drawn when the camera moves, so aim at the spot they take, not their elements.
  private zoomTo(r: Rect, cover: number) {
    this.zoom(this.shape({ type: 'rectangle', x: r.x, y: r.y, width: r.width, height: r.height }), cover)
  }

  private zoom(els: El[], cover: number, minZoom = 0.4) {
    this.api.scrollToContent(els, {
      fitToViewport: true,
      viewportZoomFactor: cover,
      animate: true,
      duration: 550,
      minZoom,
      maxZoom: 1.4,
      canvasOffsets: { top: 24, bottom: 168, left: 16, right: 16 },
    })
  }

  private async write(action: Extract<Action, { type: 'write' }>, speed: number) {
    if ('below' in action.at && action.text.includes('\n') && this.absorb(action.at.below, action.text)) {
      return
    }
    const style = { size: SIZE[action.size ?? 'normal'], family: FONT[action.font ?? 'hand'] }
    const full = this.text(action.id, action.text, 0, 0, style)
    const { x, y } = this.layout.place(action.id, action.at, { width: full.width, height: full.height })
    this.elements = this.elements.filter((e) => e.id !== action.id)
    const run = this.run
    const first = Number.isFinite(speed) ? Math.min(1, action.text.length) : action.text.length
    for (let i = first; i <= action.text.length; i++) {
      if (run !== this.run) return
      const el = this.text(action.id, action.text.slice(0, i), x, y, style)
      if (el.type !== 'text') return
      const prev = this.find(action.id)
      if (!prev) this.add([el])
      else {
        this.elements = this.elements.map((e) =>
          e.id === action.id && e.type === 'text'
            ? newElementWith(e, {
                text: el.text,
                originalText: el.originalText,
                width: el.width,
                height: el.height,
              })
            : e,
        ) as El[]
        this.sync()
      }
      this.point({ x: x + el.width, y: y + el.height * 0.8 })
      await wait(40 / speed)
    }
  }

  private async box(action: Extract<Action, { type: 'box' }>, speed: number) {
    const shape =
      action.shape === 'ellipse' ? 'ellipse' : action.shape === 'diamond' ? 'diamond' : 'rectangle'
    const note = (action.note ?? '').trim().slice(0, 42)
    const noteId = `${action.id}__note`
    const lines = action.text.split('\n')
    const longest = Math.max(...lines.map((l) => l.length), 1)
    const shapes = this.shape({
      type: shape,
      id: action.id,
      x: 0,
      y: 0,
      width: Math.min(440, Math.max(176, longest * 16 + 72, note.length * 8)),
      height: Math.max(76, lines.length * 32 + 48),
      backgroundColor: this.fillFor(action.id),
      fillStyle: 'solid',
      strokeColor: '#343a40',
      strokeWidth: 2,
      roughness: 1,
      roundness: { type: 3 },
      label: { text: action.text, fontFamily: FONT.hand, fontSize: 22 },
    })
    const body = shapes.find((e) => e.id === action.id)
    if (!body) return
    // Excalidraw grows a shape whose label doesn't fit, so place it by its real size.
    const { x, y } = this.layout.place(action.id, action.at, {
      width: body.width,
      height: body.height + (note ? 32 : 0),
    })
    const notes = note
      ? [this.text(noteId, note, x, y + body.height + 6, { size: 16, color: GREY })]
      : []
    const els = [
      ...shapes.map((e) => newElementWith(e, { x: e.x + x, y: e.y + y, opacity: 0 })),
      ...notes.map((e) => newElementWith(e, { opacity: 0 })),
    ] as El[]
    const ids = new Set(els.map((e) => e.id))
    this.elements = this.elements.filter(
      (e) =>
        e.id !== action.id &&
        e.id !== noteId &&
        !('containerId' in e && e.containerId === action.id),
    )
    this.add(els)
    const outline = [
      { x, y },
      { x: x + body.width, y },
      { x: x + body.width, y: y + body.height },
      { x, y: y + body.height },
      { x, y },
    ]
    await this.tween(450 / speed, (t) => {
      this.setOpacity(ids, 100 * t)
      this.point(along(outline, t))
    })
  }

  private bottom(el: El) {
    const note = this.find(`${el.id}__note`)
    return (note ? note.y + note.height : el.y + el.height) + 8
  }

  // How far notes hang below an item (its own note, or notes written under marks on it).
  private drop(el: El) {
    const notes = this.elements.filter(
      (e) =>
        e.id === `${el.id}__note` ||
        ((e.id.startsWith(`${el.id}__`) || e.id.startsWith(`${el.id}.`)) && e.id.endsWith('__note')),
    )
    const r = this.content(el)
    return Math.max(0, ...notes.map((n) => n.y + n.height - (r.y + r.height)))
  }

  private absorb(hostId: string, extra: string) {
    const host = this.find(hostId)
    if (!host || (host.type !== 'rectangle' && host.type !== 'ellipse' && host.type !== 'diamond')) {
      return false
    }
    const label = this.labelOf(hostId)
    if (!label || !/^key points?$/i.test(label.originalText.split('\n')[0].trim())) return false
    if (label.originalText.endsWith(extra)) return true
    const text = `${label.originalText}\n${extra}`
    const lines = text.split('\n')
    const raw = this.shape({
      type: host.type,
      id: hostId,
      x: host.x,
      y: host.y,
      width: Math.max(host.width, ...lines.map((l) => l.length * 16 + 72)),
      height: Math.max(host.height, lines.length * 32 + 48),
      backgroundColor: host.backgroundColor,
      fillStyle: 'solid',
      strokeColor: host.strokeColor,
      strokeWidth: host.strokeWidth,
      roughness: 1,
      roundness: { type: 3 },
      label: { text, fontFamily: FONT.hand, fontSize: 22 },
    })
    const box = raw.find((e) => e.id === hostId)
    if (!box) return false
    const note = this.find(`${hostId}__note`)
    this.elements = [
      ...this.elements
        .filter((e) => e.id !== hostId && !('containerId' in e && e.containerId === hostId))
        .map((e) => (note && e.id === note.id ? newElementWith(e, { y: host.y + box.height + 6 }) : e)),
      ...(raw as El[]),
    ]
    this.layout.resize(hostId, box.width, box.height + (note ? 36 : 0))
    this.sync()
    return true
  }

  private async arrow(action: Extract<Action, { type: 'arrow' }>, speed: number, aside: boolean) {
    const from = this.resolve(action.from)
    const to = this.resolve(action.to)
    if (!from || !to || action.from === action.to) return
    const id = action.id ?? `${action.from}__to__${action.to}`
    if (aside || this.layout.isSide(this.hostId(action.from)) || this.layout.isSide(this.hostId(action.to))) {
      this.layout.markSide(id)
    }
    // The two end items and their pieces are left out: a holder's padding would sit over the arrow's
    // own start, and an arrow to one table cell would otherwise loop around the cells next to it.
    const ends = new Set([this.hostId(action.from), this.hostId(action.to)])
    const blocks = this.elements
      .filter(
        (e) =>
          e.type !== 'arrow' &&
          !ends.has(e.id) &&
          !ends.has(e.customData?.of) &&
          !('containerId' in e && e.containerId),
      )
      .map(rectOf)
    const route = routeArrow(
      from.rect,
      to.rect,
      blocks,
      from.el ? this.drop(from.el) : 0,
      to.el ? this.drop(to.el) : 0,
    )
    const trail = route.points.map(([px, py]) => ({ x: route.x + px, y: route.y + py }))
    const raw = this.shape({
      type: 'arrow',
      id,
      ...linear(trail),
      roughness: 0,
      strokeStyle: action.dashed ? 'dashed' : 'solid',
      strokeColor: '#343a40',
      strokeWidth: 2,
      endArrowhead: 'arrow',
      customData: { from: action.from, to: action.to },
    })
    const tag = action.label?.trim() ? this.beside(`${id}__label`, action.label.trim(), trail, id) : null
    const run = this.run
    const live = Number.isFinite(speed)
    const fade = (e: El) => (live ? (newElementWith(e, { opacity: 0 }) as El) : e)
    this.elements = this.elements.filter((e) => e.id !== id && e.customData?.of !== id)
    this.elements = [...raw.map(fade), ...this.elements, ...(tag ? [fade(tag)] : [])]
    this.sync()
    if (!live) return
    await this.tween(320 / speed, (t) => {
      this.setOpacity(new Set([id]), 100 * t)
      this.point(along(trail, t))
    })
    if (tag) await this.show([[tag]], speed, run, 120)
  }

  // A label written next to the longest stretch of an arrow, so it never covers the line or its head.
  private beside(id: string, text: string, trail: Pt[], of: string) {
    let a = trail[0]
    let b = trail[1]
    for (let i = 1; i < trail.length; i++) {
      const [p, q] = [trail[i - 1], trail[i]]
      if (Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(b.x - a.x, b.y - a.y)) [a, b] = [p, q]
    }
    const style = { size: 16, color: GREY }
    const m = this.measure(text, style)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    const x = flat ? mid.x - m.width / 2 : mid.x + 8
    const y = flat ? mid.y - m.height - 4 : mid.y - m.height / 2
    return this.text(id, text, x, y, style, { of })
  }

  private async words(action: Extract<Action, { type: 'words' }>, speed: number) {
    const words = action.words.map((w) => w.trim()).filter(Boolean).slice(0, 10)
    if (!words.length) return
    const style = { size: 30 }
    const sizes = words.map((w) => this.measure(w, style))
    const gap = 26
    const width = sizes.reduce((sum, m) => sum + m.width, 0) + gap * (words.length - 1)
    const height = Math.max(...sizes.map((m) => m.height))
    // Room above the words for the curved links drawn between them.
    const lift = 72
    const spot = this.layout.place(action.id, action.at, { width, height: height + lift })
    const top = spot.y + lift
    let x = spot.x
    const parts = words.map((w, i) => {
      const el = this.text(`${action.id}__w${i}`, w, x, top, style, { of: action.id, part: w })
      x += sizes[i].width + gap
      return el
    })
    const holder = this.holder(action.id, 'words', words.join(' '), { x: spot.x, y: top, width, height })
    const pieces = parts.map((p) => [p])
    this.put(action.id, [holder, ...parts], pieces, speed)
    await this.show(pieces, speed, this.run, 170)
  }

  private async link(action: Extract<Action, { type: 'link' }>, speed: number, aside: boolean) {
    const from = this.resolve(action.from)
    const to = this.resolve(action.to)
    if (!from || !to || action.from === action.to) return
    const id = `${action.from}__link__${action.to}`
    if (aside || this.layout.isSide(this.hostId(action.from)) || this.layout.isSide(this.hostId(action.to))) {
      this.layout.markSide(id)
    }
    const a = center(from.rect)
    const b = center(to.rect)
    let path: Pt[]
    const row = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) * 2
    if (row) {
      // Mostly side by side, like two words in a sentence: arc over the top.
      const p0 = { x: a.x, y: from.rect.y - 6 }
      const p1 = { x: b.x, y: to.rect.y - 6 }
      const lift = Math.min(64, 18 + Math.abs(b.x - a.x) * 0.2)
      path = [p0, { x: (p0.x + p1.x) / 2, y: Math.min(p0.y, p1.y) - lift }, p1]
    } else {
      // Different rows: leave and enter straight up or down, so the curve never cuts through either item.
      const down = b.y > a.y ? 1 : -1
      const p0 = { x: a.x, y: down > 0 ? from.rect.y + from.rect.height + 8 : from.rect.y - 8 }
      const p1 = { x: b.x, y: down > 0 ? to.rect.y - 8 : to.rect.y + to.rect.height + 8 }
      const reach = Math.min(48, Math.abs(p1.y - p0.y) / 3)
      path = [p0, { x: p0.x, y: p0.y + down * reach }, { x: p1.x, y: p1.y - down * reach }, p1]
    }
    const mid = row ? path[1] : { x: (path[1].x + path[2].x) / 2, y: (path[1].y + path[2].y) / 2 }
    const weight = Math.min(1, Math.max(0, action.weight ?? 0.3))
    const [arc] = this.shape({
      type: 'arrow',
      id,
      ...linear(path),
      roundness: { type: 2 },
      roughness: 1,
      strokeColor: BLUE,
      strokeWidth: 1.5 + weight * 4,
      startArrowhead: null,
      endArrowhead: null,
      customData: { from: action.from, to: action.to },
    })
    const label = action.label?.trim()
    const style = { size: 18, color: BLUE }
    const size = label ? this.measure(label, style) : null
    const tag =
      label && size
        ? this.text(
            `${id}__label`,
            label,
            row ? mid.x - size.width / 2 : mid.x + 10,
            row ? mid.y - size.height - 2 : mid.y - size.height / 2,
            style,
            { of: id },
          )
        : null
    this.elements = this.elements.filter((e) => e.id !== id && e.customData?.of !== id)
    const run = this.run
    const live = Number.isFinite(speed)
    this.add([arc, ...(tag ? [tag] : [])].map((e) => (live ? newElementWith(e, { opacity: 0 }) : e)) as El[])
    if (!live) return
    await this.tween(380 / speed, (t) => {
      this.setOpacity(new Set([id]), 100 * t)
      this.point(along(path, t))
    })
    if (tag) await this.show([[tag]], speed, run)
  }

  private async table(action: Extract<Action, { type: 'table' }>, speed: number) {
    const rows = action.rows.slice(0, 6).map((r) => r.slice(0, 5).map((c) => c.trim().slice(0, 24)))
    const cols = Math.max(...rows.map((r) => r.length))
    const style = { size: 22 }
    const rowH = 44
    const widths = Array.from({ length: cols }, (_, c) =>
      Math.max(64, ...rows.map((r) => this.measure(r[c] ?? '', style).width + 32)),
    )
    const width = widths.reduce((sum, w) => sum + w, 0)
    const height = rows.length * rowH
    const { x, y } = this.layout.place(action.id, action.at, { width, height })
    const lefts = widths.map((_, c) => x + widths.slice(0, c).reduce((sum, w) => sum + w, 0))
    // Drawn like on a board: a line under the header and lines between columns, no outer box.
    const grid = [
      this.line(`${action.id}__head`, [{ x, y: y + rowH }, { x: x + width, y: y + rowH }], GREY, 2, { of: action.id }),
      ...lefts.slice(1).map((lx, c) =>
        this.line(`${action.id}__col${c}`, [{ x: lx, y: y + 4 }, { x: lx, y: y + height - 4 }], GREY, 1.5, {
          of: action.id,
        }),
      ),
    ]
    const cells = rows.map((r, ri) =>
      r.map((cell, c) => {
        const m = this.measure(cell, style)
        const left = lefts[c] + (widths[c] - m.width) / 2
        const top = y + ri * rowH + (rowH - m.height) / 2
        const color = ri === 0 ? INK : '#343a40'
        return this.text(`${action.id}__c${ri}_${c}`, cell, left, top, { ...style, color }, { of: action.id, part: cell })
      }),
    )
    const holder = this.holder(action.id, 'table', rows.map((r) => r.join(', ')).join('; '), { x, y, width, height })
    const pieces = [grid, ...cells.filter((r) => r.length)]
    this.put(action.id, [holder, ...grid, ...cells.flat()], pieces, speed)
    await this.show(pieces, speed, this.run, 200)
  }

  private async bars(action: Extract<Action, { type: 'bars' }>, speed: number) {
    const bars = action.bars.slice(0, 8)
    const style = { size: 22 }
    const valueStyle = { size: 20, color: GREY }
    const fmt = (v: number) => `${v}${action.unit ?? ''}`
    const labelW = Math.max(...bars.map((b) => this.measure(b.label, style).width))
    const valueW = Math.max(...bars.map((b) => this.measure(fmt(b.value), valueStyle).width))
    const max = Math.max(...bars.map((b) => Math.abs(b.value)))
    const full = 260
    const barH = 28
    const gap = 16
    const width = labelW + 14 + full + 12 + valueW
    const height = bars.length * barH + (bars.length - 1) * gap
    const spot = this.layout.place(action.id, action.at, { width, height })
    const x0 = spot.x + labelW + 14
    const rows = bars.map((b, i) => {
      const top = spot.y + i * (barH + gap)
      const w = max > 0 ? Math.max(4, (Math.abs(b.value) / max) * full) : 4
      const name = this.measure(b.label, style)
      const label = this.text(`${action.id}__l${i}`, b.label, x0 - 14 - name.width, top + (barH - name.height) / 2, style, {
        of: action.id,
      })
      const [bar] = this.shape({
        type: 'rectangle',
        id: `${action.id}__b${i}`,
        x: x0,
        y: top,
        width: w,
        height: barH,
        backgroundColor: BAR_FILLS[i % BAR_FILLS.length],
        fillStyle: 'hachure',
        strokeColor: '#343a40',
        strokeWidth: 1.5,
        roughness: 1,
        customData: { of: action.id, part: b.label },
      })
      const v = this.measure(fmt(b.value), valueStyle)
      const value = this.text(`${action.id}__v${i}`, fmt(b.value), x0 + w + 12, top + (barH - v.height) / 2, valueStyle, {
        of: action.id,
      })
      return { label, bar, value, w }
    })
    const holder = this.holder(
      action.id,
      'bars',
      bars.map((b) => `${b.label} ${fmt(b.value)}`).join(', '),
      { x: spot.x, y: spot.y, width, height },
    )
    const live = Number.isFinite(speed)
    this.removeItem(action.id)
    this.add([
      holder,
      ...rows.flatMap((r) =>
        live
          ? [r.label, newElementWith(r.bar, { width: 1 }), newElementWith(r.value, { opacity: 0 })]
          : [r.label, r.bar, r.value],
      ),
    ] as El[])
    if (!live) return
    const run = this.run
    for (const r of rows) {
      if (run !== this.run) return
      await this.tween(420 / speed, (t) => {
        const w = Math.max(1, r.w * t)
        this.elements = this.elements.map((e) => (e.id === r.bar.id ? newElementWith(e, { width: w }) : e)) as El[]
        this.sync()
        this.point({ x: x0 + w, y: r.bar.y + barH / 2 })
      })
      await this.show([[r.value]], speed, run, 120)
    }
  }

  private async list(action: Extract<Action, { type: 'list' }>, speed: number) {
    const items = action.items.map((s) => s.trim()).filter(Boolean)
    const style = { size: 22 }
    const lineH = 36
    const holder = this.find(action.id)
    if (holder?.customData?.kind === 'list') {
      // The same list again grows: new lines go under the last one.
      const lines = this.elements.filter((e) => e.customData?.of === action.id)
      this.setOpacity(new Set(lines.map((e) => e.id)), 100)
      const have = new Set(lines.map((e) => clean(String(e.customData?.part ?? ''))))
      const fresh = items.filter((s) => !have.has(clean(s)))
      if (!fresh.length) return
      const last = Math.max(...lines.map((e) => e.y + e.height))
      const left = holder.x + 14
      const added = fresh.map((s, i) =>
        this.text(`${action.id}__i${lines.length + i}`, `• ${s}`, left, last + 8 + i * lineH, style, {
          of: action.id,
          part: s,
        }),
      )
      const right = Math.max(holder.x + holder.width, ...added.map((e) => e.x + e.width + 14))
      const bottom = Math.max(...added.map((e) => e.y + e.height)) + 12
      const text = `${holder.customData?.text}, ${fresh.join(', ')}`
      this.elements = this.elements.map((e) =>
        e.id === action.id
          ? newElementWith(e, { width: right - holder.x, height: bottom - holder.y, customData: { kind: 'list', text } })
          : e,
      ) as El[]
      this.layout.resize(action.id, right - holder.x - 28, bottom - holder.y - 24)
      const pieces = added.map((e) => [e])
      this.add(Number.isFinite(speed) ? (added.map((e) => newElementWith(e, { opacity: 0 })) as El[]) : added)
      await this.show(pieces, speed, this.run, 180)
      return
    }
    const title = action.title?.trim()
    const titleStyle = { size: 26 }
    const titleSize = title ? this.measure(title, titleStyle) : { width: 0, height: 0 }
    const head = title ? titleSize.height + 18 : 0
    const width = Math.max(titleSize.width, ...items.map((s) => this.measure(`• ${s}`, style).width), 120)
    const spot = this.layout.place(action.id, action.at, { width, height: head + items.length * lineH })
    const top = title
      ? [
          this.text(`${action.id}__title`, title, spot.x, spot.y, titleStyle, { of: action.id, part: title }),
          this.line(
            `${action.id}__rule`,
            [
              { x: spot.x, y: spot.y + titleSize.height + 6 },
              { x: spot.x + titleSize.width, y: spot.y + titleSize.height + 8 },
            ],
            RED,
            2.5,
            { of: action.id },
          ),
        ]
      : []
    const lines = items.map((s, i) =>
      this.text(`${action.id}__i${i}`, `• ${s}`, spot.x, spot.y + head + i * lineH, style, { of: action.id, part: s }),
    )
    const holderEl = this.holder(action.id, 'list', [title, ...items].filter(Boolean).join(', '), {
      x: spot.x,
      y: spot.y,
      width,
      height: head + items.length * lineH,
    })
    const pieces = [...(top.length ? [top] : []), ...lines.map((e) => [e])]
    this.put(action.id, [holderEl, ...top, ...lines], pieces, speed)
    await this.show(pieces, speed, this.run, 180)
  }

  private async mark(target: string, style: 'underline' | 'circle', note: string | undefined, speed: number, aside: boolean) {
    const hit = this.resolve(target)
    if (!hit) return
    const id = `${target}__${style === 'circle' ? 'circ' : 'ul'}`
    const noteId = `${id}__note`
    if (aside) {
      this.layout.markSide(id)
      this.layout.markSide(noteId)
    }
    this.elements = this.elements.filter((e) => e.id !== id && !e.id.startsWith(`${id}__`))
    const r = hit.rect
    const whole = !!hit.el && hit.el.id === target
    let path: Pt[]
    let shape: El
    let under: number
    if (style === 'underline') {
      under = whole && hit.el ? this.bottom(hit.el) : r.y + r.height + 4
      path = [
        { x: r.x - 4, y: under },
        { x: r.x + r.width + 4, y: under + 2 },
      ]
      shape = this.line(id, path, RED, 3)
    } else {
      const pad = whole ? 22 : 10
      const ry = r.height / 2 + pad * 0.7
      const rx = Math.max(r.width / 2 + pad, ry)
      const c = center(r)
      under = c.y + ry
      path = Array.from({ length: 25 }, (_, i) => {
        const a = -Math.PI / 2 + (i / 24) * Math.PI * 2
        return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) }
      })
      shape = this.shape({
        type: 'ellipse',
        id,
        x: c.x - rx,
        y: c.y - ry,
        width: rx * 2,
        height: ry * 2,
        backgroundColor: 'transparent',
        strokeColor: RED,
        strokeWidth: 2.5,
        roughness: 1,
      })[0]
    }
    const words = note?.trim().slice(0, 40)
    const extra: El[] = []
    if (words) {
      const noteStyle = { size: 18, color: RED }
      const m = this.measure(words, noteStyle)
      const wanted = { x: center(r).x - m.width / 2, y: under + 10, width: m.width, height: m.height }
      const spot = this.layout.fit(noteId, wanted)
      extra.push(this.text(noteId, words, spot.x, spot.y, noteStyle))
      if (spot.y - wanted.y > 8) {
        const cx = spot.x + m.width / 2
        extra.push(this.line(`${id}__tie`, [{ x: cx, y: spot.y - 4 }, { x: center(r).x, y: under + 4 }], RED, 1.5))
      }
    }
    const run = this.run
    const live = Number.isFinite(speed)
    this.add([shape, ...extra].map((e) => (live ? newElementWith(e, { opacity: 0 }) : e)) as El[])
    if (!live) return
    await this.tween(360 / speed, (t) => {
      this.setOpacity(new Set([id]), 100 * t)
      this.point(along(path, t))
    })
    if (extra.length) await this.show([extra], speed, run, 160)
  }

  private async strike(target: string, speed: number, aside: boolean) {
    const hit = this.resolve(target)
    if (!hit) return
    const id = `${target}__strike`
    if (aside) this.layout.markSide(id)
    const r = hit.rect
    const path = [
      { x: r.x - 8, y: r.y + r.height * 0.62 },
      { x: r.x + r.width + 8, y: r.y + r.height * 0.38 },
    ]
    const line = this.line(id, path, RED, 3)
    this.elements = this.elements.filter((e) => e.id !== id)
    const live = Number.isFinite(speed)
    this.add([live ? (newElementWith(line, { opacity: 0 }) as El) : line])
    if (!live) return
    await this.tween(300 / speed, (t) => {
      this.setOpacity(new Set([id]), 100 * t)
      this.point(along(path, t))
    })
  }

  private highlight(target: string, aside: boolean) {
    const hit = this.resolve(target)
    if (!hit) return
    const r = hit.rect
    this.point(center(r), 220)
    const el = hit.el
    if (el && el.id === target && el.type !== 'text') {
      if (aside && !this.strokes.has(target)) {
        this.strokes.set(target, { strokeColor: el.strokeColor, strokeWidth: el.strokeWidth })
      }
      this.elements = this.elements.map((e) =>
        e.id === target ? newElementWith(e, { strokeColor: '#e67700', strokeWidth: 3 }) : e,
      ) as El[]
      this.sync()
      return
    }
    const id = `${target}__hl`
    if (aside && !this.find(id)) this.layout.markSide(id)
    this.elements = this.elements.filter((e) => e.id !== id)
    const [mark] = this.shape({
      type: 'rectangle',
      id,
      x: r.x - 6,
      y: r.y - 6,
      width: r.width + 12,
      height: r.height + 12,
      backgroundColor: '#ffe066',
      fillStyle: 'solid',
      strokeColor: 'transparent',
      strokeWidth: 0,
      opacity: 50,
      roughness: 0,
    })
    const behind = el ?? this.host(target)
    const i = Math.max(0, this.elements.findIndex((e) => e.id === behind?.id))
    this.elements = [...this.elements.slice(0, i), mark, ...this.elements.slice(i)]
    this.sync()
  }

  private erase(target: string) {
    if (!this.find(target) && !this.layout.get(target)) return
    const touches = (ref: unknown) => ref === target || (typeof ref === 'string' && ref.startsWith(`${target}.`))
    const drop = new Set([
      target,
      `${target}__note`,
      ...this.elements
        .filter((e) => e.type === 'arrow' && (touches(e.customData?.from) || touches(e.customData?.to)))
        .map((e) => e.id),
    ])
    this.elements = this.elements.filter(
      (e) =>
        !drop.has(e.id) &&
        !e.id.startsWith(`${target}__`) &&
        !e.id.startsWith(`${target}.`) &&
        !(e.customData?.of && drop.has(e.customData.of)) &&
        !('containerId' in e && e.containerId && drop.has(e.containerId)),
    )
    this.layout.remove(target)
    this.sync()
  }
}

// Excalidraw wants a line's points relative to its first point; its converter moves any other start.
function linear(path: Pt[]) {
  const [first] = path
  const xs = path.map((p) => p.x)
  const ys = path.map((p) => p.y)
  return {
    x: first.x,
    y: first.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: path.map((p) => [p.x - first.x, p.y - first.y] as [number, number]),
  }
}

function along(path: Pt[], t: number): Pt {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y))
  let left = lengths.reduce((sum, l) => sum + l, 0) * t
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(1, left / lengths[i]) : 1
      return { x: path[i].x + (path[i + 1].x - path[i].x) * k, y: path[i].y + (path[i + 1].y - path[i].y) * k }
    }
    left -= lengths[i]
  }
  return path[path.length - 1]
}
