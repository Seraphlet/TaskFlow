const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const storage=fs.readFileSync('js/storage.js','utf8');

for(const script of ['marginal-planning.js','evaluation-engine.js'])assert(html.includes(script),`${script} loads before app`);
for(const store of ['fundScenarios','evaluationTemplates','evaluationRecords'])assert(storage.includes(`'${store}'`),`${store} participates in backup and restore`);
assert(app.includes("const tabs=[['overtime','加班价值'],['funds','资金规划'],['evaluation','选择评估']]"),'the module has exactly three primary entries');
assert(app.includes('基础事实与个人参数'),'shared facts are discoverable');
assert(app.includes('空白代表未知'),'unknown and zero are explained separately');
assert(app.includes('data-send-evaluation-funds'),'evaluation cashflow handoff requires an explicit action');
assert(app.includes('data-send-overtime-funds'),'overtime income handoff requires explicit repetitions and duration');
assert(app.includes('资金规划上下文'),'fund safety outputs are visible in choice evaluation');
assert(app.includes('templateSnapshot:structuredClone(template)'),'evaluation history stores full template snapshots');
assert(app.includes('现有模板不会被覆盖'),'template id conflicts never overwrite silently');
assert(app.includes('经济成本和残值不会被自动当成现金'),'cash and economic cost are separated');
assert(app.includes("actualWorkDays??salary?.facts?.normalDays"),'work comparison migrates both work-day field names');

console.log('Marginal value architecture UI contract tests passed');
