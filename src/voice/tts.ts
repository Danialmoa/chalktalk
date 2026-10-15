import { KokoroTTS, type KokoroTTS as Engine } from 'kokoro-js'

export type Clip = {
  duration: number
  play: (rate: number) => Promise<void>
}

type Raw = { audio: Float32Array; sampling_rate: number }

let token = 0
let settle: (() => void) | undefined
let source: AudioBufferSourceNode | undefined
let muted = true
let model: Promise<Engine | null> | undefined
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

function engine() {
  if (!model) {
    status('Loading voice…')
    model = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'wasm',
    }).then(
      (tts) => {
        status('')
        return tts
      },
      () => {
        status('Voice failed')
        return null
      },
    )
  }
  return model
}

export function warmup() {
  if (!muted) void engine()
}

function context() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

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
    src.onended = () => {
      if (source === src) source = undefined
      if (t === token) resolve()
    }
    src.start()
  })
}

export function prepare(text: string, charsPerSec = 16): Clip {
  if (!text) return { duration: 0.3, play: () => Promise.resolve() }
  const duration = Math.max(0.8, text.length / charsPerSec)
  const pending = muted
    ? null
    : engine()
        .then((tts) => (tts ? (tts.generate(text, { voice: 'af_heart' }) as Promise<Raw>) : null))
        .catch(() => null)
  return {
    duration,
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
        if (!pending) {
          silent()
          return
        }
        void pending.then((raw) => {
          if (t !== token) return
          if (!raw) silent()
          else return playRaw(raw, rate, t).then(done)
        })
      }),
  }
}
