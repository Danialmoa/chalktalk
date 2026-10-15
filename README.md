# ChalkTalk

A whiteboard tutor for ML and system-design interview prep. It talks, writes and draws step by step, and you can raise your hand to ask a question at any time.

Lessons are generated with **Gemma 4** (`google/gemma-4-26b-a4b-it`) through Backboard, which routes the call to OpenRouter. The Vite dev server proxies `/backboard` and adds your key, so the key never reaches the browser. That proxy only exists in `npm run dev`.

Voice is Kokoro (`onnx-community/Kokoro-82M-v1.0-ONNX`), running in the browser. It is muted by default and downloads the model the first time you unmute.

**Demo** plays a built-in XGBoost lesson and needs no key.

Start with [DESIGN.md](DESIGN.md).

```bash
cp .env.example .env   # put your Backboard key in BACKBOARD_API_KEY
npm install
npm run dev
```
