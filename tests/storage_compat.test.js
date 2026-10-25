const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/storage.js', 'utf8');
const context = {
  window: {},
  structuredClone: global.structuredClone,
  console,
};
vm.createContext(context);
vm.runInContext(source, context);

const { LocalStorageAdapter, STORES } = context.window.TaskFlowStorage;
const adapter = new LocalStorageAdapter();
const dataFor = (stores) => Object.fromEntries(stores.map((name) => [name, []]));

const versionFive = {
  schemaVersion: 5,
  data: dataFor(STORES.filter((name) => name !== 'noteDrafts')),
};
assert.strictEqual(adapter.validateImport(versionFive), true, 'V5 backups must remain importable without noteDrafts');

const V7_STORES = ['captures','todos','calendarEvents','templates','reminders'];
const preV7Stores = STORES.filter((name) => !V7_STORES.includes(name));
const versionSix = { schemaVersion: 6, data: dataFor(preV7Stores) };
assert.strictEqual(adapter.validateImport(versionSix), true, 'V6 backups must remain importable without personal workspace stores');

const brokenVersionSix = {
  schemaVersion: 6,
  data: dataFor(preV7Stores.filter((name) => name !== 'noteDrafts')),
};
assert.throws(
  () => adapter.validateImport(brokenVersionSix),
  /noteDrafts/,
  'V6 backups must include the draft collection',
);

const versionSeven = { schemaVersion: 7, data: dataFor(STORES) };
assert.strictEqual(adapter.validateImport(versionSeven), true, 'V7 backup with all personal workspace stores must validate');
assert.throws(() => adapter.validateImport({schemaVersion:7,data:dataFor(STORES.filter((name)=>name!=='templates'))}),/templates/,'V7 backups must include templates');

(async () => {
  const mergeAdapter = new LocalStorageAdapter();
  const memory = Object.fromEntries(STORES.map((name) => [name, name === 'tasks' ? [{ id:'existing', title:'keep me' }] : []]));
  mergeAdapter.all = async (name) => structuredClone(memory[name]);
  mergeAdapter.putMany = async (name, values) => { memory[name].push(...structuredClone(values)); };
  const payload = {
    schemaVersion: 7,
    data: dataFor(STORES),
  };
  payload.data.tasks = [{ id:'existing', title:'must not overwrite' }, { id:'incoming', title:'new task' }];
  payload.data.captures = [{id:'expired',content:'old',status:'completed',completedAt:'2020-01-01T00:00:00Z'}];
  const report = await mergeAdapter.importData(payload);
  assert.deepStrictEqual(memory.tasks.map((task) => task.title), ['keep me', 'new task']);
  assert.strictEqual(report.tasks.added, 1);
  assert.strictEqual(report.tasks.skipped, 1);
  assert.strictEqual(memory.captures.length,0,'expired completed captures from backups must not be restored');
  assert.strictEqual(report.captures.skipped,1);
  console.log('storage backup compatibility tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
