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

const versionSix = { schemaVersion: 6, data: dataFor(STORES) };
assert.strictEqual(adapter.validateImport(versionSix), true, 'V6 backup with noteDrafts must validate');

const brokenVersionSix = {
  schemaVersion: 6,
  data: dataFor(STORES.filter((name) => name !== 'noteDrafts')),
};
assert.throws(
  () => adapter.validateImport(brokenVersionSix),
  /noteDrafts/,
  'V6 backups must include the draft collection',
);

(async () => {
  const mergeAdapter = new LocalStorageAdapter();
  const memory = Object.fromEntries(STORES.map((name) => [name, name === 'tasks' ? [{ id:'existing', title:'keep me' }] : []]));
  mergeAdapter.all = async (name) => structuredClone(memory[name]);
  mergeAdapter.putMany = async (name, values) => { memory[name].push(...structuredClone(values)); };
  const payload = {
    schemaVersion: 6,
    data: dataFor(STORES),
  };
  payload.data.tasks = [{ id:'existing', title:'must not overwrite' }, { id:'incoming', title:'new task' }];
  const report = await mergeAdapter.importData(payload);
  assert.deepStrictEqual(memory.tasks.map((task) => task.title), ['keep me', 'new task']);
  assert.strictEqual(report.tasks.added, 1);
  assert.strictEqual(report.tasks.skipped, 1);
  console.log('storage backup compatibility tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
