/**
 * Shared session-refresh coordination + a fetch wrapper for authenticated API calls.
 *
 * Both the proactive silent-refresh timer (AuthContext) and the reactive 401-retry path
 * below funnel through the SAME `refreshSession()` promise. This matters: refresh tokens
 * rotate on every use and treat a reused (already-rotated) token as theft by revoking all
 * sessions (see Step 2). If the timer and a reactive retry ever fired /auth/refresh
 * concurrently with two separate requests, the second one would look like token reuse and
 * nuke the user's own session. Coalescing into one in-flight promise makes that impossible.
 */

interface RefreshResult {
  user_info: { id: number; name: string; email: string; role: string };
  company_id: number;
  company: { id: number; name: string; logo_url: string | null; plan: string } | null;
}

let refreshPromise: Promise<RefreshResult | null> | null = null;

async function doRefresh(): Promise<RefreshResult | null> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function refreshSession(): Promise<RefreshResult | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

/**
 * Drop-in replacement for fetch() for authenticated API calls. On a 401, tries exactly
 * one silent refresh and retries the request once; if that also fails, notifies
 * AuthContext (which clears state and shows the login screen) and returns the original 401.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshSession();
  if (!refreshed) {
    onSessionExpired?.();
    return res;
  }

  return fetch(input, init);
}
