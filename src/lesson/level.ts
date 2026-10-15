export const LEVELS = ['basic', 'intermediate', 'interview'] as const
export type Level = (typeof LEVELS)[number]

export const PACE: Record<Level, { speed: number; minSlot: number; charsPerSec: number }> = {
  basic: { speed: 0.85, minSlot: 0.85, charsPerSec: 12 },
  intermediate: { speed: 1, minSlot: 0.5, charsPerSec: 16 },
  interview: { speed: 1.15, minSlot: 0.35, charsPerSec: 18 },
}

export const LEVEL_BLURB: Record<Level, string> = {
  basic: 'Slow. Everyday words. One idea at a time.',
  intermediate: 'Clear and complete. Some formulas.',
  interview: 'Dense. Interview tips and follow-ups.',
}
