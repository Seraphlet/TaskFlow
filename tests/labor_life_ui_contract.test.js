const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
const storage=fs.readFileSync('js/storage.js','utf8');

assert(html.includes('js/labor-life.js'),'calculation module loads before app');
assert(app.includes("navButton('labor-life'"),'sidebar exposes independent labor and life route');
for(const tab of ['salary','overtime','living','career'])assert(app.includes(`['${tab}'`)||app.includes(`'${tab}'`),`page contains ${tab} area`);
for(const store of ['salaryRecords','overtimeDecisions','livingRecords','laborParameters','jobComparisons'])assert(storage.includes(`'${store}'`),`storage includes ${store}`);
assert(app.includes('facts,snapshot'),'records separate facts and calculation snapshots');
assert(app.includes('id="labor-overtime-form"'),'overtime curve has live input form');
assert(app.includes('id="labor-forecast-form"'),'savings forecast has adjustable assumptions');
assert(app.includes('candidateBasis'),'job comparison preserves salary basis');
assert(app.includes('id="labor-history-range"'),'historical charts expose a time-range filter');
assert(app.includes("label:'储蓄余额'"),'living history includes recorded savings balance');
assert(app.includes('labor-split-charts'),'hourly wage and living cost use separate charts and axes');
assert(app.includes('填写候选工资后显示工作对比结果'),'blank candidate input does not show a misleading comparison');
assert(css.includes('.labor-kpis'),'module reuses responsive site styling');
assert(css.includes('.labor-chart svg'),'charts are dependency-free SVG');
console.log('Labor and life UI contract tests passed');
