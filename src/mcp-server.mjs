#!/usr/bin/env node
// Minimal MCP server (JSON-RPC 2.0 over stdio, newline-delimited) exposing the mesh as tools:
//   agent_list, agent_send, agent_inbox
// The calling agent is identified by AGENT_ID (and AGENT_NAME / AGENT_ROLE) in the environment.
import readline from 'node:readline';
import { meshClient } from './client.mjs';
import { MESSAGE_TYPES } from './broker.mjs';

const ME = { id: process.env.AGENT_ID || 'agent', name: process.env.AGENT_NAME, role: process.env.AGENT_ROLE };
const mesh = meshClient();

export const TOOLS = [
  { name: 'agent_list', description: 'List the agents on the mesh, with how many unread messages each has.', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent_send', description: 'Send a message to another agent. Use type "pregunta" only when blocked, "entrega" when done, "pedido_revision" to ask for review.',
    inputSchema: { type: 'object', required: ['to', 'text'], properties: {
      to: { type: 'string' }, text: { type: 'string', maxLength: 120000 },
      type: { type: 'string', enum: MESSAGE_TYPES }, taskId: { type: 'string', pattern: '^task-\\d{8}-\\d{3,}$' },
      clientRequestId: { type: 'string', maxLength: 128, description: 'Stable id so retries do not duplicate the message.' } } } },
  { name: 'agent_inbox', description: 'Read and clear your unread messages.', inputSchema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 200 } } } },
];

export async function callTool(name, args = {}, client = mesh, me = ME) {
  await client.register(me);
  if (name === 'agent_list') return client.list();
  if (name === 'agent_send') return client.send({ ...args, from: me.id });
  if (name === 'agent_inbox') return client.inbox(me.id, args.max);
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32601 });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-mesh', version: '1.0.0' } };
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') {
    try {
      const out = await callTool(params.name, params.arguments);
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  }
  if (method === 'ping') return {};
  if (id === undefined) return undefined; // notifications need no reply
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    try {
      const result = await handle(msg);
      if (msg.id !== undefined && result !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
    } catch (e) {
      if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }) + '\n');
    }
  });
}
