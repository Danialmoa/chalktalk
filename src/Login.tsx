import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { login, signup, type Account } from './auth'

type Props = { onAccount: (account: Account) => void; onGuest: () => void }
type Mode = 'login' | 'signup'

const box = (x: number, y: number, w: number, h: number) =>
  `M${x + 6} ${y + 1} Q${x + w / 2} ${y - 2} ${x + w - 5} ${y + 2} Q${x + w + 1} ${y + h / 2} ${x + w - 3} ${y + h - 1} ` +
  `Q${x + w / 2} ${y + h + 2} ${x + 4} ${y + h} Q${x - 2} ${y + h / 2} ${x + 6} ${y + 1} Z`

function Sketch() {
  return (
    <svg className="sketch" viewBox="0 0 420 250" role="img" aria-label="A whiteboard sketch of boosting">
      <path d={box(12, 70, 100, 58)} fill="#e7f5ff" stroke="#343a40" strokeWidth="2" />
      <path d={box(160, 70, 100, 58)} fill="#fff4e6" stroke="#343a40" strokeWidth="2" />
      <path d={box(308, 70, 100, 58)} fill="#ebfbee" stroke="#e67700" strokeWidth="3" />
      <text x="62" y="106">Data</text>
      <text x="210" y="106">Tree 1</text>
      <text x="358" y="106">Tree 2</text>
      <path d="M124 99 L148 99 M140 92 L149 99 L140 106" stroke="#343a40" strokeWidth="2" fill="none" />
      <path d="M272 99 L296 99 M288 92 L297 99 L288 106" stroke="#343a40" strokeWidth="2" fill="none" />
      <text className="small" x="62" y="150">inputs</text>
      <text className="small" x="210" y="150">rough guess</text>
      <text className="small" x="358" y="150">fits mistakes</text>
      <text className="formula" x="210" y="205">ŷ = f₁(x) + f₂(x) + …</text>
      <path d="M118 216 Q210 211 302 217" stroke="#343a40" strokeWidth="1.5" fill="none" />
      <path d={box(286, 8, 128, 40)} fill="#fff" stroke="#4c6ef5" strokeWidth="1.5" />
      <text className="small ask" x="350" y="33">✋ why mistakes?</text>
    </svg>
  )
}

export default function Login({ onAccount, onGuest }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchTo = (next: Mode) => {
    setMode(next)
    setError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = mode === 'login' ? await login(email, password) : await signup(name, email, password)
      if (user) onAccount(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-art">
        <div className="brand static">
          <span className="mark">C</span>
          ChalkTalk
        </div>
        <div className="auth-pitch">
          <h2>
            Learn it the way it's taught
            <br />
            <em>on a whiteboard.</em>
          </h2>
          <Sketch />
          <ul>
            <li>It talks, writes and draws, step by step</li>
            <li>Raise your hand and ask at any moment</li>
            <li>Made for ML and system design interview prep</li>
          </ul>
        </div>
      </section>
      <section className="auth-side">
        <form className="auth-card" onSubmit={submit}>
          <div className="tabs">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => switchTo('login')}>
              Log in
            </button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>
              Sign up
            </button>
          </div>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="auth-sub">{mode === 'login' ? 'Log in to keep learning.' : 'It only takes a moment.'}</p>
          {mode === 'signup' && (
            <label className="field">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}
          <label className="field">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
            {mode === 'signup' && <span className="field-hint">At least 8 characters</span>}
          </label>
          {error && <p className="error">{error}</p>}
          <button className="cta wide" disabled={busy}>
            {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          <button type="button" className="try-guest" onClick={onGuest}>
            Try as guest <ArrowRight size={14} />
          </button>
        </form>
      </section>
    </div>
  )
}
