import { useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import './index.css'
import {
  ArrowRight,
  CornerDownRight,
  FileUp,
  Hand,
  LogOut,
  Minus,
  NotebookPen,
  Pause,
  Play,
  Plus,
  SkipForward,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { Account } from './auth'
import { Board } from './board/draw'
import { generateLesson } from './lesson/generate'
import { loadHistory, upsert, type HistoryItem } from './lesson/history'
import { LEVELS, LEVEL_BLURB, type Level } from './lesson/level'
import { parseLesson } from './lesson/load'
import { answerQuestion } from './lesson/qa'
import type { Step } from './lesson/schema'
import { Player, type PlayerState } from './player/player'
import { extractPdf } from './pdf/extract'
import { isMuted, onVoiceStatus, setMuted, warmup } from './voice/tts'
import fixture from './lesson/fixtures/xgboost.jsonl?raw'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

type Props = { account: Account | null; onSignOut: () => void }

export default function App({ account, onSignOut }: Props) {
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
    notes: [],
  })
  const [zoom, setZoom] = useState(1)
  const [topic, setTopic] = useState('XGBoost')
  const [level, setLevel] = useState<Level>('basic')
  const [pdfName, setPdfName] = useState('')
  const pdfText = useRef('')
  const [busy, setBusy] = useState('')
  const [preparing, setPreparing] = useState(false)
  const genId = useRef(0)
  const [question, setQuestion] = useState('')
  const [answering, setAnswering] = useState(false)
  const [askError, setAskError] = useState('')
  const [muted, setMuteUi] = useState(isMuted)
  const [voice, setVoice] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  const currentId = useRef<string | null>(null)
  const collected = useRef<Step[]>([])
  const lastNote = useRef<HTMLLIElement | null>(null)
  const pen = useRef<HTMLDivElement | null>(null)

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setMuteUi(next)
  }

  useEffect(() => onVoiceStatus(setVoice), [])

  useEffect(() => warmup(), [])

  useEffect(() => {
    lastNote.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ui.notes.length])

  useEffect(() => {
    if (!api) return
    const b = new Board(api, pen.current ?? undefined)
    board.current = b
    const p = new Player(b)
    player.current = p
    setZoom(api.getAppState().zoom.value)
    const offPlayer = p.onChange(setUi)
    const offZoom = api.onScrollChange((_x, _y, z) => {
      setZoom(z.value)
      b.placePen()
    })
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
    player.current?.setSpeed(SPEEDS.find((s) => s > ui.speed) ?? SPEEDS[0])
  }

  const remember = (item: HistoryItem) => {
    setHistory((prev) => upsert(prev, item))
  }

  const cancelLesson = () => {
    genId.current++
    setBusy('')
    setPreparing(false)
  }

  const warmPlay = (p: Player) => {
    const gen = genId.current
    setPreparing(true)
    void p.warmStart().then(() => {
      if (gen === genId.current) setPreparing(false)
    })
  }

  const goHome = () => {
    cancelLesson()
    player.current?.load('', [])
    setQuestion('')
    setAskError('')
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
    cancelLesson()
    p.load(item.title, item.steps, item.level)
    warmPlay(p)
  }

  const startDemo = () => {
    const p = player.current
    if (!p) return
    cancelLesson()
    const lesson = parseLesson(fixture)
    const id = crypto.randomUUID()
    currentId.current = id
    collected.current = lesson.steps
    p.load(lesson.title, lesson.steps, level)
    warmPlay(p)
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
    const gen = ++genId.current
    const id = crypto.randomUUID()
    currentId.current = id
    collected.current = []
    const first = 'Writing the first steps…'
    setBusy(first)
    setPreparing(true)
    p.load(topic.trim() || 'Lesson', [], level, false)
    let title = topic.trim() || 'Lesson'
    let got = 0
    let begun = false
    // Start once 3 steps and the first step's voice are ready, then keep writing in the background.
    // The opening call writes 5 steps, so the lesson has about half a minute in hand while the
    // second call (which can be slow to start) writes the rest.
    const begin = () => {
      if (begun) return
      begun = true
      void p.warmStart().then(() => {
        if (gen !== genId.current) return
        setPreparing(false)
        setBusy((b) => (b === first ? 'Writing more steps…' : b))
      })
    }
    try {
      for await (const ev of generateLesson(topic.trim(), level, pdfText.current || undefined)) {
        if (gen !== genId.current) return
        if (ev.type === 'header') {
          title = ev.title
          if (!got) p.load(ev.title, [], level, false)
        } else if (ev.type === 'ready') {
          begin()
        } else {
          got++
          collected.current = [...collected.current, ev.step]
          p.push(ev.step)
          if (got === 3) begin()
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
      if (!got) setPreparing(false)
      p.finish()
      setBusy(got ? '' : 'No lesson from Backboard. Try Demo.')
    } catch (e) {
      if (gen !== genId.current) return
      const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 180) : 'Backboard failed'
      p.finish()
      if (got) begin()
      else setPreparing(false)
      setBusy(msg || 'Backboard failed')
    }
  }

  const ask = async () => {
    const p = player.current
    const b = board.current
    if (!p || !b || !question.trim() || answering) return
    const q = question.trim()
    setAnswering(true)
    setAskError('')
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
      setAnswering(false)
      await p.playAside(steps)
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 180) : 'Backboard failed'
      setAnswering(false)
      setAskError(msg || 'Backboard failed')
    }
  }

  const started = ui.title !== '' && (ui.total > 0 || busy !== '')
  // Background writing stays quiet; the note only shows when the lesson has caught up and is waiting.
  const writing = busy.startsWith('Writing')
  const caughtUp = !ui.playing && !ui.asking && ui.total > 0 && ui.index >= ui.total
  const shown = Math.min(ui.index + (ui.playing ? 1 : 0), ui.total)
  const current = ui.playing ? ui.notes.length - 1 : -1
  const initials = account?.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="app">
      <aside className="rail">
        <button className="brand" onClick={goHome}>
          <span className="mark">C</span>
          ChalkTalk
        </button>
        <button className="new" onClick={goHome}>
          <Plus size={16} /> New lesson
        </button>
        <div className="rail-label">History</div>
        <div className="history">
          {history.length === 0 && <span className="history-empty">Your lessons will show up here.</span>}
          {history.map((item) => (
            <button
              key={item.id}
              className={item.kind === 'question' ? 'q' : ''}
              onClick={() => replay(item)}
            >
              {item.kind === 'question' && <CornerDownRight size={13} className="q-icon" />}
              <span className="name">{item.title}</span>
              <span className="meta">
                {item.kind === 'question' ? 'Question' : item.level} · {item.steps.length} steps
              </span>
            </button>
          ))}
        </div>
        <div className="account">
          <span className={account ? 'avatar' : 'avatar anon'}>{account ? initials : <UserRound size={16} />}</span>
          <span className="who">
            <span className="who-name">{account ? account.name : 'Guest'}</span>
            <span className="who-sub">{account ? account.email : 'Not logged in'}</span>
          </span>
          {account ? (
            <button className="icon" title="Log out" onClick={onSignOut}>
              <LogOut size={16} />
            </button>
          ) : (
            <button className="login-btn" onClick={onSignOut}>
              Log in
            </button>
          )}
        </div>
      </aside>
      <main className="stage">
        <div className="board-wrap">
          <div className="board">
            <Excalidraw
              excalidrawAPI={setApi}
              viewModeEnabled
              zenModeEnabled
              theme="light"
              initialData={{ appState: { viewBackgroundColor: '#fcfcfb' } }}
            />
          </div>
          <div className="pen" ref={pen} />
          {preparing && (
            <div className="preparing">
              <span className="spinner" />
              <div className="preparing-title">Preparing your lesson</div>
              {ui.title && <div className="preparing-topic">{ui.title}</div>}
              <div className="preparing-sub">
                {ui.total ? `${ui.total} ${ui.total === 1 ? 'step' : 'steps'} ready…` : 'Writing the first steps…'}
              </div>
              {!muted && <div className="preparing-sub">{voice || 'Getting the voice ready…'}</div>}
            </div>
          )}
          {started && !preparing && (
            <div className="dock">
              <div className="dock-top">
                <span className="title">{ui.title}</span>
                <span className="step">
                  Step {shown || 1} of {ui.total || '…'}
                </span>
              </div>
              <div className="progress">
                <span style={{ width: `${ui.total ? (shown / ui.total) * 100 : 0}%` }} />
              </div>
              <div className="dock-row">
                {ui.playing ? (
                  <button className="icon play" title="Pause" onClick={() => player.current?.pause()}>
                    <Pause size={16} />
                  </button>
                ) : (
                  <button className="icon play" title="Play" onClick={() => player.current?.play()}>
                    <Play size={16} />
                  </button>
                )}
                <button className="icon" title="Skip step" onClick={() => player.current?.skip()}>
                  <SkipForward size={16} />
                </button>
                <button
                  className={ui.hand ? 'hand on' : 'hand'}
                  title="Raise hand (H)"
                  onClick={() => player.current?.raiseHand()}
                >
                  <Hand size={16} /> {ui.hand ? 'Hand raised…' : 'Raise hand'}
                </button>
                <span className="dock-gap" />
                <button className="icon" title={muted ? 'Voice off' : voice || 'Voice on'} onClick={toggleMute}>
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                {voice && !muted && <span className="voice-status">{voice}</span>}
                <button className="chip" title="Speed" onClick={bumpSpeed}>
                  {ui.speed}x
                </button>
                <span className="sep" />
                <button className="icon" title="Zoom out" onClick={() => bumpZoom(-1)}>
                  <Minus size={16} />
                </button>
                <button className="chip" title="Reset zoom" onClick={() => bumpZoom(0)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button className="icon" title="Zoom in" onClick={() => bumpZoom(1)}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}
          {busy && started && !preparing && (!writing || caughtUp) && <div className="toast">{busy}</div>}
        </div>
        {started && (
          <aside className="notes">
            <div className="notes-head">
              <NotebookPen size={16} /> Notes
            </div>
            <ol className="notes-list">
              {ui.notes.length === 0 && <li className="empty">The main points show up here as the tutor talks.</li>}
              {ui.notes.map((note, i) => (
                <li
                  key={i}
                  className={i === current ? 'now' : ''}
                  ref={i === ui.notes.length - 1 ? lastNote : undefined}
                >
                  {note}
                </li>
              ))}
            </ol>
            {ui.asking && (
              <div className="ask">
                <div className="ask-head">
                  <Hand size={16} /> Your question
                </div>
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
                  autoFocus
                />
                {askError && <p className="error">{askError}</p>}
                <div className="ask-row">
                  <button className="cta small" disabled={answering || !question.trim()} onClick={ask}>
                    {answering ? 'Answering…' : 'Ask'}
                  </button>
                  <button
                    className="ghost"
                    disabled={answering}
                    onClick={() => {
                      player.current?.stopAsk()
                      player.current?.play()
                      setQuestion('')
                      setAskError('')
                    }}
                  >
                    Continue lesson
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
        {!started && (
          <div className="landing">
            <div className="hero">
              <span className="eyebrow">ML and system design interview prep</span>
              <h1>
                Your whiteboard tutor.
                <br />
                <em>Chalk it. Get it.</em>
              </h1>
              <p className="lead">
                Pick a topic. It talks, writes and draws it step by step, and you can raise your hand any time.
              </p>
            </div>
            <div className="card">
              <label className="field-label" htmlFor="topic">
                What do you want to learn?
              </label>
              <div className="topic-row">
                <input
                  id="topic"
                  className="topic"
                  value={topic}
                  placeholder="e.g. explain transformers"
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      start()
                    }
                  }}
                />
                <button className="go" title="Start lesson" disabled={!api || !!busy} onClick={start}>
                  <ArrowRight size={18} />
                </button>
              </div>
              <div className="levels">
                {LEVELS.map((l) => (
                  <button key={l} className={l === level ? 'pill on' : 'pill'} onClick={() => setLevel(l)}>
                    {l}
                  </button>
                ))}
              </div>
              <p className="hint">{LEVEL_BLURB[level]}</p>
              <label className={pdfName ? 'drop on' : 'drop'}>
                <FileUp size={16} />
                <span>{pdfName || 'Add a PDF (optional): a paper or an article'}</span>
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
            </div>
            <div className="landing-row">
              <button className="ghost" disabled={!api} onClick={startDemo}>
                <Play size={14} /> Watch the demo
              </button>
              <button className="ghost" onClick={toggleMute}>
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} {muted ? 'Voice off' : voice || 'Voice on'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
