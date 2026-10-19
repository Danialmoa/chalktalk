import { env } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'

// tts.ts starts a second worker named 'one-thread' if the multi-threaded one fails to load.
if (self.name === 'one-thread' && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

type Job = { id: number; text: string } | { dropBefore: number }

const loading = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' })
// One sentence at a time: the ONNX session can't run two generations at once.
let chain = Promise.resolve()
let dropBefore = 0

async function handle(id: number, text: string) {
  // Clips queued before a skip or pause are no longer needed; the empty-text load job always runs.
  if (text && id < dropBefore) {
    postMessage({ id, error: 'dropped' })
    return
  }
  try {
    const tts = await loading
    if (!text) {
      postMessage({ id, ready: true })
      return
    }
    const raw = await tts.generate(text, { voice: 'af_heart' })
    const audio = raw.audio as Float32Array
    postMessage({ id, audio, rate: raw.sampling_rate }, { transfer: [audio.buffer] })
  } catch (err) {
    postMessage({ id, error: String(err) })
  }
}

onmessage = ({ data }: MessageEvent<Job>) => {
  if ('dropBefore' in data) {
    dropBefore = data.dropBefore
    return
  }
  chain = chain.then(() => handle(data.id, data.text))
}
