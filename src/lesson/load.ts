import { LessonHeader, Step, type Step as StepT } from './schema'

export function parseLesson(raw: string) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const header = LessonHeader.parse(JSON.parse(lines[0]))
  const steps: StepT[] = []
  for (const line of lines.slice(1)) {
    const parsed = Step.safeParse(JSON.parse(line))
    if (parsed.success) steps.push(parsed.data)
  }
  return { title: header.title, steps }
}
