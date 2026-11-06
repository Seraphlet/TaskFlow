const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const indexHtml = fs.readFileSync('index.html', 'utf8');
for (const asset of ['styles.css', 'storage.js', 'notifications.js', 'notes.js', 'radar.js', 'app.js']) {
  assert.match(indexHtml, new RegExp(`${asset.replace('.', '\\.') }\\?v=`), `${asset} should use a cache-busting version`);
}
const appSource = fs.readFileSync('js/app.js', 'utf8');
assert.match(appSource, /Array\.isArray\(state\.data\.radarHistory\)/, 'stale schemas should fall back to an empty Radar history');

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
let requestTimeout;
const context = {
  window: {}, localStorage, sessionStorage, structuredClone, URLSearchParams,
  location: { protocol: 'https:', hostname: 'taskflow.example' },
  AbortController, setTimeout: (callback, delay) => { requestTimeout = delay; return setTimeout(callback, delay); }, clearTimeout,
  fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, modelId: 'deepseek-flash' }) };
  }
};
vm.runInNewContext(fs.readFileSync('js/radar.js', 'utf8'), context);

const { RadarCredentialStore, RemoteRadarProvider, DEFAULT_DAILY_LIMIT } = context.window.TaskFlowRadar;
const credentials = new RadarCredentialStore();
credentials.save({ tavilyApiKey: 'tvly-session-secret', deepseekApiKey: 'sk-session-secret', modelId: 'deepseek-flash', remember: false });
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), true);
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), false);
assert.strictEqual(credentials.getConfig().dailyLimit, DEFAULT_DAILY_LIMIT);

credentials.save({ tavilyApiKey: 'tvly-persistent-secret', deepseekApiKey: 'sk-persistent-secret', modelId: 'deepseek-v4.1-flash', remember: true, dailyLimit: 7 });
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), true);
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), false);
assert.strictEqual(credentials.getConfig().dailyLimit, 7);
assert.throws(() => credentials.save({ tavilyApiKey:'tvly-x', deepseekApiKey:'deepseek-x', modelId:'deepseek-flash', remember:false, dailyLimit:0 }), /1–50/);

credentials.save({ tavilyApiKey:'', deepseekApiKey:'sk-deepseek-only', modelId:'deepseek-flash', remember:false, dailyLimit:3 });
assert.strictEqual(credentials.getCredentials().tavilyApiKey, '');
assert.strictEqual(credentials.getCredentials().deepseekApiKey, 'sk-deepseek-only');

credentials.useSessionOnly();
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), false);
assert.strictEqual(sessionStorage.has('taskflow-tavily-api-key-v1'), false);
assert.strictEqual(sessionStorage.has('taskflow-deepseek-api-key-v1'), true);

credentials.rememberSessionDraft({ tavilyApiKey: 'tvly-typed-draft', deepseekApiKey: 'sk-typed-draft' });
assert.strictEqual(credentials.getCredentials().tavilyApiKey, 'tvly-typed-draft');
assert.strictEqual(credentials.getCredentials().deepseekApiKey, 'sk-typed-draft');
assert.strictEqual(localStorage.has('taskflow-tavily-api-key-v1'), false);

(async () => {
  await new RemoteRadarProvider({ tavilyApiKey: 'tvly-header-or-body-only', deepseekApiKey: 'sk-header-or-body-only', modelId: 'deepseek-flash' }).testConnection();
  assert.strictEqual(request.url, '/api/radar/test');
  assert.strictEqual(request.url.includes('tvly-header-or-body-only'), false);
  assert.strictEqual(request.url.includes('sk-header-or-body-only'), false);
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.credentials.tavilyApiKey, 'tvly-header-or-body-only');

  await new RemoteRadarProvider({ tavilyApiKey: 'tvly-header-or-body-only', deepseekApiKey: 'sk-header-or-body-only', modelId: 'deepseek-flash' }).getNextBatch({ id:'p', name:'P' }, []);
  assert.strictEqual(request.url, '/api/radar/explore');
  assert.strictEqual(requestTimeout, 240000);

  await new RemoteRadarProvider({ tavilyApiKey: '', deepseekApiKey: 'sk-header-or-body-only', modelId: 'deepseek-flash' }).generateLife({ birthYear:1988, worldId:'harbor-renewal', worldLabel:'潮港' });
  assert.strictEqual(request.url, '/api/life/generate');
  assert.strictEqual(request.url.includes('sk-header-or-body-only'), false);
  assert.strictEqual(requestTimeout, 240000);

  const overtimeProvider = new RemoteRadarProvider({ tavilyApiKey:'', deepseekApiKey:'sk-header-or-body-only', modelId:'deepseek-flash' });
  await overtimeProvider.analyzeOvertime({ current:{ hours:1 } });
  assert.strictEqual(request.url, '/api/radar/overtime/analyze');
  assert.strictEqual(requestTimeout, 60000);

  context.fetch = async () => ({ ok:false, status:404, text:async()=>JSON.stringify({ detail:'Not Found' }) });
  await assert.rejects(() => overtimeProvider.analyzeOvertime({}), /AI 分析接口不存在（HTTP 404）/);
  context.fetch = async () => { const error=new Error('aborted');error.name='AbortError';throw error; };
  await assert.rejects(() => overtimeProvider.analyzeOvertime({}), /AI 分析请求超时/);

  credentials.clear();
  const cleared = credentials.getCredentials();
  assert.strictEqual(cleared.tavilyApiKey, '');
  assert.strictEqual(cleared.deepseekApiKey, '');
  assert.strictEqual(localStorage.has('taskflow-radar-provider-config-v1'), false);
  console.log('Radar credential tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
