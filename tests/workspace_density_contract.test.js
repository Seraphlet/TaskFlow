const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('js/app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

['tasks-page','notes-page','library-page','radar-page','task-detail-page','settings-page'].forEach((name) => {
  assert(app.includes(name), `work page class missing: ${name}`);
});
assert(app.includes('note-footer-properties'), 'note type and topic controls must live in the footer');
assert(app.includes('<input type="hidden" name="purpose"'), 'hidden purpose must survive note edits');
assert(app.includes('<input type="hidden" name="sourceUrl"'), 'hidden source URL must survive note edits');
assert(app.includes('<input type="hidden" name="pinned"'), 'hidden pinned state must survive note edits');
assert(!app.includes('class="note-meta-grid"'), 'the note canvas must not render the expanded metadata form');
assert(app.includes('radar-scope-details'), 'Radar long direction guidance must be collapsible');
assert(css.includes('.notes-workspace { height: calc(100vh - 205px);'), 'desktop note canvas should consume the available viewport');
assert(css.includes('grid-template-columns: 272px minmax(0, 1fr)'), 'desktop note list should be compact');

console.log('Workspace density contract tests passed');
