import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../src/broker.mjs';
import { createServer } from '../src/broker-server.mjs';
import { meshClient } from '../src/client.mjs';
import { callTool, TOOLS } from '../src/mcp-server.mjs';

const mk = () => { const b = new Broker(); ['a', 'b'].forEach((id) => b.register({ id })); return b; };

test('send/receive delivers once and drains the inbox', () => {
  const b = mk(); b.send({ from: 'a', to: 'b', text: 'hola', type: 'entrega' });
  assert.equal(b.receive('b').length, 1);
  assert.equal(b.receive('b').length, 0);
});
test('clientRequestId makes retries idempotent', () => {
  const b = mk();
  const r1 = b.send({ from: 'a', to: 'b', text: 'x', clientRequestId: 'k' });
  const r2 = b.send({ from: 'a', to: 'b', text: 'x', clientRequestId: 'k' });
  assert.equal(r2.duplicate, true); assert.equal(r2.messageId, r1.messageId); assert.equal(b.receive('b').length, 1);
});
test('validation: unknown agents, self-send, bad type, bad task id, empty text', () => {
  const b = mk();
  assert.throws(() => b.send({ from: 'a', to: 'zz', text: 'x' }), /unknown recipient/);
  assert.throws(() => b.send({ from: 'a', to: 'a', text: 'x' }), /itself/);
  assert.throws(() => b.send({ from: 'a', to: 'b', text: 'x', type: 'nope' }), /type must be/);
  assert.throws(() => b.send({ from: 'a', to: 'b', text: 'x', taskId: 'T-1' }), /taskId/);
  assert.throws(() => b.send({ from: 'a', to: 'b', text: '  ' }), /text is required/);
});
test('audit keeps messages after they are read and filters by task', () => {
  const b = mk();
  b.send({ from: 'a', to: 'b', text: '1', taskId: 'task-20261111-001' }); b.send({ from: 'b', to: 'a', text: '2' });
  b.receive('b');
  assert.equal(b.audit().length, 2); assert.equal(b.audit({ taskId: 'task-20261111-001' }).length, 1);
});
test('HTTP server enforces the bearer token', async () => {
  const s = createServer({ token: 'secret-token' });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  assert.equal((await fetch(`${base}/agents`)).status, 401);
  assert.equal((await fetch(`${base}/agents`, { headers: { authorization: 'Bearer wrong-token!' } })).status, 401);
  assert.equal((await fetch(`${base}/agents`, { headers: { authorization: 'Bearer secret-token' } })).status, 200);
  s.close();
});
test('MCP tools: list/send/inbox through the HTTP client', async () => {
  const s = createServer({ token: '' }); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const c = meshClient(`http://127.0.0.1:${s.address().port}`, '');
  await c.register({ id: 'bob' });
  const alice = { id: 'alice' };
  await callTool('agent_send', { to: 'bob', text: 'review this', type: 'pedido_revision' }, c, alice);
  const got = await c.inbox('bob');
  assert.equal(got[0].from, 'alice'); assert.equal(got[0].type, 'pedido_revision');
  assert.equal(TOOLS.length, 3);
  await assert.rejects(callTool('nope', {}, c, alice), /unknown tool/);
  s.close();
});
