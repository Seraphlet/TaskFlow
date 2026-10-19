const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const app = fs.readFileSync('js/app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

for (const retiredHook of [
  'companyList', 'companyDetail', 'migrateLegacyWall', 'data-open-legacy-wall',
  'data-migrate-legacy', 'data-delete-company', 'data-delete-comment', 'company-search'
]) {
  assert.strictEqual(app.includes(retiredHook), false, `${retiredHook} should be removed from the application`);
}
for (const retiredClass of ['.company-grid', '.company-card', '.company-count', '.comment-list', '.comment-foot', '.comment-actions']) {
  assert.strictEqual(css.includes(retiredClass), false, `${retiredClass} should be removed from the stylesheet`);
}

const context = { window: {}, structuredClone };
vm.runInNewContext(fs.readFileSync('js/storage.js', 'utf8'), context);
const { STORES, ACTIVE_STORES } = context.window.TaskFlowStorage;
assert.strictEqual(ACTIVE_STORES.includes('companies'), false);
assert.strictEqual(ACTIVE_STORES.includes('comments'), false);
assert.strictEqual(STORES.includes('companies'), true, 'retired store must remain non-destructively compatible');
assert.strictEqual(STORES.includes('comments'), true, 'retired store must remain non-destructively compatible');

console.log('Legacy company wall removal tests passed');
