/**
 * Calling our own API, with failures that say what happened.
 *
 * WHY THIS EXISTS. Every call site was doing `await res.json()` directly, so
 * any response that was not JSON surfaced to the admin as
 *
 *   JSON.parse: unexpected character at line 1 column 1 of the JSON data
 *
 * which is true, useless, and actively misleading — it reads like a bug in the
 * data rather than "the server sent you a 404 page". A redirect to /login, a
 * 502 from a proxy, a route that failed to build: all produce HTML, and all
 * produced that same meaningless line.
 *
 * Reading the body as TEXT first and parsing second costs nothing and turns
 * every one of those into a sentence naming the status and the first bytes of
 * what actually came back.
 */
export async function postJson<T = { ok?: boolean; error?: string }>(
  url: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await res.text()

  let data: (T & { ok?: boolean; error?: string }) | null = null
  try {
    data = JSON.parse(text) as T & { ok?: boolean; error?: string }
  } catch {
    // Not JSON. Say so precisely — the status is usually the whole answer, and
    // the first bytes distinguish a login redirect from a 404 from a crash.
    const kind = res.status === 404 ? ' — that endpoint does not exist' : ''
    throw new Error(
      `Server returned ${res.status} ${res.statusText}${kind}. ` +
        `Body began: ${text.slice(0, 80).replace(/\s+/g, ' ').trim() || '(empty)'}`,
    )
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`)
  }

  return data
}
