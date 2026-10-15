import type { Level } from './level'
import type { Step } from './schema'

const KEY = 'chalktalk-history'
const MAX = 30

export type HistoryItem = {
  id: string
  kind: 'lesson' | 'question'
  title: string
  level: Level
  steps: Step[]
  parentId?: string
  at: number
}

export function loadHistory(): HistoryItem[] {
  const raw = localStorage.getItem(KEY)
  if (!raw) return []
  const parsed = JSON.parse(raw) as HistoryItem[]
  return Array.isArray(parsed) ? parsed : []
}

export function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
}

export function upsert(items: HistoryItem[], item: HistoryItem) {
  const next = [item, ...items.filter((x) => x.id !== item.id)].slice(0, MAX)
  saveHistory(next)
  return next
}
