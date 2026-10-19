import type { Level } from './level'
import { streamLines } from './backboard'
import { continueUser, lessonPrompt, lessonUser, openingRule } from './prompts'
import { parseHeader, parseStep } from './parse'
import type { Step } from './schema'

type LineEvent = { type: 'header'; title: string } | { type: 'step'; step: Step }

// `ready`: the opening steps are in, so playback can start while the rest is written.
export type GenEvent = LineEvent | { type: 'ready' }

async function* readLesson(
  system: string,
  user: string,
  headerExpected: boolean,
): AsyncGenerator<LineEvent> {
  let headerDone = !headerExpected
  for await (const line of streamLines(system, user)) {
    if (!headerDone) {
      const header = parseHeader(line)
      if (header) {
        headerDone = true
        yield { type: 'header', title: header.title }
        continue
      }
    }
    const step = parseStep(line)
    if (step) yield { type: 'step', step }
  }
}

export async function* generateLesson(topic: string, level: Level, paper?: string): AsyncGenerator<GenEvent> {
  const system = lessonPrompt(level)
  const opening: string[] = []
  for await (const ev of readLesson(`${system}\n${openingRule()}`, lessonUser(topic, paper), true)) {
    if (ev.type === 'header') opening.push(JSON.stringify({ type: 'lesson', title: ev.title }))
    else opening.push(JSON.stringify(ev.step))
    yield ev
  }
  if (!opening.length) return
  yield { type: 'ready' }
  for await (const ev of readLesson(system, continueUser(opening.join('\n')), false)) {
    yield ev
  }
}
