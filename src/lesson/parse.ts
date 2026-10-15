import { LessonHeader, Step } from './schema'

export function jsonLine(line: string): unknown {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
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
