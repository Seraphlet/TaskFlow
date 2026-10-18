const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key)
  };
}

const localStorage = storage();
const sessionStorage = storage();
let request;
const context = {
  window: {}, localStorage, sessionStorage, structuredClone, URLSearchParams,
  location: { protocol: 'https:', hostname: 'taskflow.example' },
  AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, modelId: 'deepseek-flash' }) };
  }
};
vm.runInNewContext(fs.readFileSync('js/radar.js', 'utf8'), context);

const { RadarCredentialStore, RemoteRadarProvider } = context.window.TaskFlowRadar;
const credentials = new RadarCredentialStore();
credentials.save({ tavilyApiKey: 'tvly-session-secret', deepseekApiKey: 'sk-session-secret', modelId: 'deepseek-flash', remember: false });
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), true);
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), false);

credentials.save({ tavilyApiKey: 'tvly-persistent-secret', deepseekApiKey: 'sk-persistent-secret', modelId: 'deepseek-v4.1-flash', remember: true });
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), true);
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), false);

credentials.useSessionOnly();
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), false);
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), true);

(async () => {
  await new RemoteRadarProvider({ tavilyApiKey: 'tvly-header-or-body-only', deepseekApiKey: 'sk-header-or-body-only', modelId: 'deepseek-flash' }).testConnection();
  assert.strictEqual(request.url, '/api/radar/test');
  assert.strictEqual(request.url.includes('tvly-header-or-body-only'), false);
  assert.strictEqual(request.url.includes('sk-header-or-body-only'), false);
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.credentials.tavilyApiKey, 'tvly-header-or-body-only');

  credentials.clear();
  const cleared = credentials.getCredentials();
  assert.strictEqual(cleared.tavilyApiKey, '');
  assert.strictEqual(cleared.deepseekApiKey, '');
  assert.strictEqual(localStorage.has('taskflow-radar-provider-config-v1'), false);
  console.log('Radar credential tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
