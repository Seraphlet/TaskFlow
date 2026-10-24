(() => {
  const CONFIG_KEY = 'taskflow-notes-config-v1';
  const TOKEN_KEY = 'taskflow-memos-token-v1';
  const MARKER = '<!-- taskflow-note:v1 ';
  const normalizeNote = window.TaskFlowContentLibrary?.normalizeNote || ((note) => ({ ...note, contentType:note.contentType || 'note', purpose:note.purpose || '', sourceUrl:note.sourceUrl || '', pinned:Boolean(note.pinned) }));

  const toBase64 = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  const fromBase64 = (value) => JSON.parse(decodeURIComponent(escape(atob(value))));
  const timeValue = (value) => {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    if (value.seconds) return new Date(Number(value.seconds) * 1000).toISOString();
    return new Date().toISOString();
  };

  class LocalNotesAdapter {
    constructor(storage) { this.storage = storage; this.mode = 'Local'; }
    async list() { return (await this.storage.all('notes')).map(normalizeNote); }
    async get(id) { const note = await this.storage.get('notes', id); return note ? normalizeNote(note) : note; }
    async create(note) { const value=normalizeNote(note); await this.storage.put('notes', value); return value; }
    async update(note) { const value=normalizeNote(note); await this.storage.put('notes', value); return value; }
    async delete(id) { return this.storage.delete('notes', id); }
  }

  class NotesDraftStore {
    constructor(storage) { this.storage = storage; this.queues = new Map(); }
    key(source, noteId) { return `draft:${source}:${noteId}`; }
    async get(source, noteId) { return this.storage.get('noteDrafts', this.key(source, noteId)); }
    async list(source) { return (await this.storage.all('noteDrafts')).filter((draft) => draft.source === source); }
    async save(draft) {
      const id = this.key(draft.source, draft.noteId);
      const write = async () => {
        const current = await this.storage.get('noteDrafts', id);
        if (current && Number(current.revision || 0) > Number(draft.revision || 0)) return current;
        const value = { ...structuredClone(draft), id };
        await this.storage.put('noteDrafts', value);
        return value;
      };
      const queued = (this.queues.get(id) || Promise.resolve()).then(() => (
        typeof navigator !== 'undefined' && navigator.locks
          ? navigator.locks.request(`taskflow:${id}`, write)
          : write()
      ));
      this.queues.set(id, queued.catch(() => {}));
      return queued;
    }
    async delete(source, noteId) { return this.storage.delete('noteDrafts', this.key(source, noteId)); }
  }

  class NotesCredentialStore {
    getConfig() {
      try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { mode: 'Local', apiBase: 'auto', remember: false }; }
      catch { return { mode: 'Local', apiBase: 'auto', remember: false }; }
    }
    getToken() { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; }
    saveConnection({ serverUrl, apiBase, token, remember }) {
      const config = { mode: 'Memos', serverUrl, apiBase, remember: Boolean(remember), connectedAt: new Date().toISOString() };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
      return config;
    }
    useLocal() { const old = this.getConfig(); localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...old, mode: 'Local' })); }
    clear() { localStorage.removeItem(CONFIG_KEY); sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); }
  }

  class MemosNotesAdapter {
    constructor({ serverUrl, token, apiBase = 'auto' }) {
      this.serverUrl = MemosNotesAdapter.normalizeServer(serverUrl);
      this.token = token;
      this.apiBase = apiBase;
      this.mode = 'Memos';
    }

    static normalizeServer(value) {
      let url;
      try { url = new URL(String(value || '').trim()); } catch { throw new Error('请输入有效的 Memos Server URL'); }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Memos 地址必须使用 HTTPS；HTTP 仅允许 localhost 本地测试');
      // Users often paste a settings/profile page. The API is rooted at the
      // instance origin, so fragments, queries and UI routes must not leak into it.
      return url.origin;
    }

    headers(json = false) {
      if (!this.token) throw new Error('缺少 Memos Access Token，请重新连接');
      return { Authorization: `Bearer ${this.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
    }

    async fetch(path, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${this.serverUrl}${path}`, { ...options, headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) }, signal: controller.signal });
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        if (!response.ok) {
          const detail = body?.message || body?.error || (typeof body === 'string' ? body.slice(0, 180) : '');
          const error = new Error(`Memos 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
          error.status = response.status; throw error;
        }
        return body;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Memos 请求超时，请检查服务器地址和网络');
        if (error instanceof TypeError) throw new Error('无法连接 Memos；浏览器已阻止跨域请求。file:// 会发送 Origin: null，Memos / 反向代理必须显式允许该来源和 Authorization 请求头');
        throw error;
      } finally { clearTimeout(timer); }
    }

    async testConnection() {
      const bases = this.apiBase === 'auto' ? ['/api', '/api/v1'] : [this.apiBase];
      let lastError;
      for (const base of bases) {
        try { await this.fetch(`${base}/memos?pageSize=1`); this.apiBase = base; return { apiBase: base }; }
        catch (error) { lastError = error; if (error.status && error.status !== 404) break; }
      }
      throw lastError || new Error('无法识别该 Memos 实例的 API 版本');
    }

    encode(note) {
      const normalized = normalizeNote(note);
      const metadata = toBase64({ title:normalized.title || '', category:normalized.category || (normalized.companyName ? 'Company' : 'Personal'), contentType:normalized.contentType, purpose:normalized.purpose, sourceUrl:normalized.sourceUrl, pinned:normalized.pinned });
      return `${MARKER}${metadata} -->\n${normalized.content}`;
    }

    decode(memo) {
      const content = String(memo.content || '');
      const match = content.match(/^<!-- taskflow-note:v1 ([A-Za-z0-9+/=]+) -->\n?/);
      if (!match) return null;
      try {
        const meta = fromBase64(match[1]);
        return normalizeNote({ id:memo.name, remoteId:memo.name, source:'Memos', title:meta.title || '', category:meta.category || (meta.companyName ? 'Company' : 'Personal'), contentType:meta.contentType, purpose:meta.purpose, sourceUrl:meta.sourceUrl, pinned:meta.pinned, content:content.slice(match[0].length), createdAt:timeValue(memo.createTime || memo.create_time), updatedAt:timeValue(memo.updateTime || memo.update_time) });
      } catch { return null; }
    }

    async list() {
      const result = []; let token = '';
      do {
        const query = new URLSearchParams({ pageSize: '100' }); if (token) query.set('pageToken', token);
        const body = await this.fetch(`${this.apiBase}/memos?${query}`);
        (body?.memos || []).forEach((memo) => { const note = this.decode(memo); if (note) result.push(note); });
        token = body?.nextPageToken || body?.next_page_token || '';
      } while (token);
      return result;
    }
    async get(id) { const memo = await this.fetch(`${this.apiBase}/${id}`); const note = this.decode(memo); if (!note) throw new Error('该远端 Memo 不属于 TaskFlow Notes 管理范围'); return note; }
    async create(note) { const memo = await this.fetch(`${this.apiBase}/memos`, { method: 'POST', body: JSON.stringify({ content: this.encode(note), visibility: 'PRIVATE' }) }); return this.decode(memo); }
    async update(note) { if (!String(note.id).startsWith('memos/')) throw new Error('拒绝修改非 TaskFlow 管理的远端 Memo'); const memo = await this.fetch(`${this.apiBase}/${note.id}?updateMask=content`, { method: 'PATCH', body: JSON.stringify({ name: note.id, content: this.encode(note) }) }); return this.decode(memo); }
    async delete(id) { if (!String(id).startsWith('memos/')) throw new Error('拒绝删除非 TaskFlow 管理的远端 Memo'); await this.fetch(`${this.apiBase}/${id}`, { method: 'DELETE' }); }
  }

  window.TaskFlowNotes = { LocalNotesAdapter, MemosNotesAdapter, NotesCredentialStore, NotesDraftStore };
})();
