#!/usr/bin/env node
// HTTP front for the broker. Localhost by default; set MESH_TOKEN to require `Authorization: Bearer <token>`.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Broker } from './broker.mjs';

export function createServer({ broker = new Broker(), token = process.env.MESH_TOKEN || '' } = {}) {
  const ok = (given) => {
    const a = Buffer.from(given), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (token && !ok((req.headers.authorization || '').replace(/^Bearer /i, ''))) return send(401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) return send(413, { error: 'too large' }); }
        body = raw ? JSON.parse(raw) : {};
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/agents') return send(200, broker.list());
      if (req.method === 'POST' && url.pathname === '/agents') return send(200, broker.register(body));
      if (req.method === 'POST' && url.pathname === '/send') return send(200, broker.send(body));
      if (req.method === 'GET' && url.pathname === '/inbox') return send(200, broker.receive(url.searchParams.get('agent'), { max: Number(url.searchParams.get('max')) || 50 }));
      if (req.method === 'GET' && url.pathname === '/audit') return send(200, broker.audit({ taskId: url.searchParams.get('taskId') || undefined }));
      send(404, { error: 'not found' });
    } catch (e) {
      send(e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.status ? e.message : 'bad request' });
    }
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8750);
  createServer().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`agent-mesh broker on :${port}`));
}
