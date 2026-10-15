import type { Step } from '../lesson/schema'
import type { Board } from '../board/draw'
import { PACE, type Level } from '../lesson/level'
import { cancel, prepare, type Clip } from '../voice/tts'

export type PlayerState = {
  playing: boolean
  index: number
  total: number
  speed: number
  title: string
  asking: boolean
  hand: boolean
}

type Listener = (s: PlayerState) => void

export class Player {
  private steps: Step[] = []
  private index = 0
  private playing = false
  private speed = 1
  private minSlot = 0.5
  private charsPerSec = 16
  private title = ''
  private asking = false
  private hand = false
  private aside = false
  private listeners = new Set<Listener>()
  private runId = 0
  private nextClip: Clip | null = null
  private board: Board

  constructor(board: Board) {
    this.board = board
  }

  load(title: string, steps: Step[], level: Level = 'intermediate') {
    this.stop()
    const pace = PACE[level]
    this.title = title
    this.steps = steps
    this.index = 0
    this.speed = pace.speed
    this.minSlot = pace.minSlot
    this.charsPerSec = pace.charsPerSec
    this.nextClip = null
    this.asking = false
    this.board.reset()
    this.emit()
  }

  push(step: Step) {
    this.steps.push(step)
    this.emit()
    if (!this.playing && !this.asking && !this.aside && this.index < this.steps.length) this.play()
  }

  says() {
    return this.steps.slice(0, this.index).map((s) => s.say)
  }

  onChange(fn: Listener) {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => {
      this.listeners.delete(fn)
    }
  }

  setSpeed(speed: number) {
    this.speed = speed
    this.emit()
  }

  play() {
    if (this.playing || this.asking || this.aside || this.index >= this.steps.length) return
    this.playing = true
    this.emit()
    this.loop(this.runId)
  }

  pause() {
    const raised = this.hand
    this.playing = false
    this.aside = false
    this.hand = false
    this.runId++
    cancel()
    this.nextClip = null
    if (raised) this.asking = true
    this.emit()
  }

  skip() {
    if (this.aside || this.index >= this.steps.length) return
    cancel()
    this.runId++
    this.nextClip = null
    this.index++
    this.emit()
    if (this.playing) this.loop(this.runId)
  }

  raiseHand() {
    if (this.asking || this.aside || this.hand) return
    this.hand = true
    this.emit()
    if (!this.playing) {
      this.hand = false
      this.asking = true
      this.emit()
    }
  }

  stopAsk() {
    this.asking = false
    this.emit()
  }

  stop() {
    this.playing = false
    this.asking = false
    this.hand = false
    this.aside = false
    this.runId++
    cancel()
    this.nextClip = null
    this.index = 0
    this.emit()
  }

  async playAside(steps: Step[]) {
    const id = ++this.runId
    this.playing = true
    this.asking = false
    this.hand = false
    this.aside = true
    cancel()
    this.nextClip = null
    this.emit()
    this.board.clearSide()
    for (const step of steps) {
      if (id !== this.runId) return
      const clip = prepare(step.say, this.charsPerSec)
      const n = Math.max(step.actions.length, 1)
      const slot = Math.max(this.minSlot, clip.duration / n) * 1000 / this.speed
      await Promise.all([clip.play(this.speed), this.drawStep(id, step, slot)])
    }
    if (id !== this.runId) return
    this.aside = false
    this.playing = false
    this.emit()
  }

  private snapshot(): PlayerState {
    return {
      playing: this.playing,
      index: this.index,
      total: this.steps.length,
      speed: this.speed,
      title: this.title,
      asking: this.asking,
      hand: this.hand,
    }
  }

  private emit() {
    const s = this.snapshot()
    for (const fn of this.listeners) fn(s)
  }

  private async loop(id: number) {
    while (this.playing && id === this.runId && this.index < this.steps.length) {
      const step = this.steps[this.index]
      const clip = this.nextClip ?? prepare(step.say, this.charsPerSec)
      this.nextClip = null
      const next = this.steps[this.index + 1]
      if (next) this.nextClip = prepare(next.say, this.charsPerSec)

      const n = Math.max(step.actions.length, 1)
      const slot = Math.max(this.minSlot, clip.duration / n) * 1000 / this.speed

      const audio = clip.play(this.speed)
      const draw = this.drawStep(id, step, slot)
      await Promise.all([audio, draw])
      if (id !== this.runId) return
      if (this.hand) {
        this.hand = false
        this.asking = true
        this.playing = false
        this.index++
        cancel()
        this.emit()
        return
      }
      this.index++
      this.emit()
    }
    this.playing = false
    this.emit()
  }

  private async drawStep(id: number, step: Step, slotMs: number) {
    for (const action of step.actions) {
      if (id !== this.runId) return
      const start = performance.now()
      await this.board.apply(action, this.speed)
      if (id !== this.runId) return
      const wait = slotMs - (performance.now() - start)
      if (wait > 0) await sleep(wait)
    }
    if (id !== this.runId) return
    this.board.frame(step.actions)
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
