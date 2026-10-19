import type { Level } from './level'

const EXAMPLE = `{"type":"lesson","title":"Linear regression in 5 minutes"}
{"say":"Linear regression finds the best straight line through your data.","gist":"Best straight line through data","actions":[{"type":"write","id":"title","text":"Linear regression","at":{"region":"title"},"size":"title"}]}
{"say":"We know the price of two houses. We want the price of the third.","gist":"Example: guess a house price","actions":[{"type":"table","id":"houses","rows":[["size","price"],["50 m²","150k"],["80 m²","240k"],["100 m²","?"]],"at":{"region":"main"}},{"type":"mark","target":"houses.?","style":"circle","note":"we want this"}]}
{"say":"The model is one line: price is w times size, plus b.","gist":"price = w · size + b","actions":[{"type":"write","id":"model","text":"price = w · size + b","at":{"right_of":"houses"}},{"type":"mark","target":"model.w","style":"underline","note":"the slope we learn"}]}
{"say":"A first guess, w equals one, is far too small.","gist":"w = 1 is too small","actions":[{"type":"write","id":"guess","text":"w = 1","at":{"below":"model"}},{"type":"strike","target":"guess"}]}
{"say":"With w equals three, the errors are tiny.","gist":"w = 3 makes errors tiny","actions":[{"type":"bars","id":"errors","bars":[{"label":"50 m²","value":2},{"label":"80 m²","value":1}],"unit":"k","at":{"region":"main"}},{"type":"highlight","target":"errors.80 m²"}]}
{"say":"Key points.","gist":"Key points","actions":[{"type":"list","id":"keys","title":"Key points","items":["The model is a line","Learn w and b from data","Small errors mean a good fit"],"at":{"region":"main"}}]}`

const WORDS = `{"say":"In the cat sat, the word sat looks mostly at cat.","gist":"sat pays most attention to cat","actions":[{"type":"words","id":"s","words":["the","cat","sat"],"at":{"region":"main"}},{"type":"link","from":"s.sat","to":"s.cat","label":"0.7","weight":0.7},{"type":"link","from":"s.sat","to":"s.the","label":"0.1","weight":0.1}]}`

const COMPARE = `{"say":"SNS fans a copy out to every listener.","gist":"SNS: one message, many copies","actions":[{"type":"box","id":"sns","text":"SNS","note":"one to many","at":{"region":"main"},"shape":"ellipse"},{"type":"box","id":"sub","text":"Listeners","note":"each gets a copy","at":{"below":"sns"}},{"type":"arrow","from":"sns","to":"sub"}]}
{"say":"SQS is a line. One worker takes the next message.","gist":"SQS: one worker takes each message","actions":[{"type":"box","id":"sqs","text":"SQS","note":"one to one","at":{"right_of":"sns"}},{"type":"box","id":"worker","text":"Worker","note":"takes the next","at":{"below":"sqs"}},{"type":"arrow","from":"sqs","to":"worker"}]}`

const ACTIONS = `Actions:
- write {type,id,text,at,size?} a title, a formula or a short label. size=title|normal|small
- words {type,id,words,at} a sentence or sequence, one word or token each, at most 8
- link {type,from,to,label?,weight?} a curved line between two words or items. weight 0–1, bigger is thicker
- table {type,id,rows,at} short cells. The first row is the header. At most 5 rows and 4 columns
- bars {type,id,bars,unit?,at} bars like [{"label":"cat","value":0.6}]. At most 6
- list {type,id,title?,items,at} short lines. A later list with the same id adds lines
- box {type,id,text,note?,at,shape?} text 1–3 words, note 2–5 words. shape=rect|ellipse|diamond
- arrow {type,from,to,label?,dashed?}
- mark {type,target,style?,note?} style=underline|circle. note is 2–5 words written under it
- highlight {type,target}
- strike {type,target} cross out a wrong idea
A target, from or to can be one part of an item, written "id.part": a word (s.cat), a table cell (houses.150k), a bar (errors.80 m²), a list line, or a piece of a written line (model.w). Only the types above exist.`

const LEVEL_RULES: Record<Level, string> = {
  basic: `Level: BASIC
- 8 to 14 steps
- words a beginner knows
- almost no formulas; if you need one, say it in words first
- linger: short say lines, one idea per step
- no interview tips`,
  intermediate: `Level: INTERMEDIATE
- 12 to 18 steps
- plain words, then the real name (residual, bias)
- a few unicode formulas
- end with the Key points list`,
  interview: `Level: INTERVIEW
- 14 to 22 steps
- assume they already know the basics
- add Interview tip boxes and common follow-up questions
- name tradeoffs (bias vs variance, time vs memory)
- end with the Key points list`,
}

export function lessonPrompt(level: Level) {
  return `You are a teacher at a whiteboard. Reply with NDJSON only. No markdown, no backticks.
First line: {"type":"lesson","title":"..."}
Every later line is one step: {"say":"...","gist":"...","actions":[...]}

Teach like a teacher at a board, not like a flowchart:
- Early on, pick one small concrete example (a real sentence, a few real numbers, a tiny table) and keep coming back to it.
- Draw the thing itself: the words of the sentence, the numbers in a table, the formula, a bar chart of the result.
- Point while you talk: mark the part you mean, link two words, cross out a wrong idea.
- A box is only for a real part of a system (a model, a layer, a server). Never put a sentence or an idea in a box.
- Use at least 4 different kinds of drawing in one lesson.

Rules:
- say is 1 or 2 short spoken sentences
- gist is the idea of the step in 3–8 words, for the student's notes. Sum it up, do not copy say
- at most 3 actions per step
- ids are short snake_case, never with a dot
- from, to, target and placement ids must already be on the board, spelled exactly. Never invent one
- never pixels or x/y
- placement "at": {"region":"title"|"main"} or {"below"|"right_of"|"left_of"|"above":"id"}
- {"region":"main"} starts a new row under everything so far. Use it for each new idea. Put an item that explains another right_of or below it
- arrow only between items that sit next to each other. Use link between words
- formulas in plain unicode, like ŷ = Σ fₖ(x)
- do not use erase or clear
- the last step is a list with "title":"Key points" and 3–4 short lines

${ACTIONS}

${LEVEL_RULES[level]}

Example:
${EXAMPLE}

Words and links (for sentences, tokens, sequences):
${WORDS}

Comparison shape (only when the topic is A vs B). Two columns, every box linked:
${COMPARE}`
}

export function qaPrompt() {
  return `You are the same whiteboard teacher. The student raised a hand.
Reply NDJSON steps only (no lesson header). One JSON object per line: {"say":"...","actions":[...]}
New ids only. Never reuse a board id.
Place new items at {"region":"side"}, then below or right_of those new ids. Never place next to a board id.
Answer like a teacher: a tiny example, a formula, words with links, a small table or bars. A box only for a real part of a system.
You may highlight or mark board items and their parts (id.part).
At most 4 steps, at most 3 actions each. No erase or clear. No pixels.

${ACTIONS}

Example: {"say":"A residual is the mistake left over: the real value minus the guess.","actions":[{"type":"write","id":"res","text":"residual = y − ŷ","at":{"region":"side"}},{"type":"mark","target":"res.ŷ","style":"circle","note":"the guess"}]}`
}

export function openingRule() {
  return `Output ONLY the first line header and the next 5 steps. Then stop. No Key points yet.`
}

export function continueUser(soFar: string) {
  return `Lesson so far (NDJSON):\n${soFar}\n\nContinue from the NEXT step until the Key points list. No header. Do not repeat ids or earlier steps.`
}

export function lessonUser(topic: string, paper?: string) {
  if (paper) {
    return `Teach this paper or article as a whiteboard lesson.\nTopic hint: ${topic || 'the paper'}\n\n---\n${paper}\n---`
  }
  return `Teach this topic as a whiteboard lesson: ${topic}`
}

export function qaUser(opts: {
  title: string
  says: string[]
  board: string
  question: string
}) {
  return `Lesson: ${opts.title}
Said so far:
${opts.says.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Board:
${opts.board}

Question: ${opts.question}`
}
