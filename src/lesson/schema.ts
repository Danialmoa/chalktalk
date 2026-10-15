import { z } from 'zod'

const Id = z.string().min(1)

export const Placement = z.union([
  z.object({ region: z.enum(['title', 'main', 'side']) }),
  z.object({ below: Id }),
  z.object({ right_of: Id }),
  z.object({ left_of: Id }),
  z.object({ above: Id }),
])

export const Action = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('write'),
    id: Id,
    text: z.string(),
    at: Placement,
    size: z.enum(['title', 'normal', 'small']).optional(),
    font: z.enum(['hand', 'code']).optional(),
  }),
  z.object({
    type: z.literal('box'),
    id: Id,
    text: z.string(),
    note: z.string().optional(),
    at: Placement,
    shape: z.enum(['rect', 'ellipse', 'diamond']).optional(),
  }),
  z.object({
    type: z.literal('arrow'),
    id: Id.optional(),
    from: Id,
    to: Id,
    label: z.string().optional(),
    dashed: z.boolean().optional(),
  }),
  z.object({ type: z.literal('highlight'), target: Id }),
  z.object({ type: z.literal('circle'), target: Id }),
  z.object({ type: z.literal('underline'), target: Id }),
  z.object({ type: z.literal('erase'), target: Id }),
  z.object({ type: z.literal('clear') }),
])

export const Step = z.object({
  say: z.string(),
  actions: z.array(Action).default([]),
})

export const LessonHeader = z.object({
  type: z.literal('lesson'),
  title: z.string(),
})

export type Placement = z.infer<typeof Placement>
export type Action = z.infer<typeof Action>
export type Step = z.infer<typeof Step>
export type LessonHeader = z.infer<typeof LessonHeader>
