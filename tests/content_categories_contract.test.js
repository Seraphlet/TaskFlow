const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const storage = fs.readFileSync('js/storage.js', 'utf8');

assert(html.indexOf('js/classifications.js') < html.indexOf('js/content-library.js'), 'classification config must load before content normalization');
assert(html.indexOf('js/content-library.js') < html.indexOf('js/notes.js'), 'content helpers must load before Notes adapters');
assert(html.indexOf('js/notes.js') < html.indexOf('js/app.js'), 'Notes adapters must load before the application');
['data-new-prompt','data-content-type','data-quick-tag','data-expand-content','data-copy-content','data-edit-content'].forEach((token) => {
  assert(app.includes(token), `Categories UI is missing ${token}`);
});
assert(app.includes("safeSourceUrl(fd.get('sourceUrl'), true)"), 'saved source links must be validated');
assert(!storage.includes("'prompts'"), 'prompts must not create a second IndexedDB data model');
['data-classification-add','data-classification-edit','data-classification-delete'].forEach((token) => assert(app.includes(token), `Settings classification UI is missing ${token}`));

console.log('Content categories contract tests passed');
