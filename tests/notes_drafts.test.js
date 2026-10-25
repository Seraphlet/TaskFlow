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
  assert(encoded.endsWith('-->'), 'TaskFlow metadata must be the final block');
  assert(encoded.includes('\ncontentType: prompt\ncategory: ai-engineering\n'), 'metadata stores stable classification ids');
  assert.strictEqual((encoded.match(/<!-- taskflow:meta:v1/g)||[]).length, 1, 'one save must append exactly one metadata block');
  const decoded = adapter.decode({ name:'memo-1', content:encoded, createTime:'2026-10-24T00:00:00Z', updateTime:'2026-10-24T01:00:00Z' });
  assert.strictEqual(decoded.contentType, 'prompt');
  assert.strictEqual(decoded.purpose, '用于摘要');
  assert.strictEqual(decoded.sourceUrl, 'https://example.com/source');
  assert.strictEqual(decoded.pinned, true);
  assert.strictEqual(decoded.content, '完整正文');
  assert.strictEqual(decoded.categoryId, 'ai-engineering');
  assert(encoded.startsWith('完整正文\n\n<!-- taskflow:meta:v1'), 'title + body keeps the body as Memos-visible text');
  assert(encoded.includes('\ntitleOnly: false\n'));

  const titleOnlyEncoded = adapter.encode({ title:'只有标题', content:'', categoryId:'personal', category:'Personal', contentType:'note' });
  assert(titleOnlyEncoded.startsWith('只有标题\n\n<!-- taskflow:meta:v1'), 'title-only notes must expose the title to native Memos');
  assert(titleOnlyEncoded.includes('\ntitleOnly: true\n'));
  const titleOnlyDecoded = adapter.decode({ name:'memo-title-only', content:titleOnlyEncoded });
  assert.strictEqual(titleOnlyDecoded.title, '只有标题');
  assert.strictEqual(titleOnlyDecoded.content, '', 'the visible title must not become TaskFlow body content');
  const titleOnlySavedAgain = adapter.encode(titleOnlyDecoded);
  assert.strictEqual((titleOnlySavedAgain.match(/只有标题/g)||[]).length, 1, 'repeated title-only saves must not duplicate the visible title');
  assert.strictEqual((titleOnlySavedAgain.match(/<!-- taskflow:meta:v1/g)||[]).length, 1);

  const withBodyEncoded = adapter.encode({ ...titleOnlyDecoded, content:'后来补充的正文' });
  assert(withBodyEncoded.startsWith('后来补充的正文\n\n<!-- taskflow:meta:v1'), 'adding body text must stop mirroring the title');
  const withBodyDecoded = adapter.decode({ name:'memo-with-body', content:withBodyEncoded });
  assert.strictEqual(withBodyDecoded.title, '只有标题');
  assert.strictEqual(withBodyDecoded.content, '后来补充的正文');
  const bodyRemovedDecoded = adapter.decode({ name:'memo-body-removed', content:adapter.encode({ ...withBodyDecoded, content:'' }) });
  assert.strictEqual(bodyRemovedDecoded.title, '只有标题');
  assert.strictEqual(bodyRemovedDecoded.content, '', 'removing body text must restore title-only semantics');

  const bodyOnlyEncoded = adapter.encode({ title:'', content:'只有正文', categoryId:'personal', category:'Personal', contentType:'note' });
  const bodyOnlyDecoded = adapter.decode({ name:'memo-body-only', content:bodyOnlyEncoded });
  assert.strictEqual(bodyOnlyDecoded.title, '');
  assert.strictEqual(bodyOnlyDecoded.content, '只有正文');
  assert.throws(() => adapter.encode({ title:'  ', content:'\n', categoryId:'personal', contentType:'note' }), /标题和正文不能同时为空/);

  const markdown = '正文中的 --- 不变。\n\n```html\n<!-- ordinary comment -->\n```\n';
  const roundTrip = adapter.decode({ name:'memo-round-trip', content:adapter.encode({ content:markdown, categoryId:'personal', category:'Personal', contentType:'note' }) });
  assert.strictEqual(roundTrip.content, markdown, 'Markdown, comments and trailing newlines must survive metadata round trips');
  const savedAgain = adapter.encode(roundTrip);
  assert.strictEqual((savedAgain.match(/<!-- taskflow:meta:v1/g)||[]).length, 1, 'repeated edits must not duplicate metadata');
  const documented = adapter.decode({ name:'memo-documented', content:'历史正文。\n\n<!-- taskflow:meta:v1\ncontentType: note\ncategory: AI Engineering\n-->' });
  assert.strictEqual(documented.content, '历史正文。', 'the documented minimal metadata block must remain readable');
  assert.strictEqual(documented.categoryId, 'ai-engineering');
  assert.strictEqual(documented.category, 'AI Engineering');
  assert.strictEqual(adapter.decode({ name:'broken', content:'正文\n\n<!-- taskflow:meta:v1\ncontentType: note\ncategory: personal' }), null, 'damaged metadata must fail safely');
  assert.strictEqual(adapter.decode({ name:'duplicate', content:`${encoded}\n\n${encoded.slice(encoded.indexOf('<!-- taskflow:meta:v1'))}` }), null, 'duplicate metadata must fail safely without guessing what to delete');

  const legacyEncoded = `<!-- taskflow-note:v1 ${btoa(unescape(encodeURIComponent(JSON.stringify({ title:'旧远程笔记', category:'Personal' }))))} -->\n旧正文`;
  const legacyDecoded = adapter.decode({ name:'memo-legacy', content:legacyEncoded, createTime:'2026-10-24T00:00:00Z' });
  assert.strictEqual(legacyDecoded.contentType, 'note');
  assert.strictEqual(legacyDecoded.purpose, '');
  assert.strictEqual(legacyDecoded.content, '旧正文');
  console.log('Notes draft tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
