const assert = require('assert');
const fs = require('fs');
const app = fs.readFileSync('js/app.js','utf8');

['category-search','task-search','note-search'].forEach((id)=>assert(app.includes(`'${id}'`),`${id} must be covered by the IME guard`));
assert(app.includes("addEventListener('compositionstart'"),'search must listen for compositionstart');
assert(app.includes("addEventListener('compositionend'"),'search must listen for compositionend');
assert(app.includes('composingSearches.has(e.target.id)||e.isComposing'),'input must not rerender during IME composition');
console.log('IME search contract tests passed');
