/**
 * A real, minimal, generic stand-in upstream server for Gateway tests - real HTTP on a real
 * ephemeral port, not a mock of http-proxy-middleware or fetch. Echoes back everything about the
 * request it received (method, path, headers, body) so tests can assert on exactly what the
 * Gateway actually forwarded - the strongest possible proof that routing, path preservation, and
 * body/cookie passthrough all work for real, not just "the proxy library probably does this."
 */
import http from 'http';

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockUpstream {
  url: string;
  received: ReceivedRequest[];
  /** Overrides the next response's status/body/headers - reset to defaults after each use. */
  nextResponse: { status: number; body: any; headers?: Record<string, string> };
  close: () => Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

export async function startMockUpstream(name: string): Promise<MockUpstream> {
  const received: ReceivedRequest[] = [];
  const state: MockUpstream = {
    url: '',
    received,
    nextResponse: { status: 200, body: { ok: true, upstream: name } },
    close: async () => {},
  };

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });

    const { status, body: responseBody, headers } = state.nextResponse;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(responseBody));

    // Reset to the default for the next request, unless the test wants every request in a batch
    // to get the same override (tests re-set nextResponse explicitly when that's needed).
    state.nextResponse = { status: 200, body: { ok: true, upstream: name } };
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(`Failed to bind mock upstream ${name}`);

  state.url = `http://127.0.0.1:${address.port}`;
  state.close = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return state;
}
