import { jsonLine } from './parse'

const MODEL = 'google/gemma-4-26b-a4b-it'

function post(system: string, user: string, stream: boolean) {
  return fetch(`${location.origin}/backboard/threads/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: user,
      system_prompt: system,
      llm_provider: 'openrouter',
      model_name: MODEL,
      json_output: false,
      memory: 'off',
      stream,
    }),
  })
}

export async function* streamLines(system: string, user: string) {
  const res = await post(system, user, true)
  if (!res.ok || !res.body) throw new Error(await res.text())
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const chunks = buf.split('\n')
    buf = chunks.pop() ?? ''
    for (const raw of chunks) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const json = jsonLine(payload) as { type?: string; content?: string; error?: string } | null
      if (json?.type === 'run_failed' || json?.type === 'error') {
        throw new Error(json.error ?? json.type)
      }
      if (json?.type !== 'content_streaming' || !json.content) continue
      text += json.content
      let nl = text.indexOf('\n')
      while (nl !== -1) {
        const out = text.slice(0, nl)
        text = text.slice(nl + 1)
        if (out.trim()) yield out
        nl = text.indexOf('\n')
      }
    }
  }
  if (text.trim()) yield text
}
