# ChalkTalk: design

## The idea

ChalkTalk is a whiteboard tutor for **ML and system-design interview prep**. You give it a topic ("explain XGBoost") or a **PDF** (a paper or article). It teaches the way a professor uses a blackboard: it talks, picks one small example, writes the words and formulas, draws small tables and bar charts, links words, and marks or crosses things out, one step at a time. A pen dot moves to whatever it's drawing. You can **raise your hand** at any moment. It answers on the board, then goes back to the lesson.

It uses open models: Gemma 4 writes the lessons (called through Backboard, which routes to OpenRouter), and Kokoro speaks them, running in the browser.

**Hackathon:** DEV Hacktoberfest Week 2, theme "Side Hustle" (something people would pay for). Due **Sun 18 Oct 2026**. Writing quality counts the most. You get a bonus for a first real user, and for reporting whether they paid.

**Who pays:** people preparing for ML engineer, data science and system-design interviews. Today they pay for courses and mock interviews.

**Closest competitor:** Gauth's canvas mode. What we do better:
1. Local and open: free per lesson and private.
2. A niche: ML topics and papers. You can upload a PDF.
3. Answers to your questions go in a **side area** and highlight the existing drawing they refer to, so the main board stays clean.
4. Replay and export the board. Excalidraw already has PNG and `.excalidraw` export.

## User flow

0. Log in, sign up, or press **Try as guest**.
1. Enter a topic or upload a PDF. Pick a level: `basic`, `intermediate` or `interview`.
2. Press **Start**. A "Preparing your lesson" card shows while the first three steps are written and the first step's voice is made (the voice wait is capped at 8 s). Then the lesson starts and the rest is written in the background. A "Writing more steps…" note only shows if the lesson catches up and has to wait. The voice is on by default.
3. The steps play. Each step adds a short line to the **Notes** panel next to the board. Controls: play/pause, speed (0.75x to 2x), skip step, ✋ raise hand.
4. Raise hand: playback pauses and a question box opens. The answer is spoken and drawn in the side area, then the box comes back for a follow-up. Press **Continue** to clear the answer and resume the lesson.
5. The last step is a "Key points" list. Then the camera zooms out to show the whole board. Export if you want.

## Architecture

The lesson runs in the browser. A small FastAPI server (`server/`, same stack as Spoke & Story) does three things: it keeps the Backboard key and forwards `/api/llm`, it handles accounts, and on Render it serves the built page. Locally, Vite proxies `/api` to it on port 8000.

```
topic / PDF ─► pdf/extract.ts ─► lesson/generate.ts ─► lesson/backboard.ts ─► /api/llm ─► Backboard (stream)
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
| `src/Gate.tsx` | Shows the login screen or the app; remembers guests | done |
| `src/Login.tsx` | Log in / Sign up screen | done |
| `src/auth.ts` | Calls `/api/me`, `/api/login`, `/api/signup`, `/api/logout` | done |
| `src/App.tsx` | UI shell: topic input, PDF upload, history, account, controls, canvas, Notes panel | done |
| `src/lesson/schema.ts` | **The contract**: Step and Action types (zod) | done |
| `src/lesson/fixtures/xgboost.jsonl` | Hand-written sample lesson (the Demo button) | done |
| `src/lesson/prompts.ts` | System prompts for lessons and Q&A | done |
| `src/lesson/level.ts` | Levels and their pacing | done |
| `src/lesson/backboard.ts` | Streams a Backboard reply (through `/api/llm`) as lines | done |
| `src/lesson/generate.ts` | Opening call, then a continue call; yields valid Steps | done |
| `src/lesson/qa.ts` | Raise-hand answers | done |
| `src/lesson/history.ts` | Past lessons and questions in localStorage | done |
| `src/board/layout.ts` | Turns `at` into x/y and avoids overlap | done |
| `src/board/route.ts` | Elbow paths for arrows that go around other items | done |
| `src/board/draw.ts` | Turns actions into Excalidraw elements, with animation; `summary()` for the model | done |
| `src/player/player.ts` | Step queue, play/pause/skip/speed, voice sync | done |
| `src/voice/tts.ts` | Plays the voice; silent timing when muted or if it fails to load | done |
| `src/voice/kokoro.worker.ts` | Kokoro in a Web Worker, one sentence at a time | done |
| `src/voice/stt.ts` | (stretch) Whisper push-to-talk | todo |
| `src/pdf/extract.ts` | PDF to text with pdfjs | done |
| `server/main.py` | FastAPI app: `/api/llm`, `/api/health`, serves `dist/` | done |
| `server/auth.py` | Accounts: sign up, log in, log out, me | done |
| `server/db.py` | `users` table: SQLite locally, Postgres on Render | done |
| `server/limits.py` | Per-client rate limit on the LLM, login and signup | done |
| `render.yaml` | Render web service + Postgres | done |

## Server and accounts

- Email + password. Passwords are hashed with scrypt (Python's standard library) and a random salt.
- The login lives in a signed session cookie (Starlette's `SessionMiddleware`, 30 days). `SESSION_SECRET` signs it; Render generates one.
- `/api/llm` takes only `{system, content}`. The server picks the model and caps the size, and every client gets 30 calls a minute, so a public page can't spend the Backboard credit freely.
- History still lives in the browser (localStorage), for guests and accounts alike.

## Lesson format (the core contract)

The model writes **NDJSON**: one JSON object per line. The first line is the header. Every line after it is one step. See `src/lesson/schema.ts` for the exact types and `fixtures/xgboost.jsonl` for a full example.

```jsonl
{"type":"lesson","title":"XGBoost in 5 minutes"}
{"say":"Here are three houses and what they cost.","gist":"Example: three house prices","actions":[{"type":"table","id":"houses","rows":[["house","price"],["A","150k"],["B","240k"],["C","330k"]],"at":{"region":"main"}}]}
{"say":"A mistake is the real price minus the guess.","gist":"Mistake = price − guess","actions":[{"type":"write","id":"mistake","text":"mistake = price − guess","at":{"region":"main"}},{"type":"mark","target":"mistake.mistake","note":"also called residual"}]}
```

**Step** = `say` (one or two sentences spoken aloud) + `gist` (the idea in 3–8 words, shown in the Notes panel) + `actions` (at most 3 things drawn while it is said). Steps saved before `gist` existed show their first spoken sentence instead.

| Action | Fields | What it does |
|---|---|---|
| `write` | id, text, at, size?, font? (`hand`/`code`) | Handwritten text, letter by letter: a title, a formula or a label |
| `words` | id, words, at | A sentence or sequence, one word or token each |
| `link` | from, to, label?, weight? | A curved line between two words or items; `weight` 0–1 makes it thicker |
| `table` | id, rows, at | A small table; the first row is the header |
| `bars` | id, bars (`{label, value}`), unit?, at | A small bar chart; the bars grow in |
| `list` | id, title?, items, at | A list; a later `list` with the same id adds lines |
| `box` | id, text, note?, at, shape? (`rect`/`ellipse`/`diamond`) | A shape with a label, for a real part of a system |
| `arrow` | from, to, label?, dashed?, id? | Arrow between two items |
| `mark` | target, style? (`underline`/`circle`), note? | Underline or circle in red, with a short note under it |
| `strike` | target | Crosses out a wrong idea |
| `highlight` | target | Orange outline on an item, yellow marker behind text |
| `circle`, `underline` | target | Older forms of `mark`, kept so saved lessons still play |
| `erase` | target | Removes the item |
| `clear` | none | New empty board |

**Pointing at a part:** any `target`, `from` or `to` can be `id.part`: a word (`s.cat`), a table cell (`houses.150k`), a bar (`errors.80 m²`), a list line, or a piece of written text (`model.w`, found inside the formula). Matching ignores case and punctuation, and falls back to the whole item.

One bad action is dropped on its own; the rest of the step still plays.

**`at` (placement): the model never gives pixels.** LLMs are bad at coordinates, and small open models are worse. The model only says:
- `{"region": "title" | "main" | "side"}`. `main` starts a new row under everything so far
- `{"below": id}`, `{"right_of": id}`, `{"left_of": id}`, `{"above": id}`

The code does the real placement (see Board layout).

## Board layout (`layout.ts`)

- Regions: `title` is a strip at the top, `main` is where the lesson grows, and `side` is a column to the right of the lesson, used for Q&A answers. It starts at x=1180, or further right if the lesson is wider.
- `{"region":"main"}` starts a new row under the current column. Once a column is about 1000px tall, the next row starts a new column to the right, like a teacher moving across the board. This keeps the end-of-lesson view readable instead of one tall strip.
- Items are placed by their real size: text is measured first, and a box is measured after Excalidraw grows it to fit its label. A words row also keeps room above it for its links.
- Keep a map `id → bounding box`. A relative placement is the anchor's box plus a gap (100px beside, 80px below). If the result is within 24px of something, move it until it isn't. Drawing an item again (after a pause or skip) keeps its spot.
- The camera heads to an item's spot as soon as it is placed, so you watch it being drawn. At the end of each step it frames that step's items, and when the lesson ends it zooms out to the whole board.
- If an action points at an unknown id, drop that action and keep going. Never crash on bad model output.

## Drawing and the handwritten feel (`draw.ts`)

- Create elements with `convertToExcalidrawElements(skeletons, { regenerateIds: false })` so that model ids equal element ids. Draw them with `api.updateScene({ elements })`.
- Pause, skip and reset stop running animations, so an old animation never writes onto a new board. Skip draws the rest of the current step instantly, so later steps can still point at its ids.
- Font: Excalifont, Excalidraw's handwritten font (`FONT_FAMILY` export), for all writing. Comic Shanns for `font: "code"`.
- Animations, scaled by the speed setting:
  - `write`: typewriter. Grow the text one character every ~40ms.
  - `box`: fade in over ~450ms while the pen traces its outline. Excalidraw's rough style already looks hand-drawn.
  - `words`, `table`, `list`: the pieces appear one by one (word by word, row by row, line by line).
  - `bars`: each bar grows from zero, then its value appears.
  - `arrow`, `link`, `mark`, `strike`: fade in while the pen moves along the line.
  - `highlight`: a yellow rectangle behind the target. It **must sit behind** it, so it is inserted before the target in the elements array.
- **The pen** is a red dot over the board (`.pen` in `App.tsx`). Board moves it in board coordinates and converts to screen coordinates on every camera move. It hides on pause, skip and at the end.
- Multi-part items (`words`, `table`, `bars`, `list`) get an invisible rounded frame with the item's id, so the id can be found, framed and highlighted. Each piece keeps `customData: { of, part }`, which is how `id.part` is found.
- Arrows are not bound to shapes. `route.ts` draws an elbow path around other items, and each arrow keeps `customData: { from, to }` so erasing an item also removes its arrows. Arrow labels are written beside the longest stretch of the arrow, so they don't cover it.
- Lines and arrows are given to Excalidraw with their first point at 0,0. Its converter moves any other first point, which used to flatten arrows that point up.

## Voice sync (`player.ts` + `tts.ts`)

For each step:
1. Make the audio for `say` and get its duration `d`. While the current step plays, **make the next step's audio ahead of time**, so there's no gap.
2. Play the audio. Run the actions in order, spread over `d` (each gets `d / n`, at least 300ms).
3. The step ends when both the audio and the drawing are done.

Speed sets `audio.playbackRate` and scales all animation times.

Kokoro: `KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" })`, then `tts.generate(text, { voice: "af_heart" })`. It runs in a Web Worker (`voice/kokoro.worker.ts`), one sentence at a time, like Spoke & Story: on the page, each sentence froze the board and the buttons for 3–15 s. Skip and pause drop clips still waiting in the queue. The page is cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, sent by Vite and by `server/main.py`), which lets onnxruntime use several threads: 7.3 s of speech takes about 5.5 s to make instead of 10.7 s, so the voice stays ahead of the lesson. Safari ignores `credentialless` and keeps one thread, which still works, just with short pauses on long lines. The voice is made up to 3 steps ahead, starting as soon as steps arrive, and each step's drawing is spread over its real voice length (the text-based guess ran about 2 s long and left a silence after every line). Voice is on by default, so the model (about 115 MB) starts downloading when the app opens and is cached after that. While it is still loading, when muted, if it fails to load, or if the browser hasn't allowed audio yet, each step lasts as long as its text takes to read (`charsPerSec` per level), so the lesson never waits on audio. Audio is unlocked on the first click or key press, because Safari only starts audio from inside a user gesture.

## LLM (`generate.ts`)

- `backboard.ts` posts to `/backboard/threads/messages` with `llm_provider: "openrouter"`, `model_name: "google/gemma-4-26b-a4b-it"`, `stream: true` and `json_output: false`. It reads the `content_streaming` events and yields one line at a time.
- Two calls, so the first steps play fast: the opening call returns the header and 5 steps, then a continue call gets the rest, given the lesson so far. Playback starts after 3 steps; the 5 opening steps give about half a minute of lesson while the continue call (which sometimes takes 15–20 s to start) writes the rest.
- **No JSON mode.** It forces a single JSON object, which kills streaming. Instead, split the streamed text on newlines, `JSON.parse` and zod-check each full line, and skip bad lines. The first step can play while the rest are still being written.
- Prompt rules (`prompts.ts`):
  - plain words
  - `say` is 1 or 2 short sentences
  - at most 3 actions per step
  - 8–14 steps (basic), 12–18 (intermediate), 14–22 (interview)
  - short snake_case ids
  - never pixels
  - teach like a teacher, not a flowchart: one small concrete example, draw the thing itself (the sentence, the numbers, the formula), point while talking
  - a box only for a real part of a system, never for an idea or a sentence
  - at least 4 kinds of drawing per lesson
  - `from`, `to` and `target` must be ids already on the board
  - write formulas in plain unicode (`ŷ = Σ fₖ(x)`)
  - end with a "Key points" list
  - `interview` level adds "Interview tip" boxes and common follow-up questions
- The action list is shared by the lesson and Q&A prompts. The lesson prompt has a short example lesson (linear regression with a table, a marked formula, a crossed-out guess and bars), a words-and-links example, and a two-column A-vs-B example. Small models copy examples well.

## PDF (`extract.ts`)

- Use pdfjs-dist: for each page, `getTextContent()`, then join the pages. Set up the worker in Vite with `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
- Cut the text to 12k characters.
- Start with one pass: "teach this paper" plus the text. Only if quality is bad, switch to two passes: first "list the 5 key ideas", then a lesson built from those ideas.
- Formulas extract badly from PDFs. The prompt should teach the intuition and rewrite any formula in plain unicode.

## Raise hand (`qa.ts`)

1. Press ✋ (or the `H` key). The player finishes the current step and pauses.
2. A question box appears. Typing is enough for the MVP. Stretch: hold Space to talk, using Whisper via transformers.js.
3. Send the model: the lesson title, every `say` line so far, the board summary (`Board.summary()` writes one line per item: `id | type | text`, with a box's label as its text), and the question.
4. The model answers in the same NDJSON format. New items must use `at: {"region":"side"}` or be placed relative to side items; anything it anchors to the lesson anyway is moved to the side. It **may `highlight` or `mark` items and parts on the main board**, so the answer points at the drawing. This is the "better than Gauth" part.
5. When the answer ends, the question box comes back for a follow-up. **Continue** clears the side area and everything the answer drew on the main board (marks, highlights, arrows, links), then resumes the next lesson step.

## Stretch goals (only if there's time)

- `formula` action: render LaTeX with KaTeX to SVG and add it as an Excalidraw image element.
- Whisper push-to-talk.
- Draw outlines stroke by stroke, instead of fading them in while the pen traces them.
- Save and replay a lesson: the NDJSON plus the questions asked.

**Out of scope:** syncing history to the account, multi-user boards, mobile.

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
