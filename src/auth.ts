import { errorText } from './api'

export type Account = { id: number; name: string; email: string }

async function call(path: string, body?: object) {
  const res = await fetch(
    `/api/${path}`,
    body && {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await errorText(res))
  return ((await res.json()) as { user: Account | null }).user
}

export const me = () => call('me')
export const login = (email: string, password: string) => call('login', { email, password })
export const signup = (name: string, email: string, password: string) =>
  call('signup', { name, email, password })
export const logout = () => call('logout', {})
