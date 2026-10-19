export async function errorText(res: Response) {
  const text = await res.text()
  try {
    const { detail } = JSON.parse(text) as { detail?: unknown }
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return 'Please check the form: a name, a real email and 8+ characters of password.'
  } catch {
    // Not JSON: fall through to the raw text.
  }
  if (text) return text
  return res.status >= 500 ? "Can't reach the server." : `Request failed (${res.status})`
}
