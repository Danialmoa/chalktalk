import { streamLines } from './backboard'
import { qaPrompt, qaUser } from './prompts'
import { jsonLine, parseStep } from './parse'
import { Action, type Step } from './schema'

export async function answerQuestion(opts: {
  title: string
  says: string[]
  board: string
  question: string
}): Promise<Step[]> {
  let text = ''
  for await (const line of streamLines(qaPrompt(), qaUser(opts))) text += `${line}\n`
  return readSteps(text)
}

function readSteps(text: string) {
  const steps: Step[] = []
  let buf = ''
  let depth = 0
  let str = false
  let esc = false
  for (const ch of text) {
    if (depth === 0) {
      if (ch === '{') {
        buf = '{'
        depth = 1
      }
      continue
    }
    buf += ch
    if (str) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') str = false
      continue
    }
    if (ch === '"') str = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const step = coerce(buf)
        if (step) steps.push(step)
        buf = ''
      }
    }
  }
  return steps
}

function coerce(line: string): Step | null {
  const step = parseStep(line)
  if (step) return step
  const raw = jsonLine(line)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const action = Action.safeParse({ ...row, at: row.at ?? place(row) })
  if (!action.success) return null
  const say = typeof row.say === 'string' && row.say ? row.say : spoken(action.data)
  return { say, actions: [action.data] }
}

function place(row: Record<string, unknown>) {
  if (typeof row.below === 'string') return { below: row.below }
  if (typeof row.right_of === 'string') return { right_of: row.right_of }
  if (typeof row.left_of === 'string') return { left_of: row.left_of }
  if (typeof row.above === 'string') return { above: row.above }
  if (row.region === 'main' || row.region === 'title' || row.region === 'side') return { region: row.region }
  return { region: 'side' }
}

function spoken(action: Action) {
  if (action.type === 'box') return action.note ? `${action.text}. ${action.note}.` : action.text
  if (action.type === 'write') return action.text
  if (action.type === 'arrow') return action.label || 'This connects.'
  if (action.type === 'highlight') return 'Look here.'
  return 'Okay.'
}
