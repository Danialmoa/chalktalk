import type { Step } from '../lesson/schema'
import type { Board } from '../board/draw'
import { PACE, type Level } from '../lesson/level'
import { cancel, dropQueued, prepare, type Clip } from '../voice/tts'

export type PlayerState = {
  playing: boolean
  index: number
  total: number
  speed: number
  title: string
  asking: boolean
  hand: boolean
  notes: string[]
}

type Listener = (s: PlayerState) => void

// How many steps past the current one get their voice made in advance. Kokoro makes speech a bit
// slower than it plays, so working ahead (from the moment steps arrive) builds a lead instead of
// leaving it idle during short lines and late for long ones.
const AHEAD = 3

// Lessons saved before steps had a gist fall back to their first spoken sentence.
const gistOf = (step: Step) => step.gist || step.say.split(/(?<=[.!?])\s/)[0]

export class Player {
  private steps: Step[] = []
  private index = 0
  private playing = false
  private waiting = false
  private speed = 1
  private minSlot = 0.5
  private charsPerSec = 16
  private title = ''
  private asking = false
  private hand = false
  private aside = false
  // False while steps are still being written, so the end-of-lesson overview waits for the real end.
  private complete = true
  private listeners = new Set<Listener>()
  private runId = 0
  private clips = new Map<number, Clip>()
  private board: Board

  constructor(board: Board) {
    this.board = board
  }

  load(title: string, steps: Step[], level: Level = 'intermediate', complete = true) {
    this.stop()
    this.complete = complete
    const pace = PACE[level]
    this.title = title
    this.steps = steps
    this.index = 0
    this.speed = pace.speed
    this.minSlot = pace.minSlot
    this.charsPerSec = pace.charsPerSec
    this.asking = false
    this.board.reset()
    this.emit()
  }

  push(step: Step) {
    this.steps.push(step)
    // An answer's voice comes first while it plays; the lesson's voice catches up after.
    if (!this.aside) this.prefetch()
    this.emit()
    if (this.waiting) this.play()
  }

  finish() {
    this.complete = true
    if (!this.playing && !this.asking && this.index > 0 && this.index >= this.steps.length) this.board.overview()
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
    if (this.playing || this.asking || this.aside) return
    if (this.index >= this.steps.length) {
      this.waiting = true
      return
    }
    this.waiting = false
    this.playing = true
    this.emit()
    this.loop(this.runId)
  }

  // Plays once the first step's voice is made, capped so a slow or first-time voice never holds the start.
  async warmStart(capMs = 8000) {
    const id = this.runId
    if (this.steps[this.index]) {
      this.prefetch()
      await Promise.race([this.clipFor(this.index).loaded, sleep(capMs)])
    }
    if (id === this.runId) this.play()
  }

  pause() {
    const raised = this.hand || this.aside
    this.halt()
    this.playing = false
    this.aside = false
    this.hand = false
    if (raised) this.asking = true
    this.emit()
  }

  skip() {
    if (this.aside || this.index >= this.steps.length) return
    this.halt()
    // Instant applies do all their drawing synchronously, so later steps can rely on these ids.
    for (const action of this.steps[this.index].actions) void this.board.apply(action, Infinity)
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
    this.board.clearSide()
    this.emit()
  }

  stop() {
    this.halt()
    this.playing = false
    this.asking = false
    this.hand = false
    this.aside = false
    this.index = 0
    this.emit()
  }

  async playAside(steps: Step[]) {
    this.halt()
    const id = this.runId
    this.playing = true
    this.asking = false
    this.hand = false
    this.aside = true
    this.emit()
    this.board.clearSide()
    for (const step of steps) {
      if (id !== this.runId) return
      const clip = prepare(step.say, this.charsPerSec)
      const slot = await this.slotFor(clip, step)
      if (id !== this.runId) return
      await Promise.all([clip.play(this.speed), this.drawStep(id, step, slot)])
    }
    if (id !== this.runId) return
    this.aside = false
    this.playing = false
    this.asking = true
    this.emit()
  }

  private halt() {
    this.runId++
    this.waiting = false
    this.clips.clear()
    cancel()
    dropQueued()
    this.board.stop()
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
      notes: this.steps
        .slice(0, this.index + (this.playing && !this.aside ? 1 : 0))
        .map(gistOf),
    }
  }

  private emit() {
    const s = this.snapshot()
    for (const fn of this.listeners) fn(s)
  }

  private async loop(id: number) {
    while (this.playing && id === this.runId && this.index < this.steps.length) {
      const step = this.steps[this.index]
      const clip = this.clipFor(this.index)
      this.prefetch()

      const slot = await this.slotFor(clip, step)
      if (id !== this.runId) return

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
    this.waiting = true
    if (this.complete && id === this.runId && this.index >= this.steps.length) this.board.overview()
    this.emit()
  }

  private clipFor(i: number) {
    let clip = this.clips.get(i)
    if (!clip) {
      clip = prepare(this.steps[i].say, this.charsPerSec)
      this.clips.set(i, clip)
    }
    return clip
  }

  private prefetch() {
    for (const i of this.clips.keys()) if (i < this.index) this.clips.delete(i)
    for (let i = this.index; i < Math.min(this.steps.length, this.index + AHEAD + 1); i++) this.clipFor(i)
  }

  // Spreads a step's actions over its voice. Waits a moment for the voice to be made so the drawing
  // follows its real length: the text-based guess runs about 2 s long, which left a silence after every line.
  private async slotFor(clip: Clip, step: Step) {
    const real = await Promise.race([clip.loaded, sleep(3000)])
    const seconds = typeof real === 'number' ? real : clip.duration
    return (Math.max(this.minSlot, seconds / Math.max(step.actions.length, 1)) * 1000) / this.speed
  }

  private async drawStep(id: number, step: Step, slotMs: number) {
    for (const [i, action] of step.actions.entries()) {
      if (id !== this.runId) return
      const start = performance.now()
      await this.board.apply(action, this.speed, this.aside)
      if (id !== this.runId) return
      // No wait after the last action: the voice already holds the step until it ends.
      const wait = slotMs - (performance.now() - start)
      if (wait > 0 && i < step.actions.length - 1) await sleep(wait)
    }
    if (id !== this.runId) return
    this.board.frame(step.actions)
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
