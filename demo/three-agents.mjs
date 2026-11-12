// Three scripted agents (no LLM needed) that ask each other for work and review it:
//   planner -> coder -> reviewer -> (rejects once) -> coder -> reviewer -> planner
// Run: node demo/three-agents.mjs
import { Broker } from '../src/broker.mjs';
import { createServer } from '../src/broker-server.mjs';
import { meshClient } from '../src/client.mjs';

const server = createServer({ broker: new Broker(), token: '' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const mesh = meshClient(`http://127.0.0.1:${server.address().port}`, '');
const TASK = 'task-20261111-001';
const say = (who, line) => console.log(`${who.padEnd(9)}│ ${line}`);

const agents = ['planner', 'coder', 'reviewer'];
for (const id of agents) await mesh.register({ id, role: id });
say('mesh', `agents online: ${(await mesh.list()).map((a) => a.id).join(', ')}`);

await mesh.send({ from: 'planner', to: 'coder', type: 'pregunta', taskId: TASK, clientRequestId: 'p1', text: 'Implement slugify(title) and send it back for review.' });
say('planner', '→ coder: implement slugify(title)');

let attempt = 0;
const behaviors = {
  async coder(m) {
    attempt += 1;
    const code = attempt === 1 ? 'const slugify = (s) => s.toLowerCase().replace(/ /g, "-");'
      : 'const slugify = (s) => s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");';
    say('coder', `→ reviewer: attempt ${attempt}`);
    await mesh.send({ from: 'coder', to: 'reviewer', type: 'pedido_revision', taskId: TASK, text: code });
  },
  async reviewer(m) {
    if (m.type === 'pedido_revision') {
      const ok = m.text.includes('normalize');
      say('reviewer', ok ? '→ planner: approved' : '→ coder: rejected (accents and punctuation are not handled)');
      await mesh.send(ok ? { from: 'reviewer', to: 'planner', type: 'entrega', taskId: TASK, text: `Approved: ${m.text}` }
        : { from: 'reviewer', to: 'coder', type: 'respuesta', taskId: TASK, text: 'Rejected: "Canción de Año Nuevo!" must become "cancion-de-ano-nuevo".' });
    }
  },
  async planner(m) { if (m.type === 'entrega') { say('planner', `received: ${m.text.slice(0, 60)}…`); return 'done'; } },
};
// For `coder`, any message (initial request or a rejection) triggers (re)implementation.
let finished = false;
for (let tick = 0; tick < 20 && !finished; tick++) {
  for (const id of agents) {
    for (const m of await mesh.inbox(id)) if ((await behaviors[id](m)) === 'done') finished = true;
  }
}
const trail = await mesh.audit(TASK);
console.log(`\naudit trail for ${TASK}: ${trail.map((m) => `${m.from}→${m.to}(${m.type})`).join('  ')}`);
server.close();
process.exit(finished ? 0 : 1);
