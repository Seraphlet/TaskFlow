const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/marginal-planning.js', 'utf8'), context);
const Planning = context.window.TaskFlowMarginalPlanning;

const base = { income:4550, livingExpense:2000, fixedObligations:0, fixedIncludedInLiving:false, reserveDeposit:2000, usedFreeBudget:300, reserveBalance:10000 };
let result = Planning.calculateBudget(base, 200);
assert.equal(result.remainingFreeBudget, 250);
assert.equal(result.afterExpense, 50);
assert.equal(result.planMaintained, true);

result = Planning.calculateBudget(base, 400);
assert.equal(result.afterExpense, -150);
assert.equal(result.gap, 150);
assert.equal(result.planMaintained, false);
assert.equal(result.facts.reserveDeposit, 2000, 'shortfall must not silently reduce the reserve plan');

const unknown = Planning.calculateBudget({ ...base, income:'' }, 0);
assert.equal(unknown.complete, false);
assert.ok(unknown.missing.includes('income'));

const tiers = Planning.calculateSafetyTiers(base, [{ id:'basic', name:'基础', baseMonthly:2000, months:6 }]);
assert.equal(tiers[0].target, 12000);
assert.equal(tiers[0].margin, -2000);
assert.equal(tiers[0].coverageMonths, 5);
assert.equal(tiers[0].monthsToTarget, 1);

const simulation = Planning.simulateFunds({ facts:base, months:3, events:[{type:'installment',name:'分期',amount:300,startMonth:1,count:2,direction:'expense',financing:'free-budget'}] });
assert.equal(simulation.months[0].freeBudget, 250);
assert.equal(simulation.months[1].freeBudget, 250, 'monthly free budget before used-budget should be 550 minus installment');
assert.equal(simulation.months[2].freeBudget, 250);
assert.equal(simulation.critical.maxNewMonthlyInstallment, 250);

const noAutoReserve = Planning.simulateFunds({ facts:base, months:1, proposedExpense:600 });
assert.equal(noAutoReserve.months[0].unassignedGap, 350);
assert.equal(noAutoReserve.months[0].reserve, 12000, 'unassigned gap must not consume reserve automatically');

const installment = Planning.simulateFunds({ facts:base, months:2, events:[{type:'installment',amount:100,downPayment:200,startMonth:0,count:2,direction:'expense',financing:'free-budget'}] });
assert.equal(installment.months[0].freeBudget,-50,'down payment and first installment both apply in the first month');
assert.equal(installment.months[1].freeBudget,450,'later months include only the periodic installment');
assert.equal(installment.critical.recovery.gapToOriginal,0,'free-budget events do not silently reduce reserve');
assert.equal(installment.critical.recovery.gapToCounterfactual,0,'free-budget events preserve the reserve counterfactual path');

console.log('Marginal fund planning tests passed');
