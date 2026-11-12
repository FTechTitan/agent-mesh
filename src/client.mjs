// Tiny HTTP client for the broker (used by the MCP server and the demo).
export function meshClient(base = process.env.MESH_URL || 'http://127.0.0.1:8750', token = process.env.MESH_TOKEN || '') {
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  };
  return {
    register: (agent) => call('POST', '/agents', agent),
    list: () => call('GET', '/agents'),
    send: (msg) => call('POST', '/send', msg),
    inbox: (agent, max = 50) => call('GET', `/inbox?agent=${encodeURIComponent(agent)}&max=${max}`),
    audit: (taskId) => call('GET', `/audit${taskId ? `?taskId=${taskId}` : ''}`),
  };
}
