# ChalkTalk

A whiteboard tutor for ML and system-design interview prep. It talks and draws like a teacher at a board (the example sentence, formulas, small tables and bar charts, links, marks and crossed-out mistakes), with a pen dot that moves to what it's drawing. It writes the main points in a Notes panel as it goes, and you can raise your hand to ask a question at any time.

Lessons are generated with **Gemma 4** (`google/gemma-4-26b-a4b-it`) through Backboard, which routes the call to OpenRouter. A small FastAPI server (`server/`) keeps the Backboard key, handles log in and sign up, and serves the built page.

Voice is Kokoro (`onnx-community/Kokoro-82M-v1.0-ONNX`), running in the browser. It is on by default. The first visit downloads the model (about 115 MB); until it's ready, lessons play silently.

**Demo** plays a built-in XGBoost lesson and needs no key. **Try as guest** skips the login.

Start with [DESIGN.md](DESIGN.md).

## Run it locally

Two terminals. The API (accounts go in `chalktalk.db`, SQLite):

```bash
cp .env.example .env   # put your Backboard key in BACKBOARD_API_KEY
pip install -r requirements.txt
npm run server         # http://localhost:8000
```

The page (proxies `/api` to the server):

```bash
npm install
npm run dev            # http://localhost:5173
```

Tests: `pytest`.

## Deploy on Render

`render.yaml` describes one web service on the free plan (it builds the page and runs the API) and a free Postgres database. In Render, create a Blueprint from this repo and paste `BACKBOARD_API_KEY` when asked. The free service sleeps after 15 idle minutes, so the first visit after that takes about a minute.
