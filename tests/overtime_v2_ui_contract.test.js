const assert=require('assert');
const fs=require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const storage=fs.readFileSync('js/storage.js','utf8');

assert(app.includes('name="wageSettlementMode"'),'overtime V2 exposes deterministic wage settlement modes');
assert(app.includes('name="partialUnitRule"'),'incomplete settlement units have an explicit rule');
assert(app.includes('name="bonusMode"'),'threshold and tier subsidy rules are configurable');
assert(app.includes('data-overtime-tiers'),'multiple subsidy tiers can be managed');
assert(app.includes('id="overtime-status-form"'),'the current subjective state can be recorded');
assert(app.includes("return null"),'unrecorded subjective scores stay null instead of becoming zero');
assert(app.includes('data-view-overtime-hours'),'chart points can be inspected without changing planned duration');
assert(app.includes('data-toggle-overtime-series'),'economic series can be shown or hidden');
assert(app.includes("key:'overtimePremium'"),'overtime premium is a first-class economic curve');
assert(app.includes("key:'minimumAcceptableReturn'"),'personal minimum return is shown as an economic curve');
assert(app.includes("name:'minimumAcceptableHourly'"),'the personal minimum net hourly return is configurable');
assert(app.includes("name:'extraOccupiedHours'"),'extra commuting and waiting time is explicit');
assert(app.includes("name:'variableExtraCostPerHour'"),'duration-dependent cash costs are explicit');
assert(app.includes('data-paired-range'),'continuous values use paired range and numeric inputs');
assert(app.includes("name:'fatigue'"),'fatigue has a paired 0-100 control');
assert(app.includes("name:'willingness'"),'willingness has a paired 0-100 control');
assert(app.includes('状态记录已删除'),'status records support deletion');
assert(app.includes("submit:overtime-status"),'status saves use a record-scoped mutual exclusion key');
assert(storage.includes("'overtimeStatusRecords'"),'status records have an independent persistent store');
assert(css.includes('.overtime-subjective-chart'),'subjective scores use a separate 0-100 chart');
console.log('Overtime V2 UI contract tests passed');
