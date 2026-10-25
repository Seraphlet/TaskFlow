const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');

for(const route of ['capture','todos','calendar','templates']){
  assert(app.includes(`navButton('${route}'`),`navigation contains ${route}`);
  assert(app.includes(`state.route === '${route}'`),`renderer contains ${route}`);
}
for(const store of ['captures','todos','calendarEvents','templates','reminders']){
  assert(app.includes(`'${store}'`)||app.includes(`.${store}`),`app uses ${store}`);
}
assert(app.includes('todo_from_${capture.id}'),'capture conversion uses deterministic todo id');
assert(app.includes("id=\"home-capture-form\""),'home includes quick capture');
assert(app.includes('dueReminders(state.data.reminders)'),'home/calendar expose due reminders');
assert(app.includes('data-template-variable'),'template variables are rendered');
assert(app.includes('fillTemplate(item.content,state.templateValues)'),'copy fills a cloned view instead of mutating source');
assert(html.includes('personal-workspace.js'),'domain helpers load before the app');
assert(html.includes('interaction-guards.js'),'pointer activation guard loads before the app');
assert(app.includes('data-nav-group="personal"'),'personal routes are grouped in an accordion');
assert(app.includes('aria-expanded="${personalOpen}"'),'accordion exposes its expanded state');
assert(app.includes('confirmEditorExit()'),'navigation and drawer close protect unsaved transient forms');
assert(app.includes('class="sidebar-navigation"'),'sidebar navigation has an independent scrolling region');
assert(app.includes('class="sidebar-footer"'),'quick capture and status card share a fixed sidebar footer');
assert(css.includes('.sidebar-navigation { flex: 1 1 auto; min-height: 0; overflow-y: auto;'),'desktop sidebar navigation consumes and scrolls within remaining height');
assert(css.includes('.sidebar-footer { flex: 0 0 auto;'),'sidebar footer does not shrink when navigation expands');
assert(app.includes("document.addEventListener('pointerdown'"),'pointer origin is recorded before delegated clicks');
assert(css.includes('@media (max-width: 560px)'),'mobile layout remains defined');
assert(css.includes('.template-workspace'),'template split workspace is styled');
console.log('Personal workspace UI contract tests passed');
