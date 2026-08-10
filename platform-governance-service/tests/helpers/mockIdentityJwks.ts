/**
 * A real, minimal stand-in for Identity Service's JWKS endpoint, used only by tests. This is
 * deliberately NOT a mock of jwt.verify/jwks-rsa (those run for real against this) - it's a real
 * HTTP server, on a real ephemeral port, serving a real RSA public key as a real JWKS document,
 * signing real JWTs with the matching private key. This is the same "never mock, stand in a real
 * lightweight service boundary instead" approach identity-service's own Google OAuth tests use
 * (see identity-service/tests/google-oauth-configured.test.ts's header comment) - the alternative
 * (importing identity-service's actual source into this service's test suite) would violate the
 * "each service is independently deployable, with its own dependency tree" boundary this whole
 * series has maintained.
 */
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import type { AccessTokenPayload } from '../../src/types.js';

function publicKeyToJwk(publicKeyPem: string, kid: string): Record<string, string> {
  const keyObject = crypto.createPublicKey(publicKeyPem);
  const jwk = keyObject.export({ format: 'jwk' }) as Record<string, string>;
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export interface IdentityServiceScenario {
  createUser: 'succeed' | 'fail';
}

export interface MockIdentityService {
  url: string;
  scenario: IdentityServiceScenario;
  createdUsers: any[];
  signStaffToken: (payload: AccessTokenPayload, options?: { kid?: string; expiresInSeconds?: number }) => string;
  close: () => Promise<void>;
}

export async function startMockIdentityService(): Promise<MockIdentityService> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const kid = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const jwk = publicKeyToJwk(publicKey, kid);

  // Also stands in for the two /internal/users endpoints this batch's approve saga calls (Batch
  // 11) - a real Identity Service in production serves JWKS and /internal/* from the same
  // process, so one mock server covering both here mirrors that shape.
  const scenario: IdentityServiceScenario = { createUser: 'succeed' };
  const createdUsers: any[] = [];
  let nextId = 9001;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/internal/users/exists') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ exists: false }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/internal/users') {
      res.setHeader('Content-Type', 'application/json');
      if (scenario.createUser === 'fail') {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Simulated Identity Service failure' }));
        return;
      }
      const body = await readBody(req);
      const user = {
        id: nextId++,
        email: body.email || null,
        phone: body.phone || null,
        company_id: body.companyId,
        role: body.role,
        is_active: true,
        name: body.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createdUsers.push(user);
      res.statusCode = 201;
      res.end(JSON.stringify(user));
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock Identity Service');
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    scenario,
    createdUsers,
    signStaffToken: (payload, options) =>
      jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: options?.kid ?? kid, expiresIn: options?.expiresInSeconds ?? 15 * 60 }),
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** A second, unrelated keypair - for testing that a token signed by an impostor is correctly rejected. */
export function signWithWrongKey(payload: AccessTokenPayload): string {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: 'impostor-kid', expiresIn: '15m' });
}
