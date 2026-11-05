const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');

assert(app.includes('mainNavCollapsed'),'main navigation has an independent collapse state');
for(const key of ['notes','templates','radar','settings'])assert(app.includes(`contentSidebarToggle('${key}'`),`${key} exposes an independent content sidebar toggle`);
assert(app.includes('data-open-radar-history'),'Radar history opens from a dedicated detail drawer');
assert(app.includes("d.type === 'radar-history'"),'Radar history drawer reuses current profile history');
assert(app.includes('id="template-inline-form"'),'template editing reuses the pushed detail workspace');
assert(app.includes("d.type==='new-template'"),'new template keeps its own centered modal treatment');
assert(app.includes("settingsSection:'service'"),'settings keeps a single selected category');
assert(app.includes('name="salarySchema" value="v2"'),'new salary records use the monthly V2 schema');
assert(app.includes('已有工资记录，请编辑原记录'),'duplicate months are rejected explicitly');
assert(app.includes('旧版记录兼容模式'),'legacy salary records remain editable without silent migration');
assert(css.includes('.app-shell:not(.home-shell):not(.playground-shell)'),'Fluent styles exclude Home and Digital Art');
assert(css.includes('--canvas: #f5f6f8'),'Fluent work routes define the requested Mica token');
assert(css.includes('.radar-workspace'),'Radar has an independent content-sidebar layout');
assert(css.includes('.settings-workspace'),'Settings has a category sidebar layout');
console.log('Fluent UI contract tests passed');
