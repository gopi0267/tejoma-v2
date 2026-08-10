/**
 * A real, minimal stand-in for the monolith's /internal/matching-evaluation/* API - mirrors
 * chat-service's tests/helpers/mockMonolith.ts approach (real HTTP on a real ephemeral port, not
 * a mock of `fetch`), so the proxy route tests exercise monolithClient.ts's actual network code.
 * Per-path-prefix responses since this service's three proxy endpoints need different shapes.
 */
import http from 'http';

export interface ReceivedRequest {
  method: string;
  url: string;
  body: string;
}

export interface MockMonolith {
  url: string;
  received: ReceivedRequest[];
  nextResponse: { status: number; body: any };
  responses: Record<string, { status: number; body: any }>;
  close: () => Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

export async function startMockMonolith(): Promise<MockMonolith> {
  const received: ReceivedRequest[] = [];
  const state: MockMonolith = {
    url: '',
    received,
    nextResponse: { status: 200, body: {} },
    responses: {},
    close: async () => {},
  };

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url || '';
    received.push({ method: req.method || '', url, body });

    const pathOnly = url.split('?')[0];
    const matchedPrefix = Object.keys(state.responses).find((prefix) => pathOnly.startsWith(prefix));
    const { status, body: responseBody } = matchedPrefix ? state.responses[matchedPrefix] : state.nextResponse;

    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock monolith');

  state.url = `http://127.0.0.1:${address.port}`;
  state.close = () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return state;
}
