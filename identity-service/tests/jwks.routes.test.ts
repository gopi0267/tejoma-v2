import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { jwtKeyPair } from '../src/config/keys.js';

describe('GET /.well-known/jwks.json', () => {
  it('publishes the current signing key as a JWKS document', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].kid).toBe(jwtKeyPair.kid);
    expect(res.body.keys[0].kty).toBe('RSA');
    expect(res.body.keys[0].alg).toBe('RS256');
  });

  it('sets a cache-control header so consumers know it is safe to cache', async () => {
    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.headers['cache-control']).toContain('max-age');
  });
});
