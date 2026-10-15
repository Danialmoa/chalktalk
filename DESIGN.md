# ChalkTalk: design

## The idea

ChalkTalk is a whiteboard tutor for **ML and system-design interview prep**. You give it a topic ("explain XGBoost") or a **PDF** (a paper or article). It teaches the way a professor uses a blackboard: it talks, writes in handwriting, draws boxes and arrows, and highlights things, one step at a time. You can **raise your hand** at any moment. It answers on the board, then goes back to the lesson.

Everything runs on your laptop with open models: Ollama for the LLM, Kokoro for the voice, and Whisper (optional) for spoken questions. That means no API cost, your papers stay private, and it works offline.

**Hackathon:** DEV Hacktoberfest Week 2, theme "Side Hustle" (something people would pay for). Due **Sun 18 Oct 2026**. Writing quality counts the most. You get a bonus for a first real user, and for reporting whether they paid.

**Who pays:** people preparing for ML engineer, data science and system-design interviews. Today they pay for courses and mock interviews.

**Closest competitor:** Gauth's canvas mode. What we do better:
1. Local and open: free per lesson and private.
2. A niche: ML topics and papers. You can upload a PDF.
3. Answers to your questions go in a **side area** and highlight the existing drawing they refer to, so the main board stays clean.
4. Replay and export the board. Excalidraw already has PNG and `.excalidraw` export.

## User flow

1. Enter a topic or upload a PDF. Pick a level: `beginner` or `interview`.
2. Press **Start**. The title is written on the board and the voice begins.
3. The steps play. Controls: play/pause, speed (0.75x to 2x), skip step, ✋ raise hand.
4. Raise hand: playback pauses and a question box opens. The answer is spoken and drawn in the side area. Press **Continue** to resume the lesson.
5. The last step is a "Key points" box. Then export if you want.

## Architecture

There is no backend. It all runs in the browser. The Vite dev server proxies `/ollama` to `localhost:11434` (already set up in `vite.config.ts`).

```
topic / PDF ─► pdf/extract.ts ─► lesson/generate.ts ─► Ollama /api/chat (stream)
                                       │  one JSON step per line (NDJSON)
                                       ▼
                               zod check (lesson/schema.ts)
                                       │  step queue
                                       ▼
✋ question ─► lesson/qa.ts ─►   player/player.ts ──► voice/tts.ts ─► audio
                                       │
                                       ▼
                         board/layout.ts ─► board/draw.ts ─► Excalidraw API
```

## Files

| File | Job | Status |
|---|---|---|
| `src/App.tsx` | UI shell: topic input, PDF upload, controls, canvas | smoke test only |
| `src/lesson/schema.ts` | **The contract**: Step and Action types (zod) | done |
| `src/lesson/fixtures/xgboost.jsonl` | Hand-written sample lesson for Day 1 | done |
| `src/lesson/prompts.ts` | System prompts for lessons and Q&A | todo |
| `src/lesson/generate.ts` | Calls Ollama, streams lines, yields valid Steps | todo |
| `src/lesson/qa.ts` | Raise-hand answers | todo |
| `src/board/layout.ts` | Turns `at` into x/y and avoids overlap | todo |
| `src/board/draw.ts` | Turns actions into Excalidraw elements, with animation | todo |
| `src/board/summary.ts` | Board as short text for the model | todo |
| `src/player/player.ts` | Step queue, play/pause/skip/speed, voice sync | todo |
| `src/voice/tts.ts` | Kokoro in the browser, falls back to `speechSynthesis` | todo |
| `src/voice/stt.ts` | (stretch) Whisper push-to-talk | todo |
| `src/pdf/extract.ts` | PDF to text with pdfjs | todo |

## Lesson format (the core contract)

The model writes **NDJSON**: one JSON object per line. The first line is the header. Every line after it is one step. See `src/lesson/schema.ts` for the exact types and `fixtures/xgboost.jsonl` for a full example.

```jsonl
{"type":"lesson","title":"XGBoost in 5 minutes"}
{"say":"We start with the data and a first tree.","actions":[{"type":"box","id":"data","text":"Data (x, y)","at":{"region":"main"}},{"type":"box","id":"tree1","text":"Tree 1","at":{"right_of":"data"}},{"type":"arrow","from":"data","to":"tree1"}]}
{"say":"Tree 2 learns only the mistakes of tree 1.","actions":[{"type":"box","id":"tree2","text":"Tree 2","at":{"right_of":"tree1"}},{"type":"arrow","from":"tree1","to":"tree2","label":"mistakes"},{"type":"highlight","target":"tree2"}]}
```

**Step** = `say` (one or two sentences spoken aloud) + `actions` (at most 3 things drawn while it is said).

| Action | Fields | What it does |
|---|---|---|
| `write` | id, text, at, size?, font? (`hand`/`code`) | Handwritten text that appears letter by letter |
| `box` | id, text, at, shape? (`rect`/`ellipse`/`diamond`) | A shape with a label |
| `arrow` | from, to, label?, dashed?, id? | Arrow between two ids, bound to both |
| `highlight` | target | Yellow marker behind the target |
| `circle` | target | Red circle around the target |
| `underline` | target | Line under the target |
| `erase` | target | Removes the element |
| `clear` | none | New empty board |

**`at` (placement): the model never gives pixels.** LLMs are bad at coordinates, and small open models are worse. The model only says:
- `{"region": "title" | "main" | "side"}` for the first item in a region
- `{"below": id}`, `{"right_of": id}`, `{"left_of": id}`, `{"above": id}`

The code does the real placement (see Board layout).

## Board layout (`layout.ts`)

- Regions: `title` is a strip at the top, `main` is the left ~75%, and `side` is the right ~25%, used for Q&A answers.
- Keep a map `id → bounding box`. A relative placement is the anchor's box plus a 60px gap. If the result overlaps something, move it down until it doesn't.
- The camera follows new content with `api.scrollToContent(element, { animate: true })`. The board can grow downward like a long blackboard, so there is no overflow problem.
- If an action points at an unknown id, drop that action and keep going. Never crash on bad model output.

## Drawing and the handwritten feel (`draw.ts`)

- Create elements with `convertToExcalidrawElements(skeletons, { regenerateIds: false })` so that model ids equal element ids (check this option name in Excalidraw 0.18). Draw them with `api.updateScene({ elements })`.
- Font: Excalifont, Excalidraw's handwritten font (`FONT_FAMILY` export), for all writing. Comic Shanns for `font: "code"`.
- Animations, scaled by the speed setting:
  - `write`: typewriter. Grow the text one character every ~40ms.
  - `arrow`: grow the end point from start to end over ~400ms.
  - `box`: fade opacity 0→100 over ~300ms. Excalidraw's rough style already looks hand-drawn. Stretch goal: trace the outline.
  - `highlight`: a rectangle with background `#ffec99`, solid fill, no stroke, opacity ~60, and 10px padding. It **must sit behind** the target, so insert it before the target in the elements array.
  - `circle`: an ellipse around the box plus 16px, red stroke, no fill.
- Arrows bind to shapes through the skeleton `start: { id }` and `end: { id }`. Use `label: { text }` for arrow labels.

## Voice sync (`player.ts` + `tts.ts`)

For each step:
1. Make the audio for `say` and get its duration `d`. While the current step plays, **make the next step's audio ahead of time**, so there's no gap.
2. Play the audio. Run the actions in order, spread over `d` (each gets `d / n`, at least 300ms).
3. The step ends when both the audio and the drawing are done.

Speed sets `audio.playbackRate` and scales all animation times.

Kokoro: `KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "webgpu" | "wasm" })`, then `tts.generate(text, { voice: "af_heart" })`. The model downloads on first use and is cached after that. **Build Day 1 with `speechSynthesis` first**, and swap in Kokoro once the player works.

## LLM (`generate.ts`)

- Use Ollama through `import { Ollama } from 'ollama/browser'` with host `${location.origin}/ollama`.
- Default model: `qwen3:8b` (fits a 16GB Mac). Make it a setting so `qwen3:14b` or `gpt-oss:20b` can be used.
- Call `chat({ stream: true, think: false, options: { num_ctx: 16384, temperature: 0.4 } })`.
  - `think: false` turns off Qwen3's thinking, which is much faster.
  - **Gotcha:** Ollama's default context is small, so a PDF gets cut **silently**. Always set `num_ctx`.
- **Don't use Ollama's `format` (JSON schema) option.** It forces a single JSON object, which kills streaming. Instead, buffer the streamed text, split it on newlines, `JSON.parse` and zod-check each full line, and skip bad lines. The first step can play while the rest are still being written.
- Prompt rules (`prompts.ts`):
  - plain words
  - `say` is 1 or 2 short sentences
  - at most 3 actions per step
  - 12 to 25 steps
  - short snake_case ids
  - never pixels
  - use `highlight`/`circle` to point at what you're talking about
  - write formulas in plain unicode (`ŷ = Σ fₖ(x)`)
  - end with a "Key points" box
  - `interview` level adds "Interview tip" boxes and common follow-up questions
- Put the full action table and the xgboost fixture in the prompt as an example. Small models copy examples well.

## PDF (`extract.ts`)

- Use pdfjs-dist: for each page, `getTextContent()`, then join the pages. Set up the worker in Vite with `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
- Cut the text to about 40k characters for an 8B model.
- Start with one pass: "teach this paper" plus the text. Only if quality is bad, switch to two passes: first "list the 5 key ideas", then a lesson built from those ideas.
- Formulas extract badly from PDFs. The prompt should teach the intuition and rewrite any formula in plain unicode.

## Raise hand (`qa.ts`)

1. Press ✋ (or the `H` key). The player finishes the current action and pauses.
2. A question box appears. Typing is enough for the MVP. Stretch: hold Space to talk, using Whisper via transformers.js.
3. Send the model: the lesson title, every `say` line so far, the board summary (`summary.ts` writes one line per element: `id | type | text`), and the question.
4. The model answers in the same NDJSON format. New items must use `at: {"region":"side"}` or be placed relative to side items. It **may `highlight` or `circle` ids on the main board**, so the answer points at the drawing. This is the "better than Gauth" part.
5. **Continue** resumes the next lesson step. The side area is cleared on the next question.

## Stretch goals (only if there's time)

- `formula` action: render LaTeX with KaTeX to SVG and add it as an Excalidraw image element.
- Whisper push-to-talk.
- Trace box outlines like real handwriting.
- Save and replay a lesson: the NDJSON plus the questions asked.

**Out of scope:** accounts, cloud hosting, a server, multi-user, mobile.

## Build order (4 days)

- **Day 1:** `layout.ts`, `draw.ts` and `player.ts` playing `fixtures/xgboost.jsonl`, using `speechSynthesis` for voice. **Checkpoint: is watching it actually enjoyable?** If not, fix pacing before anything else.
- **Day 2:** `prompts.ts` and `generate.ts`, plus the topic input. Then switch to Kokoro.
- **Day 3:** raise-hand Q&A and PDF upload.
- **Day 4:** polish. Record the demo: XGBoost, plus one paper such as "Attention Is All You Need", with a question asked in the middle. Write the DEV post. Get 1 or 2 friends who are preparing for interviews to try it, for the "My First User" section.

## DEV post checklist

The template sections are: What I Built, Demo, Code, How I Built It, Why Open Innovation Matters, and My First User (optional). Use the tags `devchallenge` and `hf26challenge`.

"Why open" points for the post:
- runs offline
- papers and notes stay private
- costs nothing per lesson, which matters for a cheap student product
- you can swap or fine-tune the model
