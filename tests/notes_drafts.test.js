const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async all(name) { return [...(this.values.get(name) || new Map()).values()].map((value) => structuredClone(value)); }
  async get(name, id) { return structuredClone((this.values.get(name) || new Map()).get(id)); }
  async put(name, value) { if (!this.values.has(name)) this.values.set(name, new Map()); this.values.get(name).set(value.id, structuredClone(value)); }
  async delete(name, id) { this.values.get(name)?.delete(id); }
}

const context = { window: {}, structuredClone, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, btoa, atob, escape, unescape, encodeURIComponent, decodeURIComponent };
vm.runInNewContext(fs.readFileSync('js/content-library.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('js/notes.js', 'utf8'), context);
const { NotesDraftStore, MemosNotesAdapter } = context.window.TaskFlowNotes;

(async () => {
  const storage = new MemoryStorage();
  const drafts = new NotesDraftStore(storage);
  await drafts.save({ source:'Local', noteId:'note-1', title:'newer', revision:2 });
  await drafts.save({ source:'Local', noteId:'note-1', title:'stale', revision:1 });
  const localDraft = await drafts.get('Local','note-1');
  assert.strictEqual(localDraft.title, 'newer', 'older async writes must not replace newer drafts');
  assert.strictEqual(localDraft.id, 'draft:Local:note-1', 'draft storage key must remain separate from the logical note id');
  assert.strictEqual(localDraft.noteId, 'note-1');

  await drafts.save({ source:'Memos', noteId:'note-1', title:'remote', revision:1 });
  await drafts.save({ source:'Local', noteId:'note-2', title:'other note', revision:1 });
  assert.strictEqual((await drafts.get('Memos','note-1')).title, 'remote');
  assert.strictEqual((await drafts.get('Local','note-2')).title, 'other note');
  assert.strictEqual((await drafts.list('Local')).length, 2, 'drafts should be isolated by source and note id');

  await drafts.delete('Local','note-1');
  assert.strictEqual(await drafts.get('Local','note-1'), undefined);
  assert.strictEqual((await drafts.get('Memos','note-1')).title, 'remote', 'deleting one source must not affect another');

  const adapter = new MemosNotesAdapter({ serverUrl:'https://memo.example.com', token:'test-token', apiBase:'v1' });
  const encoded = adapter.encode({ title:'复用提示词', category:'AI Engineering', contentType:'prompt', purpose:'用于摘要', sourceUrl:'https://example.com/source', pinned:true, content:'完整正文' });
  const decoded = adapter.decode({ name:'memo-1', content:encoded, createTime:'2026-10-24T00:00:00Z', updateTime:'2026-10-24T01:00:00Z' });
  assert.strictEqual(decoded.contentType, 'prompt');
  assert.strictEqual(decoded.purpose, '用于摘要');
  assert.strictEqual(decoded.sourceUrl, 'https://example.com/source');
  assert.strictEqual(decoded.pinned, true);
  assert.strictEqual(decoded.content, '完整正文');

  const legacyEncoded = `<!-- taskflow-note:v1 ${btoa(unescape(encodeURIComponent(JSON.stringify({ title:'旧远程笔记', category:'Personal' }))))} -->\n旧正文`;
  const legacyDecoded = adapter.decode({ name:'memo-legacy', content:legacyEncoded, createTime:'2026-10-24T00:00:00Z' });
  assert.strictEqual(legacyDecoded.contentType, 'note');
  assert.strictEqual(legacyDecoded.purpose, '');
  assert.strictEqual(legacyDecoded.content, '旧正文');
  console.log('Notes draft tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
