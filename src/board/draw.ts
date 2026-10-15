import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  FONT_FAMILY,
  newElementWith,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { Action } from '../lesson/schema'
import { Layout } from './layout'
import { routeArrow } from './route'

type El = ReturnType<typeof convertToExcalidrawElements>[number]

const FONT = {
  hand: FONT_FAMILY.Excalifont,
  code: FONT_FAMILY['Comic Shanns'],
}

const FILLS = ['#e7f5ff', '#fff4e6', '#ebfbee', '#f3f0ff', '#fff0f6', '#e6fcf5']

const SIZE = { title: 48, normal: 28, small: 20 }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function tween(ms: number, fn: (t: number) => void) {
  const t0 = performance.now()
  for (;;) {
    const t = Math.min(1, (performance.now() - t0) / ms)
    fn(t)
    if (t >= 1) return
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }
}

export class Board {
  private layout = new Layout()
  private elements: El[] = []
  private fills = new Map<string, string>()
  private api: ExcalidrawImperativeAPI

  constructor(api: ExcalidrawImperativeAPI) {
    this.api = api
  }

  reset() {
    this.layout.reset()
    this.fills.clear()
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
      .filter((e) => !e.id.includes('__'))
      .map((e) => {
        const text = 'text' in e && typeof e.text === 'string' ? e.text.replace(/\n/g, ' ') : ''
        return `${e.id} | ${e.type} | ${text}`
      })
      .join('\n')
  }

  clearSide() {
    const ids = new Set(this.layout.sideIds())
    this.elements = this.elements.filter((e) => {
      if (ids.has(e.id)) return false
      if ('containerId' in e && e.containerId && ids.has(e.containerId)) return false
      for (const id of ids) if (e.id.startsWith(`${id}__`)) return false
      return true
    })
    this.layout.clearSide()
    this.sync()
  }

  async apply(action: Action, speed: number) {
    if (action.type === 'write') await this.write(action, speed)
    else if (action.type === 'box') await this.box(action, speed)
    else if (action.type === 'arrow') await this.arrow(action, speed)
    else if (action.type === 'highlight') this.mark(action.target, 'hl')
    else if (action.type === 'circle') this.mark(action.target, 'circ')
    else if (action.type === 'underline') this.mark(action.target, 'ul')
    else if (action.type === 'erase') this.erase(action.target)
    else this.reset()
    this.focus(action)
  }

  frame(actions: Action[]) {
    const ids = new Set<string>()
    for (const a of actions) {
      if (a.type === 'write' || a.type === 'box') ids.add(a.id)
      else if (a.type === 'arrow') {
        ids.add(a.from)
        ids.add(a.to)
      } else if (a.type === 'highlight' || a.type === 'circle' || a.type === 'underline') {
        ids.add(a.target)
      }
    }
    const els = this.elements.filter((e) => ids.has(e.id))
    if (els.length) this.zoom(els, els.length === 1 ? 0.55 : 0.72)
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

  private add(els: El[]) {
    this.elements = [...this.elements, ...els]
    this.sync()
  }

  private focus(action: Action) {
    if (action.type === 'write' || action.type === 'box') {
      const host = 'below' in action.at ? action.at.below : ''
      const id = this.find(action.id) ? action.id : host || action.id
      const el = this.find(id)
      if (el) this.zoom([el], action.type === 'write' && action.size === 'title' ? 0.5 : 0.42)
      return
    }
    if (action.type === 'arrow') {
      const from = this.find(action.from)
      const to = this.find(action.to)
      if (from && to) this.zoom([from, to], 0.62)
      return
    }
    if (action.type === 'highlight' || action.type === 'circle' || action.type === 'underline') {
      const el = this.find(action.target)
      if (el) this.zoom([el], 0.4)
    }
  }

  private zoom(els: El[], cover: number) {
    this.api.scrollToContent(els, {
      fitToViewport: true,
      viewportZoomFactor: cover,
      animate: true,
      duration: 550,
      minZoom: 0.4,
      maxZoom: 2,
      canvasOffsets: { top: 24, bottom: 168, left: 16, right: 16 },
    })
  }

  private async write(action: Extract<Action, { type: 'write' }>, speed: number) {
    if ('below' in action.at && action.text.includes('\n') && this.absorb(action.at.below, action.text)) {
      return
    }
    const fontSize = SIZE[action.size ?? 'normal']
    const fontFamily = FONT[action.font ?? 'hand']
    const lines = action.text.split('\n')
    const width = Math.min(520, 12 * Math.max(...lines.map((l) => l.length), 1))
    const height = (action.size === 'title' ? 56 : 40) * lines.length
    const { x, y } = this.layout.place(action.id, action.at, { width, height })
    this.elements = this.elements.filter((e) => e.id !== action.id)
    const skeleton = {
      type: 'text' as const,
      id: action.id,
      x,
      y,
      fontSize,
      fontFamily,
      strokeColor: '#1e1e1e',
    }
    for (let i = 1; i <= Math.max(action.text.length, 1); i++) {
      const [el] = convertToExcalidrawElements(
        [{ ...skeleton, text: action.text.slice(0, i) }],
        { regenerateIds: false },
      )
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
      if (action.text) await wait(40 / speed)
    }
  }

  private async box(action: Extract<Action, { type: 'box' }>, speed: number) {
    const shape =
      action.shape === 'ellipse' ? 'ellipse' : action.shape === 'diamond' ? 'diamond' : 'rectangle'
    const note = (action.note ?? '').trim().slice(0, 42)
    const noteId = `${action.id}__note`
    const lines = action.text.split('\n')
    const longest = Math.max(...lines.map((l) => l.length), 1)
    const width = Math.min(440, Math.max(176, longest * 16 + 72, note.length * 8))
    const boxH = Math.max(76, lines.length * 32 + 48)
    const { x, y } = this.layout.place(action.id, action.at, {
      width,
      height: boxH + (note ? 32 : 0),
    })
    const raw = convertToExcalidrawElements(
      [
        {
          type: shape,
          id: action.id,
          x,
          y,
          width,
          height: boxH,
          backgroundColor: this.fillFor(action.id),
          fillStyle: 'solid',
          strokeColor: '#343a40',
          strokeWidth: 2,
          roughness: 1,
          roundness: { type: 3 },
          label: { text: action.text, fontFamily: FONT.hand, fontSize: 22 },
        },
        ...(note
          ? [
              {
                type: 'text' as const,
                id: noteId,
                x,
                y: y + boxH + 6,
                text: note,
                fontSize: 16,
                fontFamily: FONT.hand,
                strokeColor: '#495057',
              },
            ]
          : []),
      ],
      { regenerateIds: false },
    )
    const ids = new Set(raw.map((e) => e.id))
    const els = raw.map((e) => newElementWith(e, { opacity: 0 })) as El[]
    this.elements = this.elements.filter(
      (e) =>
        e.id !== action.id &&
        e.id !== noteId &&
        !('containerId' in e && e.containerId === action.id),
    )
    this.add(els)
    await tween(300 / speed, (t) => {
      this.elements = this.elements.map((e) =>
        ids.has(e.id) ? newElementWith(e, { opacity: 100 * t }) : e,
      ) as El[]
      this.sync()
    })
  }

  private bottom(el: El) {
    const note = this.find(`${el.id}__note`)
    return (note ? note.y + note.height : el.y + el.height) + 8
  }

  private drop(el: El) {
    const note = this.find(`${el.id}__note`)
    if (!note) return 0
    return Math.max(0, note.y + note.height - (el.y + el.height))
  }

  private absorb(hostId: string, extra: string) {
    const host = this.find(hostId)
    if (!host || (host.type !== 'rectangle' && host.type !== 'ellipse' && host.type !== 'diamond')) {
      return false
    }
    const label = this.elements.find((e) => e.type === 'text' && 'containerId' in e && e.containerId === hostId)
    if (!label || label.type !== 'text') return false
    if (!/^key points?$/i.test(label.text.split('\n')[0].trim())) return false
    const text = `${label.text}\n${extra}`
    const lines = text.split('\n')
    const width = Math.max(host.width, ...lines.map((l) => l.length * 16 + 72))
    const height = Math.max(host.height, lines.length * 32 + 48)
    const note = this.find(`${hostId}__note`)
    const raw = convertToExcalidrawElements(
      [
        {
          type: host.type,
          id: hostId,
          x: host.x,
          y: host.y,
          width,
          height,
          backgroundColor: host.backgroundColor,
          fillStyle: 'solid',
          strokeColor: host.strokeColor,
          strokeWidth: host.strokeWidth,
          roughness: 1,
          roundness: { type: 3 },
          label: { text, fontFamily: FONT.hand, fontSize: 22 },
        },
      ],
      { regenerateIds: false },
    )
    const noteY = host.y + height + 6
    this.elements = [
      ...this.elements
        .filter((e) => e.id !== hostId && !('containerId' in e && e.containerId === hostId))
        .map((e) => (note && e.id === note.id ? newElementWith(e, { y: noteY }) : e)),
      ...(raw as El[]),
    ]
    this.layout.resize(hostId, width, height + (note ? 36 : 0))
    this.sync()
    return true
  }

  private async arrow(action: Extract<Action, { type: 'arrow' }>, speed: number) {
    const from = this.find(action.from)
    const to = this.find(action.to)
    if (!from || !to || action.from === action.to) return
    const id = action.id ?? `${action.from}__to__${action.to}`
    if (this.layout.isSide(action.from) || this.layout.isSide(action.to)) this.layout.markSide(id)
    const blocks = this.elements
      .filter((e) => e.type !== 'arrow' && !('containerId' in e && e.containerId))
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }))
    const path = routeArrow(
      { x: from.x, y: from.y, width: from.width, height: from.height },
      { x: to.x, y: to.y, width: to.width, height: to.height },
      blocks,
      this.drop(from),
      this.drop(to),
    )
    const raw = convertToExcalidrawElements(
      [
        {
          type: 'arrow',
          id,
          x: path.x,
          y: path.y,
          width: Math.max(...path.points.map((p) => p[0])),
          height: Math.max(...path.points.map((p) => p[1])),
          points: path.points,
          roughness: 0,
          strokeStyle: action.dashed ? 'dashed' : 'solid',
          strokeColor: '#343a40',
          strokeWidth: 2,
          endArrowhead: 'arrow',
          label: action.label ? { text: action.label, fontFamily: FONT.hand, fontSize: 16 } : undefined,
        },
      ],
      { regenerateIds: false },
    )
    const ids = new Set(raw.map((e) => e.id))
    const faded = raw.map((e) => newElementWith(e, { opacity: 0 })) as El[]
    this.elements = this.elements.filter(
      (el) => el.id !== id && !('containerId' in el && el.containerId === id),
    )
    const shafts = faded.filter((e) => e.type === 'arrow')
    const labels = faded.filter((e) => e.type !== 'arrow')
    this.elements = [...shafts, ...this.elements, ...labels]
    this.sync()
    await tween(280 / speed, (t) => {
      this.elements = this.elements.map((el) =>
        ids.has(el.id) ? newElementWith(el, { opacity: 100 * t }) : el,
      ) as El[]
      this.sync()
    })
  }

  private mark(target: string, kind: 'hl' | 'circ' | 'ul') {
    const el = this.find(target)
    if (!el) return
    const id = `${target}__${kind}`
    this.elements = this.elements.filter((e) => e.id !== id)
    if (kind === 'hl' && el.type !== 'text') {
      this.elements = this.elements.map((e) =>
        e.id === target ? newElementWith(e, { strokeColor: '#e67700', strokeWidth: 3 }) : e,
      ) as El[]
      this.sync()
      return
    }
    const pad = kind === 'hl' ? 6 : 22
    const skeleton =
      kind === 'ul'
        ? {
            type: 'line' as const,
            id,
            x: el.x,
            y: this.bottom(el),
            width: el.width,
            height: 0,
            points: [
              [0, 0],
              [el.width, 0],
            ],
            strokeColor: '#1e1e1e',
            strokeWidth: 2,
          }
        : kind === 'hl'
          ? {
              type: 'rectangle' as const,
              id,
              x: el.x - pad,
              y: el.y - pad,
              width: el.width + pad * 2,
              height: el.height + pad * 2,
              backgroundColor: '#ffe066',
              fillStyle: 'solid' as const,
              strokeColor: 'transparent',
              strokeWidth: 0,
              opacity: 50,
              roughness: 0,
            }
          : {
              type: 'ellipse' as const,
              id,
              x: el.x - pad,
              y: el.y - pad,
              width: el.width + pad * 2,
              height: el.height + pad * 2,
              backgroundColor: 'transparent',
              fillStyle: 'solid' as const,
              strokeColor: '#4c6ef5',
              strokeWidth: 2,
              roughness: 0,
              opacity: 80,
            }
    const [mark] = convertToExcalidrawElements([skeleton], { regenerateIds: false })
    if (kind === 'hl') {
      const i = this.elements.findIndex((e) => e.id === target)
      this.elements = [...this.elements.slice(0, i), mark, ...this.elements.slice(i)]
      this.sync()
      return
    }
    this.add([mark])
  }

  private erase(target: string) {
    if (!this.find(target) && !this.layout.get(target)) return
    const drop = new Set([
      target,
      `${target}__hl`,
      `${target}__circ`,
      `${target}__ul`,
      `${target}__note`,
    ])
    this.elements = this.elements.filter(
      (e) => !drop.has(e.id) && !('containerId' in e && e.containerId === target),
    )
    this.layout.remove(target)
    this.sync()
  }
}
