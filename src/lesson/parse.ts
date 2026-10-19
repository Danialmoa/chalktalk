import { LessonHeader, Step } from './schema'

// Gemma often adds stray closing brackets after a finished step (`…}]}]}`), which made most
// lines fail to parse. Only the first complete object on the line is read.
export function jsonLine(line: string): unknown {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  const end = objectEnd(t)
  try {
    return JSON.parse(end > 0 ? t.slice(0, end) : t)
  } catch {
    return null
  }
}

function objectEnd(s: string) {
  let depth = 0
  let str = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (str) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') str = false
    } else if (ch === '"') str = true
    else if (ch === '{' || ch === '[') depth++
    else if ((ch === '}' || ch === ']') && --depth === 0) return i + 1
  }
  return -1
}

export function parseHeader(line: string) {
  const raw = jsonLine(line)
  const parsed = LessonHeader.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function parseStep(line: string) {
  const raw = jsonLine(line)
  const parsed = Step.safeParse(raw)
  return parsed.success ? parsed.data : null
}
