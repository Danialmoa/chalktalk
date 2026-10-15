import { useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import './index.css'
import { Board } from './board/draw'
import { generateLesson } from './lesson/generate'
import { loadHistory, upsert, type HistoryItem } from './lesson/history'
import { LEVELS, LEVEL_BLURB, type Level } from './lesson/level'
import { parseLesson } from './lesson/load'
import { answerQuestion } from './lesson/qa'
import type { Step } from './lesson/schema'
import { Player, type PlayerState } from './player/player'
import { extractPdf } from './pdf/extract'
import { isMuted, onVoiceStatus, setMuted } from './voice/tts'
import fixture from './lesson/fixtures/xgboost.jsonl?raw'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const board = useRef<Board | null>(null)
  const player = useRef<Player | null>(null)
  const [ui, setUi] = useState<PlayerState>({
    playing: false,
    index: 0,
    total: 0,
    speed: 1,
    title: '',
    asking: false,
    hand: false,
  })
  const [zoom, setZoom] = useState(1)
  const [topic, setTopic] = useState('XGBoost')
  const [level, setLevel] = useState<Level>('basic')
  const [pdfName, setPdfName] = useState('')
  const pdfText = useRef('')
  const [busy, setBusy] = useState('')
  const [question, setQuestion] = useState('')
  const [muted, setMuteUi] = useState(isMuted)
  const [voice, setVoice] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  const currentId = useRef<string | null>(null)
  const collected = useRef<Step[]>([])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setMuteUi(next)
  }

  useEffect(() => onVoiceStatus(setVoice), [])

  useEffect(() => {
    if (!api) return
    const b = new Board(api)
    board.current = b
    const p = new Player(b)
    player.current = p
    setZoom(api.getAppState().zoom.value)
    const offPlayer = p.onChange(setUi)
    const offZoom = api.onScrollChange((_x, _y, z) => setZoom(z.value))
    return () => {
      offPlayer()
      offZoom()
    }
  }, [api])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'H') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      player.current?.raiseHand()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const bumpZoom = (dir: -1 | 0 | 1) => {
    if (!api) return
    const next = dir === 0 ? 1 : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + dir * ZOOM_STEP))
    api.updateScene({ appState: { zoom: { value: next as never } } })
    setZoom(next)
  }

  const bumpSpeed = () => {
    const i = SPEEDS.indexOf(ui.speed)
    const next = SPEEDS[(i + 1) % SPEEDS.length] ?? 1
    player.current?.setSpeed(next)
  }

  const remember = (item: HistoryItem) => {
    setHistory((prev) => upsert(prev, item))
  }

  const replay = (item: HistoryItem) => {
    const p = player.current
    if (!p || !item.steps.length) return
    currentId.current = item.id
    collected.current = item.steps
    if (item.kind === 'question') {
      void p.playAside(item.steps)
      return
    }
    p.load(item.title, item.steps, item.level)
    p.play()
  }

  const startDemo = () => {
    const lesson = parseLesson(fixture)
    const id = crypto.randomUUID()
    currentId.current = id
    collected.current = lesson.steps
    player.current?.load(lesson.title, lesson.steps, level)
    player.current?.play()
    remember({
      id,
      kind: 'lesson',
      title: lesson.title,
      level,
      steps: lesson.steps,
      at: Date.now(),
    })
  }

  const start = async () => {
    const p = player.current
    if (!p || (!topic.trim() && !pdfText.current) || busy) return
    const id = crypto.randomUUID()
    currentId.current = id
    collected.current = []
    setBusy('Writing the first steps…')
    p.load(topic.trim() || 'Lesson', [], level)
    let title = topic.trim() || 'Lesson'
    let got = false
    try {
      for await (const ev of generateLesson(topic.trim(), level, pdfText.current || undefined)) {
        if (ev.type === 'header') {
          title = ev.title
          if (!got) p.load(ev.title, [], level)
        } else {
          got = true
          collected.current = [...collected.current, ev.step]
          p.push(ev.step)
          setBusy('Writing more steps…')
          remember({
            id,
            kind: 'lesson',
            title,
            level,
            steps: collected.current,
            at: Date.now(),
          })
        }
      }
      setBusy(got ? '' : 'No lesson from Backboard. Try Demo.')
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 180) : 'Backboard failed'
      setBusy(msg || 'Backboard failed')
    }
  }

  const ask = async () => {
    const p = player.current
    const b = board.current
    if (!p || !b || !question.trim() || busy === 'Answering…') return
    const q = question.trim()
    setBusy('Answering…')
    try {
      const steps = await answerQuestion({
        title: ui.title,
        says: p.says(),
        board: b.summary(),
        question: q,
      })
      if (!steps.length) throw new Error('No answer from Backboard')
      remember({
        id: crypto.randomUUID(),
        kind: 'question',
        title: q,
        level,
        steps,
        parentId: currentId.current ?? undefined,
        at: Date.now(),
      })
      setQuestion('')
      setBusy('')
      await p.playAside(steps)
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 180) : 'Backboard failed'
      setBusy(msg || 'Backboard failed')
    }
  }

  const started = ui.title !== '' && (ui.total > 0 || busy !== '')

  return (
    <div className="app">
      <aside className="rail">
        <button
          className="brand"
          onClick={() => {
            player.current?.stop()
            board.current?.reset()
            setBusy('')
            setQuestion('')
          }}
        >
          <span className="mark">C</span>
          ChalkTalk
        </button>
        <div className="rail-label">History</div>
        <div className="history">
          {history.length === 0 && <span className="history-empty">No lessons yet</span>}
          {history.map((item) => (
            <button
              key={item.id}
              className={item.kind === 'question' ? 'q' : ''}
              onClick={() => replay(item)}
            >
              <span className="name">{item.title}</span>
              <span className="meta">
                {item.kind === 'question' ? 'Question' : item.level} · {item.steps.length} steps
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="stage">
        <div className="board">
          <Excalidraw
            excalidrawAPI={setApi}
            viewModeEnabled
            zenModeEnabled
            theme="light"
            initialData={{ appState: { viewBackgroundColor: '#f4f4f5' } }}
          />
        </div>
        {!started && (
          <div className="landing">
            <h1>
              Your whiteboard tutor.<br />
              <em>Chalk it. Get it.</em>
            </h1>
            <p>ML and system design, drawn step by step on your laptop.</p>
            <input
              className="topic"
              value={topic}
              placeholder="Topic, e.g. explain transformers"
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  start()
                }
              }}
            />
            <div className="levels">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className={l === level ? 'pill on' : 'pill'}
                  onClick={() => setLevel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="hint">{LEVEL_BLURB[level]}</p>
            <label className="pdf">
              {pdfName || 'Optional PDF'}
              <input
                type="file"
                accept="application/pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) {
                    pdfText.current = ''
                    setPdfName('')
                    return
                  }
                  setPdfName(file.name)
                  pdfText.current = await extractPdf(file)
                }}
              />
            </label>
            <div className="row">
              <button className="cta" disabled={!api || !!busy} onClick={start}>
                {busy || 'Start'}
              </button>
              <button className="ghost" disabled={!api} onClick={startDemo}>
                Demo
              </button>
              <button className="ghost" onClick={toggleMute} title="Mute">
                {muted ? '🔇 muted' : voice || '🔊 voice'}
              </button>
            </div>
          </div>
        )}
        {started && (
          <div className="dock">
            <div className="dock-top">
              <span className="title">{ui.title}</span>
              <span className="step">
                {Math.min(ui.index + (ui.playing ? 1 : 0), ui.total) || 1}/{ui.total || '…'}
              </span>
            </div>
            <div className="dock-row">
              {ui.playing ? (
                <button className="icon play" onClick={() => player.current?.pause()}>❚❚</button>
              ) : (
                <button className="icon play" onClick={() => player.current?.play()}>▶</button>
              )}
              <button className="icon" onClick={() => player.current?.skip()}>Skip</button>
              <button
                className={ui.hand ? 'icon on' : 'icon'}
                title="Raise hand (H)"
                onClick={() => player.current?.raiseHand()}
              >
                {ui.hand ? 'Hand…' : 'Hand'}
              </button>
              <button className="icon" onClick={toggleMute}>{muted ? 'Mute' : voice || 'Sound'}</button>
              <button className="speed" onClick={bumpSpeed}>{ui.speed}x</button>
              <span className="dock-gap" />
              <button className="icon" onClick={() => bumpZoom(-1)}>−</button>
              <button className="speed" onClick={() => bumpZoom(0)}>{Math.round(zoom * 100)}%</button>
              <button className="icon" onClick={() => bumpZoom(1)}>+</button>
            </div>
          </div>
        )}
        {ui.asking && (
          <div className="ask">
            <p>Your question</p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask()
                }
              }}
              placeholder="Ask about the board…"
              rows={3}
            />
            {busy && busy !== 'Answering…' && <p className="hint">{busy}</p>}
            <div className="row">
              <button className="cta" disabled={busy === 'Answering…' || !question.trim()} onClick={ask}>
                {busy === 'Answering…' ? 'Answering…' : 'Ask'}
              </button>
              <button
                className="ghost"
                disabled={busy === 'Answering…'}
                onClick={() => {
                  player.current?.stopAsk()
                  player.current?.play()
                  setQuestion('')
                  setBusy('')
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}
        {busy && started && !ui.asking && <div className="toast">{busy}</div>}
      </div>
    </div>
  )
}
