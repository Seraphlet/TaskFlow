const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { window:{}, URL };
vm.runInNewContext(fs.readFileSync('js/content-library.js', 'utf8'), context);
const { normalizeNote, searchNotes, tokenize, highlightHtml, safeSourceUrl } = context.window.TaskFlowContentLibrary;

const legacy = normalizeNote({ id:'legacy-1', title:'旧笔记', content:'仍然可以读取', category:'Personal' });
assert.strictEqual(legacy.id, 'legacy-1');
assert.strictEqual(legacy.contentType, 'note', 'old notes must default to the note type');
assert.strictEqual(legacy.purpose, '');
assert.strictEqual(legacy.sourceUrl, '');
assert.strictEqual(legacy.pinned, false);

const notes = [
  { id:'1', title:'代码审查提示词', content:'检查 JavaScript 安全性', purpose:'用于前端 review', category:'AI Engineering', contentType:'prompt', pinned:false, updatedAt:'2026-10-24T09:00:00Z' },
  { id:'2', title:'发布 SOP', content:'部署前先执行测试', purpose:'服务器发布指南', category:'Project', contentType:'sop', pinned:true, updatedAt:'2026-10-23T09:00:00Z' },
  { id:'3', title:'今日记录', content:'阅读 JavaScript 文档', category:'Learning', updatedAt:'2026-10-24T10:00:00Z' },
];

assert.deepStrictEqual(Array.from(tokenize(' 代码  review 代码 ')), ['代码','review']);
assert.deepStrictEqual(Array.from(searchNotes(notes, { query:'安全 发布' })).map((note) => note.id), ['2','1'], 'multiple keywords use OR matching and pinned results sort first');
assert.deepStrictEqual(Array.from(searchNotes(notes, { query:'JavaScript', contentType:'prompt', category:'AI Engineering' })).map((note) => note.id), ['1'], 'type, topic and keywords must combine');
assert.strictEqual(searchNotes(notes, { contentType:'note' }).length, 1, 'legacy notes participate in type filters');

const highlighted = highlightHtml('<script>JavaScript</script>', ['javascript']);
assert(!highlighted.includes('<script>'), 'highlighting must escape source HTML');
assert(highlighted.includes('<mark>JavaScript</mark>'));
assert.strictEqual(safeSourceUrl('https://example.com/a').startsWith('https://example.com/a'), true);
assert.throws(() => safeSourceUrl('javascript:alert(1)', true), /HTTP/);

console.log('Content library tests passed');
