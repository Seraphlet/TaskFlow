(() => {
'use strict';

const FORMULA_VERSION = 1;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const finite = (value) => value !== '' && value != null && Number.isFinite(Number(value));
const optionalNumber = (value, { min = -Infinity, max = Infinity, name = '数值' } = {}) => {
  if (!finite(value)) return null;
  const number = Number(value);
  if (number < min || number > max) throw new Error(`${name}超出有效范围`);
  return number;
};
const money = (value, name) => optionalNumber(value, { min: 0, max: 1e12, name });
const clone = (value) => JSON.parse(JSON.stringify(value));

function normalizeFacts(raw = {}) {
  const fixedIncludedInLiving = Boolean(raw.fixedIncludedInLiving);
  return {
    month: String(raw.month || '').slice(0, 7),
    income: money(raw.income, '月收入'),
    livingExpense: money(raw.livingExpense, '基本生活支出'),
    fixedObligations: money(raw.fixedObligations, '固定义务'),
    fixedIncludedInLiving,
    reserveDeposit: money(raw.reserveDeposit, '计划储备金投入'),
    usedFreeBudget: money(raw.usedFreeBudget, '已使用自由预算'),
    reserveBalance: money(raw.reserveBalance, '当前储备金'),
    currentCash: money(raw.currentCash, '当前可用现金'),
    pendingBeforeIncome: money(raw.pendingBeforeIncome, '下次收入前待支付金额'),
    nextIncomeDate: String(raw.nextIncomeDate || ''),
    sources: raw.sources && typeof raw.sources === 'object' ? clone(raw.sources) : {},
  };
}

function calculateBudget(raw = {}, proposedExpense = 0) {
  const facts = normalizeFacts(raw);
  const required = ['income', 'livingExpense', 'fixedObligations', 'reserveDeposit', 'usedFreeBudget'];
  const missing = required.filter((key) => facts[key] == null);
  const extra = money(proposedExpense, '本次计划支出') ?? 0;
  if (missing.length) return { formulaVersion: FORMULA_VERSION, facts, complete: false, missing, extraExpense: extra };
  const effectiveFixed = facts.fixedIncludedInLiving ? 0 : facts.fixedObligations;
  const distributable = facts.income - facts.livingExpense - effectiveFixed;
  const freeBudget = distributable - facts.reserveDeposit;
  const remainingFreeBudget = freeBudget - facts.usedFreeBudget;
  const afterExpense = remainingFreeBudget - extra;
  const liquidityKnown = facts.currentCash != null && facts.pendingBeforeIncome != null && Boolean(facts.nextIncomeDate);
  return {
    formulaVersion: FORMULA_VERSION,
    facts,
    complete: true,
    missing: [],
    effectiveFixed,
    distributable,
    freeBudget,
    remainingFreeBudget,
    extraExpense: extra,
    afterExpense,
    planMaintained: afterExpense >= 0,
    gap: Math.max(0, -afterExpense),
    maxExtraWithoutChangingPlan: Math.max(0, remainingFreeBudget),
    liquidity: liquidityKnown ? {
      known: true,
      beforeNextIncome: facts.currentCash - facts.pendingBeforeIncome - extra,
      nextIncomeDate: facts.nextIncomeDate,
    } : { known: false, reason: '缺少当前现金、下次收入日期或此前待支付金额，当前只能判断月度预算。' },
  };
}

function calculateSafetyTiers(rawFacts = {}, rawTiers = []) {
  const facts = normalizeFacts(rawFacts);
  const reserve = facts.reserveBalance;
  return (Array.isArray(rawTiers) ? rawTiers : []).map((item, index) => {
    const baseMonthly = money(item.baseMonthly, `安全层级 ${index + 1} 月基准`);
    const months = optionalNumber(item.months, { min: 0, max: 600, name: `安全层级 ${index + 1} 月数` });
    if (baseMonthly == null || months == null) return { id: String(item.id || `tier-${index + 1}`), name: String(item.name || `层级 ${index + 1}`), complete: false };
    const target = baseMonthly * months;
    const margin = reserve == null ? null : reserve - target;
    const coverageMonths = reserve == null || baseMonthly <= 0 ? null : reserve / baseMonthly;
    const monthlyDeposit = facts.reserveDeposit;
    return {
      id: String(item.id || `tier-${index + 1}`),
      name: String(item.name || `层级 ${index + 1}`),
      complete: true,
      baseMonthly,
      months,
      target,
      margin,
      coverageMonths,
      coverageDays: coverageMonths == null ? null : coverageMonths * 30,
      monthsToTarget: margin == null || margin >= 0 ? 0 : monthlyDeposit > 0 ? Math.ceil(Math.abs(margin) / monthlyDeposit) : null,
    };
  });
}

function normalizeEvent(raw = {}, index = 0) {
  const type = ['one-time', 'installment', 'income-change'].includes(raw.type) ? raw.type : 'one-time';
  const direction = raw.direction === 'income' ? 'income' : 'expense';
  const financing = ['free-budget', 'reduce-deposit', 'reserve', 'unassigned'].includes(raw.financing) ? raw.financing : 'unassigned';
  const amount = money(raw.amount, `事件 ${index + 1} 金额`) ?? 0;
  const downPayment = money(raw.downPayment, `事件 ${index + 1} 首期支出`) ?? 0;
  const startMonth = Math.max(0, Math.floor(optionalNumber(raw.startMonth, { min: 0, max: 600, name: '开始月份' }) ?? 0));
  const count = type === 'installment' || type === 'income-change' ? Math.max(1, Math.floor(optionalNumber(raw.count, { min: 1, max: 600, name: '持续期数' }) ?? 1)) : 1;
  return { id: String(raw.id || `event-${index + 1}`), name: String(raw.name || `事件 ${index + 1}`), type, direction, financing, amount, downPayment, startMonth, count };
}

function simulateFunds({ facts: rawFacts = {}, tiers = [], events = [], months = 12, proposedExpense = 0 } = {}) {
  const budget = calculateBudget(rawFacts, proposedExpense);
  const safetyTiers = calculateSafetyTiers(rawFacts, tiers);
  const normalizedEvents = (Array.isArray(events) ? events : []).map(normalizeEvent);
  const horizon = Math.max(1, Math.min(120, Math.floor(Number(months) || 12)));
  if (!budget.complete) return { formulaVersion: FORMULA_VERSION, budget, safetyTiers, events: normalizedEvents, months: [], critical: {} };
  let reserve = budget.facts.reserveBalance;
  const reserveKnown = reserve != null;
  const rows = [];
  for (let month = 0; month < horizon; month += 1) {
    const active = normalizedEvents.filter((event) => month >= event.startMonth && month < event.startMonth + event.count);
    let freeBudget = budget.freeBudget;
    let plannedDeposit = budget.facts.reserveDeposit;
    let reserveChange = plannedDeposit;
    let unassignedGap = 0;
    const applied = [];
    for (const event of active) {
      const firstPayment = event.type === 'installment' && month === event.startMonth ? event.downPayment : 0;
      const totalAmount = event.amount + firstPayment;
      const signed = event.direction === 'income' ? totalAmount : -totalAmount;
      if (event.financing === 'reserve') reserveChange += signed;
      else if (event.financing === 'reduce-deposit' && signed < 0) {
        const reduction = Math.min(plannedDeposit, Math.abs(signed));
        plannedDeposit -= reduction;
        reserveChange -= reduction;
        freeBudget += signed + reduction;
      } else freeBudget += signed;
      applied.push({ ...event, signedAmount: signed });
    }
    if (month === 0) freeBudget -= budget.facts.usedFreeBudget + budget.extraExpense;
    if (freeBudget < 0) unassignedGap = Math.abs(freeBudget);
    if (reserveKnown) reserve += reserveChange;
    rows.push({ month, label: `第 ${month + 1} 月`, freeBudget, plannedDeposit, reserve: reserveKnown ? reserve : null, reserveChange, unassignedGap, events: applied });
  }
  const nonNegativeBudgets = rows.map((row) => row.freeBudget);
  const firstBudgetBreach = rows.find((row) => row.freeBudget < 0) || null;
  const firstSafetyBreaches = safetyTiers.filter((tier) => tier.complete && reserveKnown).map((tier) => ({ tierId: tier.id, row: rows.find((row) => row.reserve < tier.target) || null })).filter((item) => item.row);
  const counterfactualReserve = reserveKnown ? budget.facts.reserveBalance + budget.facts.reserveDeposit * horizon : null;
  const finalReserve = reserveKnown ? rows.at(-1).reserve : null;
  const reserveFinancedOutflow = rows.map((row) => row.events.filter((event) => event.financing === 'reserve').reduce((total,event) => total - Math.min(0,event.signedAmount),0));
  return {
    formulaVersion: FORMULA_VERSION,
    budget,
    safetyTiers,
    events: normalizedEvents,
    months: rows,
    critical: {
      maxExtraWithoutChangingPlan: budget.maxExtraWithoutChangingPlan,
      maxNewMonthlyInstallment: Math.max(0, Math.min(...nonNegativeBudgets)),
      reserveGrowthZeroDeposit: Math.max(0, ...reserveFinancedOutflow),
      recovery: reserveKnown ? {
        originalReserve: budget.facts.reserveBalance,
        finalReserve,
        counterfactualReserve,
        gapToOriginal: Math.max(0, budget.facts.reserveBalance - finalReserve),
        gapToCounterfactual: Math.max(0, counterfactualReserve - finalReserve),
        safetyGaps: safetyTiers.filter((tier) => tier.complete).map((tier) => ({ tierId:tier.id, name:tier.name, gap:Math.max(0,tier.target-finalReserve) })),
      } : null,
      firstBudgetBreach,
      firstSafetyBreaches,
    },
  };
}

function createScenario({ sourceModule = 'funds', baseFacts = {}, overrides = {}, events = [], units = {}, assumptions = [], sourceRecordIds = [] } = {}) {
  return {
    schemaVersion: 1,
    sourceModule,
    baseFactsSnapshot: clone(baseFacts),
    overrides: clone(overrides),
    events: clone(events),
    units: clone(units),
    assumptions: [...assumptions].map(String),
    sourceRecordIds: [...sourceRecordIds].map(String),
    formulaVersion: FORMULA_VERSION,
    createdAt: new Date().toISOString(),
  };
}

window.TaskFlowMarginalPlanning = { FORMULA_VERSION, normalizeFacts, calculateBudget, calculateSafetyTiers, simulateFunds, createScenario };
})();
