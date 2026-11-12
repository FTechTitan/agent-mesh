// agent-mesh broker: registry + per-agent inbox. Pure logic, no I/O, so it is trivial to test.
import { randomUUID } from 'node:crypto';

export const MESSAGE_TYPES = ['pregunta', 'respuesta', 'entrega', 'pedido_revision', 'aviso', 'decision'];
const MAX_TEXT = 120_000;

export class Broker {
  #agents = new Map();      // id -> { id, name, role, registeredAt, lastSeen }
  #inbox = new Map();       // id -> message[]
  #seen = new Map();        // `${from}|${clientRequestId}` -> messageId  (idempotent retries)
  #log = [];                // full audit trail

  register({ id, name, role = '' }) {
    if (!id || !/^[\w.:-]{1,64}$/.test(id)) throw httpError(400, 'invalid agent id');
    const now = new Date().toISOString();
    const prev = this.#agents.get(id);
    this.#agents.set(id, { id, name: name || id, role, registeredAt: prev?.registeredAt ?? now, lastSeen: now });
    if (!this.#inbox.has(id)) this.#inbox.set(id, []);
    return this.#agents.get(id);
  }

  list() {
    return [...this.#agents.values()].map((a) => ({ ...a, pending: this.#inbox.get(a.id).length }));
  }

  send({ from, to, text, type = 'aviso', taskId = null, clientRequestId = null }) {
    if (!this.#agents.has(from)) throw httpError(404, `unknown sender ${from}`);
    if (!this.#agents.has(to)) throw httpError(404, `unknown recipient ${to}`);
    if (from === to) throw httpError(400, 'an agent cannot message itself');
    if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'text is required');
    if (text.length > MAX_TEXT) throw httpError(400, `text exceeds ${MAX_TEXT} chars`);
    if (!MESSAGE_TYPES.includes(type)) throw httpError(400, `type must be one of ${MESSAGE_TYPES.join(', ')}`);
    if (taskId !== null && !/^task-\d{8}-\d{3,}$/.test(taskId)) throw httpError(400, 'taskId must look like task-YYYYMMDD-NNN');
    const dedupe = clientRequestId ? `${from}|${clientRequestId}` : null;
    if (dedupe && this.#seen.has(dedupe)) return { messageId: this.#seen.get(dedupe), duplicate: true };
    const msg = { id: randomUUID(), from, to, type, taskId, text: text.trim(), sentAt: new Date().toISOString() };
    this.#inbox.get(to).push(msg);
    this.#log.push(msg);
    if (dedupe) this.#seen.set(dedupe, msg.id);
    this.#agents.get(from).lastSeen = msg.sentAt;
    return { messageId: msg.id, duplicate: false };
  }

  // Reading drains the inbox (at-most-once delivery); the audit log keeps everything.
  receive(id, { max = 50 } = {}) {
    const box = this.#inbox.get(id);
    if (!box) throw httpError(404, `unknown agent ${id}`);
    this.#agents.get(id).lastSeen = new Date().toISOString();
    return box.splice(0, max);
  }

  audit({ taskId } = {}) {
    return taskId ? this.#log.filter((m) => m.taskId === taskId) : [...this.#log];
  }
}

export const httpError = (status, message) => Object.assign(new Error(message), { status });
