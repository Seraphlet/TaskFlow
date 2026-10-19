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
vm.runInNewContext(fs.readFileSync('js/notes.js', 'utf8'), context);
const { NotesDraftStore } = context.window.TaskFlowNotes;

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
  console.log('Notes draft tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
