(() => {
const DB_NAME = 'taskflow-workspace-v1';
const DB_VERSION = 6;
const ACTIVE_STORES = ['tasks', 'activity', 'handoffs', 'team', 'notes', 'noteDrafts', 'radar', 'radarProfiles', 'radarBatches', 'radarHistory'];
// Keep the retired stores in the database/backup contract so an upgrade never
// deletes historical browser data. The application no longer loads or exposes
// them in its UI.
const LEGACY_STORES = ['companies', 'comments'];
const STORES = [...ACTIVE_STORES, ...LEGACY_STORES];

const clone = (value) => structuredClone(value);

class LocalStorageAdapter {
  constructor() { this.dbPromise = null; }

  async init() {
    if (!this.dbPromise) {
      if (!('indexedDB' in window)) throw new Error('当前浏览器或 file:// 环境不支持 IndexedDB。本应用不会在无法持久化时继续静默保存，请改用最新版 Chrome / Edge 或受信任的静态部署。');
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          STORES.forEach((name) => {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          });
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onblocked = () => reject(new Error('本地数据库升级被其他已打开的 TaskFlow 页面阻塞。请关闭其他 TaskFlow 标签页后刷新当前页面。'));
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  async store(name, mode = 'readonly') {
    if (!STORES.includes(name)) throw new Error(`未知数据集合：${name}`);
    const db = await this.init();
    return db.transaction(name, mode).objectStore(name);
  }

  request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async all(name) { return this.request((await this.store(name)).getAll()); }
  async get(name, id) { return this.request((await this.store(name)).get(id)); }
  async put(name, value) { return this.request((await this.store(name, 'readwrite')).put(clone(value))); }
  async delete(name, id) { return this.request((await this.store(name, 'readwrite')).delete(id)); }

  async putMany(name, values) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      values.forEach((item) => store.put(clone(item)));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteWhere(name, predicate) {
    const items = await this.all(name);
    const ids = items.filter(predicate).map((item) => item.id);
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve(ids.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async exportData() {
    const entries = await Promise.all(STORES.map(async (name) => [name, await this.all(name)]));
    return { schemaVersion: 6, exportedAt: new Date().toISOString(), data: Object.fromEntries(entries) };
  }

  validateImport(payload) {
    if (!payload || ![1, 2, 3, 4, 5, 6].includes(payload.schemaVersion) || !payload.data || typeof payload.data !== 'object') {
      throw new Error('备份文件版本或结构无效');
    }
    for (const name of STORES) {
      const optionalLegacyStore =
        (name === 'notes' && payload.schemaVersion === 1) ||
        (name === 'noteDrafts' && payload.schemaVersion < 6) ||
        (name === 'radar' && payload.schemaVersion < 3) ||
        (['radarProfiles', 'radarBatches'].includes(name) && payload.schemaVersion < 4) ||
        (name === 'radarHistory' && payload.schemaVersion < 5);
      if (optionalLegacyStore && payload.data[name] == null) continue;
      if (!Array.isArray(payload.data[name])) throw new Error(`备份缺少有效的 ${name} 集合`);
      if (payload.data[name].some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
        throw new Error(`${name} 中存在无效记录`);
      }
    }
    return true;
  }

  async importData(payload) {
    this.validateImport(payload);
    const report = {};
    for (const name of STORES) {
      const incoming = payload.data[name] || [];
      const existing = new Set((await this.all(name)).map((item) => item.id));
      const additions = incoming.filter((item) => !existing.has(item.id));
      if (additions.length) await this.putMany(name, additions);
      report[name] = { added: additions.length, skipped: incoming.length - additions.length };
    }
    return report;
  }
}

// Future adapters must implement the same methods as LocalStorageAdapter.
class RemoteStorageAdapter {
  constructor() { throw new Error('Remote storage is not configured'); }
}

window.TaskFlowStorage = { LocalStorageAdapter, RemoteStorageAdapter, STORES, ACTIVE_STORES };
})();
