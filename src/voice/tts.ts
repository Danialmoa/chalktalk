export type Clip = {
  duration: number
  // The voice's real length in seconds once it's made; undefined when there's no voice.
  loaded: Promise<number | undefined>
  play: (rate: number) => Promise<void>
}

type Raw = { audio: Float32Array; sampling_rate: number }
type Reply = { id: number; ready?: true; audio?: Float32Array; rate?: number; error?: string }

let token = 0
let settle: (() => void) | undefined
let source: AudioBufferSourceNode | undefined
let muted = false
let worker: Worker | undefined
let nextId = 0
const replies = new Map<number, (reply: Reply) => void>()
let ready = false
let oneThread = false
let ctx: AudioContext | undefined
let statusFn: ((s: string) => void) | undefined

function status(s: string) {
  statusFn?.(s)
}

export function onVoiceStatus(fn: (s: string) => void) {
  statusFn = fn
  return () => {
    if (statusFn === fn) statusFn = undefined
  }
}

// Kokoro runs in a worker: on the page, each sentence froze the board and the buttons for seconds.
function voiceWorker() {
  if (!worker) {
    status('Loading voice…')
    const w = new Worker(new URL('./kokoro.worker.ts', import.meta.url), {
      type: 'module',
      name: oneThread ? 'one-thread' : 'threads',
    })
    worker = w
    w.onmessage = ({ data }: MessageEvent<Reply>) => {
      replies.get(data.id)?.(data)
      replies.delete(data.id)
    }
    w.onerror = (e) => {
      if (w === worker) failed(e.message || 'the voice worker crashed')
    }
    void request('').then((reply) => {
      if (w !== worker) return
      if (reply.ready) {
        ready = true
        status('')
      } else failed(reply.error ?? 'no reply')
    })
  }
  return worker
}

// Several threads make speech about twice as fast. If that setup fails to load in some browser,
// start again on one thread: slower, but it's what always worked.
function failed(why: string) {
  console.error('Voice failed to load:', why)
  for (const resolve of replies.values()) resolve({ id: 0, error: 'worker failed' })
  replies.clear()
  worker?.terminate()
  worker = undefined
  if (!oneThread && self.crossOriginIsolated) {
    oneThread = true
    voiceWorker()
  } else status('Voice failed')
}

function request(text: string) {
  return new Promise<Reply>((resolve) => {
    const id = ++nextId
    replies.set(id, resolve)
    voiceWorker().postMessage({ id, text })
  })
}

export function dropQueued() {
  worker?.postMessage({ dropBefore: nextId + 1 })
}

export function warmup() {
  if (!muted) voiceWorker()
}

function context() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Browsers (Safari most strictly) only start audio from inside a user gesture, so unlock it on the first one.
window.addEventListener('pointerdown', context, { once: true })
window.addEventListener('keydown', context, { once: true })

export function isMuted() {
  return muted
}

export function setMuted(next: boolean) {
  muted = next
  if (muted) {
    cancel()
    status('')
  } else warmup()
}

export function cancel(): void {
  token++
  const node = source
  source = undefined
  node?.stop()
  const end = settle
  settle = undefined
  end?.()
}

function playRaw(raw: Raw, rate: number, t: number) {
  const c = context()
  const samples = new Float32Array(raw.audio)
  const buf = c.createBuffer(1, samples.length, raw.sampling_rate)
  buf.copyToChannel(samples, 0)
  const src = c.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = Math.min(2, Math.max(0.5, rate))
  src.connect(c.destination)
  source = src
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(backup)
      if (source === src) source = undefined
      if (t === token) resolve()
    }
    // If the audio device stalls, the context still says "running" but its clock stops and `ended`
    // never fires, which froze the lesson. Finish a moment after the clip's length regardless.
    const backup = window.setTimeout(finish, (buf.duration / src.playbackRate.value) * 1000 + 1500)
    src.onended = finish
    src.start()
  })
}

export function prepare(text: string, charsPerSec = 16): Clip {
  if (!text) return { duration: 0.3, loaded: Promise.resolve(undefined), play: () => Promise.resolve() }
  const duration = Math.max(0.8, text.length / charsPerSec)
  const pending = muted
    ? null
    : request(text).then((r): Raw | null => (r.audio && r.rate ? { audio: r.audio, sampling_rate: r.rate } : null))
  return {
    duration,
    loaded: pending ? pending.then((raw) => (raw ? raw.audio.length / raw.sampling_rate : undefined)) : Promise.resolve(undefined),
    play: (rate) =>
      new Promise((resolve) => {
        cancel()
        const t = token
        settle = resolve
        const done = () => {
          if (t === token) resolve()
        }
        const silent = () =>
          window.setTimeout(done, (duration / Math.min(2, Math.max(0.5, rate))) * 1000)
        // Until the voice model has downloaded, steps play silently so the first lesson never waits on it.
        if (!pending || !ready) {
          silent()
          return
        }
        void pending.then((raw) => {
          if (t !== token) return
          // A suspended context never fires onended, which would hold the step forever.
          if (!raw || context().state !== 'running') silent()
          else return playRaw(raw, rate, t).then(done)
        })
      }),
  }
}
