import {
  REVOKED_ERROR_CODE,
  REVOKED_MESSAGE,
  REVOKED_REASON,
} from './revocation'

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

  let data: (T & { ok?: boolean; error?: string; code?: string }) | null = null
  try {
    data = JSON.parse(text) as T & { ok?: boolean; error?: string; code?: string }
  } catch {
    // Not JSON. Say so precisely — the status is usually the whole answer, and
    // the first bytes distinguish a login redirect from a 404 from a crash.
    const kind = res.status === 404 ? ' — that endpoint does not exist' : ''
    throw new Error(
      `Server returned ${res.status} ${res.statusText}${kind}. ` +
        `Body began: ${text.slice(0, 80).replace(/\s+/g, ' ').trim() || '(empty)'}`,
    )
  }

  /**
   * ONE FAILURE IS ACTED ON RATHER THAN REPORTED: the acting admin's Discord
   * admin role is gone, the write was refused, and the server has already
   * deleted the session record.
   *
   * A FULL NAVIGATION, not a router push, for the same reason the idle timeout
   * uses one (see hooks/use-idle-timeout.ts): every cached server component,
   * every poller and every piece of module-level state in this tab is about to
   * be wrong, and the session behind them no longer exists. The reason travels
   * as a query param so the login page can explain what happened instead of
   * showing a bare sign-in button to somebody who was mid-ban a second ago.
   *
   * THE THROW STILL HAPPENS, and it is not dead code. `location.replace` does
   * not stop execution, and if the navigation is blocked or slow the caller's
   * own error toast is the only thing the admin will see — so it carries the
   * real reason rather than a generic "Request failed (403)".
   */
  if (data?.code === REVOKED_ERROR_CODE) {
    if (typeof window !== 'undefined') {
      window.location.replace(`/login?reason=${REVOKED_REASON}`)
    }
    throw new Error(REVOKED_MESSAGE)
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`)
  }

  return data
}
