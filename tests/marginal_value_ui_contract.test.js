const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const radar=fs.readFileSync('js/radar.js','utf8');

assert(app.includes("navButton('labor-life','◒','边际价值')"),'the existing route is renamed without changing its internal id');
assert(app.includes("'边际价值','每一份额外付出，究竟值得多少？'"),'the page shell uses the new product name and subtitle');
assert(app.includes('home-focus home-focus-capture'),'quick capture occupies the former focus grid area');
assert(app.includes('home-capture home-capture-focus'),'task focus occupies the former capture grid area');
assert(app.includes('home-date')&&app.includes('home-actions'),'date and quick actions remain present');
assert(app.includes('home-todos home-calendar-card" data-home-card="calendar"'),'calendar events occupy the former today-todo grid area');
assert(app.includes('home-agenda home-actions-card" data-home-card="actions"'),'quick actions occupy the former calendar grid area');
assert(app.includes('home-actions home-todos-card" data-home-card="todos"'),'today todos occupy the former quick-actions grid area');

for(const label of ['额外支出、通勤与最低回报','自定义消费','夜班补贴','工资与补贴结算规则']){
  assert(app.includes(`<b>${label}</b>`),`${label} is available as a semantic fold group`);
}
assert(app.includes('overtime-advanced-settings" open'),'important advanced assumptions remain visible by default');
assert(app.includes("data-overtime-help=\"all\""),'the overtime page exposes the existing right drawer as field help');
assert(app.includes("d.type === 'overtime-help'"),'field help is rendered by the shared drawer');
assert(app.includes("d.type === 'overtime-detail'"),'result calculations reuse the shared drawer');
assert(app.includes('data-overtime-detail'),'main result cards expose calculation details');
assert(app.includes('data-overtime-ai-host'),'optional AI analysis has a dedicated result host');
assert(app.includes("provider.analyzeOvertime(payload)"),'AI analysis reuses the configured Radar provider');
assert(radar.includes("'/api/overtime/analyze'"),'AI analysis uses the same trusted backend boundary');
assert(css.includes('.overtime-config-group'),'fold groups have a compact local style');
assert(css.includes('.overtime-help-list'),'field help follows existing drawer styling');
assert(css.includes('.home-focus-capture')&&css.includes('.home-capture-focus'),'swapped home content has scoped style adaptations');
assert(css.includes('.home-actions-card')&&css.includes('.home-todos-card'),'rotated home cards keep scoped layout adaptations');

console.log('Marginal value UI contract tests passed');
