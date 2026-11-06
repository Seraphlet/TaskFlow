const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/evaluation-engine.js', 'utf8'), context);
const Engine = context.window.TaskFlowEvaluationEngine;
const builtins = Engine.builtins();
const example = JSON.parse(fs.readFileSync('examples/evaluation-template-tool-value.json','utf8'));
assert.equal(Engine.validateTemplate(example).valid,true,'documented example must match the real validator');

assert.equal(Array.from(builtins, (item) => item.id).join(','), 'builtin_tool_value,builtin_rent_buy,builtin_work_compare');
for (const template of builtins) assert.equal(Engine.validateTemplate(template).valid, true, `${template.id} should validate`);

const tool = builtins[0];
let result = Engine.calculate(tool, { purchasePrice:1200, usesPerMonth:10, months:12, minutesSavedPerUse:30, moneySavedPerUse:2, timeValuePerHour:20 });
assert.equal(result.values.totalUses, 120);
assert.equal(result.values.costPerUse, 10);
assert.equal(result.values.netValue, 240);
assert.equal(result.cashflows[0].amount, 1200);

result = Engine.calculate(tool, { purchasePrice:1200, usesPerMonth:0, months:12, minutesSavedPerUse:30, moneySavedPerUse:0, timeValuePerHour:0 });
assert.equal(result.values.costPerUse, null, 'division by zero must be explicit instead of Infinity');

const rentBuy = builtins[1];
result = Engine.calculate(rentBuy, { buyPrice:6000, resaleValue:1000, holdingCost:0, buyPerUseCost:0, rentPerUseFee:100, usesPerMonth:5, months:12 });
assert.equal(result.values.buyCashOutflow, 6000);
assert.equal(result.values.buyEconomicCost, 5000);
assert.equal(result.values.rentCost, 6000);

const explored = Engine.explore(rentBuy, { buyPrice:6000, resaleValue:1000, holdingCost:0, buyPerUseCost:0, rentPerUseFee:100, usesPerMonth:1, months:12 });
assert.ok(explored.points.length > 10);
assert.ok(explored.crossings.some((item) => item.id === 'cost-equivalent'));

const unsafe = { schemaVersion:1, id:'unsafe', name:'unsafe', inputs:[], formulas:{ value:'window.alert(1)' }, outputs:[{source:'value'}] };
assert.equal(Engine.validateTemplate(unsafe).valid, false);
const cyclic = { schemaVersion:1, id:'cyclic', name:'cyclic', inputs:[], formulas:{ a:'b + 1', b:'a + 1' }, outputs:[{source:'a'}] };
assert.equal(Engine.validateTemplate(cyclic).valid, false);

console.log('Safe evaluation engine tests passed');
