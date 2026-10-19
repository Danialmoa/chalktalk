import { useEffect, useState } from 'react'
import App from './App'
import Login from './Login'
import { logout, me, type Account } from './auth'

const GUEST = 'chalktalk-guest'

export default function Gate() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [guest, setGuest] = useState(() => localStorage.getItem(GUEST) === '1')

  useEffect(() => {
    me().then(setAccount, () => setAccount(null))
  }, [])

  if (account === undefined) return null

  if (!account && !guest) {
    return (
      <Login
        onAccount={setAccount}
        onGuest={() => {
          localStorage.setItem(GUEST, '1')
          setGuest(true)
        }}
      />
    )
  }

  return (
    <App
      account={account}
      onSignOut={async () => {
        if (account) await logout().catch(() => null)
        localStorage.removeItem(GUEST)
        setGuest(false)
        setAccount(null)
      }}
    />
  )
}
