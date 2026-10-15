# ChalkTalk

A whiteboard tutor for ML and system-design interview prep. It talks, writes and draws step by step, and you can raise your hand to ask a question at any time.

Lessons are generated with **Gemma 4** (`gemma-4-26b-a4b-it`) via the Google AI API. Voice is the browser’s built-in speech (muted by default).

Start with [DESIGN.md](DESIGN.md).

```bash
cp .env.example .env   # put your Google AI Studio key in GOOGLE_API_KEY
npm install
npm run dev
```
