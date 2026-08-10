/**
 * A real, minimal stand-in for Tenant Directory Service, used only by the approve saga tests. A
 * real HTTP server on a real ephemeral port - not a mock of fetch or of tenantDirectoryClient.ts's
 * functions themselves. Behavior is configurable per-test via the mutable `scenario` object, read
 * fresh on every request (the same pattern identity-service's
 * tests/platform-governance-login-messaging.test.ts already uses for its own mock server).
 */
import http from 'http';

export interface TenantDirectoryScenario {
  createCompany: 'succeed' | 'fail';
  deactivateCompany: 'succeed' | 'fail';
}

export interface MockTenantDirectory {
  url: string;
  scenario: TenantDirectoryScenario;
  createdCompanies: any[];
  deactivatedCompanyIds: number[];
  close: () => Promise<void>;
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

export async function startMockTenantDirectory(): Promise<MockTenantDirectory> {
  const scenario: TenantDirectoryScenario = { createCompany: 'succeed', deactivateCompany: 'succeed' };
  const createdCompanies: any[] = [];
  const deactivatedCompanyIds: number[] = [];
  let nextId = 5001;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url || '', 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/internal/companies') {
      if (scenario.createCompany === 'fail') {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Simulated Tenant Directory Service failure' }));
        return;
      }
      const body = await readBody(req);
      const company = {
        id: nextId++,
        name: body.name,
        industry: body.industry || 'Technology',
        plan: 'starter',
        seats_limit: 5,
        is_active: true,
        company_slug: `${String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nextId}`,
        logo_url: null,
        website: body.website || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createdCompanies.push(company);
      res.statusCode = 201;
      res.end(JSON.stringify(company));
      return;
    }

    if (req.method === 'PATCH' && /^\/internal\/companies\/\d+\/deactivate$/.test(url.pathname)) {
      const id = parseInt(url.pathname.split('/')[3], 10);
      if (scenario.deactivateCompany === 'fail') {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Simulated Tenant Directory Service failure' }));
        return;
      }
      deactivatedCompanyIds.push(id);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (req.method === 'GET' && /^\/internal\/companies\/\d+$/.test(url.pathname)) {
      const id = parseInt(url.pathname.split('/')[3], 10);
      const found = createdCompanies.find((c) => c.id === id);
      if (!found) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Company not found' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(found));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock Tenant Directory Service');

  return {
    url: `http://127.0.0.1:${address.port}`,
    scenario,
    createdCompanies,
    deactivatedCompanyIds,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
