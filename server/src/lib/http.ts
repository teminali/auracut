/* Request/response plumbing. Small on purpose — the money path should be
   readable end to end without following a framework's control flow. */

export interface ApiError { error: string; detail?: string }

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(), ...extra },
  });
}

export function fail(status: number, error: string, detail?: string): Response {
  return json(detail ? { error, detail } : { error }, status);
}

/*
  Kerf is an Electron renderer, whose Origin under a dev server is
  http://localhost:<port> and under a packaged build is `file://`, which
  browsers send as the literal string "null". Both are allowed; this API
  is not reachable from a web page that matters, and every mutating
  endpoint requires a bearer token rather than a cookie, so there is no
  ambient authority for a CSRF to ride on.
*/
export function cors(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-kerf-version',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-max-age': '86400',
  };
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  return token || null;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
