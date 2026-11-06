(() => {
'use strict';

const ENGINE_VERSION = 1;
const LIMITS = { inputs: 40, formulas: 60, expressionLength: 300, nodes: 200, explorePoints: 500 };
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const BUILTIN_FUNCTIONS = Object.freeze({
  min: (...args) => Math.min(...args), max: (...args) => Math.max(...args), abs: Math.abs,
  ceil: Math.ceil, floor: Math.floor, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
  safeDiv: (a, b) => Math.abs(b) < 1e-12 ? null : a / b,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function tokenize(source) {
  const tokens = []; let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const number = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index += number[0].length; continue; }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0] }); index += identifier[0].length; continue; }
    if ('+-*/%^(),'.includes(char)) { tokens.push({ type: char, value: char }); index += 1; continue; }
    throw new Error(`公式包含不支持的字符：${char}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function parseExpression(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('公式不能为空');
  if (source.length > LIMITS.expressionLength) throw new Error('公式过长');
  const tokens = tokenize(source); let cursor = 0; let nodeCount = 0;
  const peek = () => tokens[cursor]; const take = (type) => { const token = peek(); if (token.type !== type) throw new Error(`公式语法错误：应为 ${type}`); cursor += 1; return token; };
  const node = (value) => { nodeCount += 1; if (nodeCount > LIMITS.nodes) throw new Error('公式复杂度超出限制'); return value; };
  const primary = () => {
    const token = peek();
    if (token.type === 'number') { cursor += 1; return node({ type: 'number', value: token.value }); }
    if (token.type === 'identifier') {
      cursor += 1;
      if (peek().type !== '(') return node({ type: 'identifier', name: token.value });
      take('('); const args = [];
      if (peek().type !== ')') { do { args.push(additive()); if (peek().type !== ',') break; take(','); } while (true); }
      take(')'); return node({ type: 'call', name: token.value, args });
    }
    if (token.type === '(') { take('('); const value = additive(); take(')'); return value; }
    if (token.type === '+' || token.type === '-') { cursor += 1; return node({ type: 'unary', op: token.type, value: primary() }); }
    throw new Error('公式语法错误');
  };
  const power = () => { let left = primary(); if (peek().type === '^') { take('^'); left = node({ type: 'binary', op: '^', left, right: power() }); } return left; };
  const multiply = () => { let left = power(); while (['*', '/', '%'].includes(peek().type)) { const op = peek().type; cursor += 1; left = node({ type: 'binary', op, left, right: power() }); } return left; };
  const additive = () => { let left = multiply(); while (['+', '-'].includes(peek().type)) { const op = peek().type; cursor += 1; left = node({ type: 'binary', op, left, right: multiply() }); } return left; };
  const ast = additive(); take('eof'); return ast;
}

function identifiers(ast, found = new Set()) {
  if (ast.type === 'identifier') found.add(ast.name);
  if (ast.type === 'binary') { identifiers(ast.left, found); identifiers(ast.right, found); }
  if (ast.type === 'unary') identifiers(ast.value, found);
  if (ast.type === 'call') ast.args.forEach((arg) => identifiers(arg, found));
  return found;
}

function evaluateAst(ast, resolve) {
  if (ast.type === 'number') return ast.value;
  if (ast.type === 'identifier') return resolve(ast.name);
  if (ast.type === 'unary') { const value = evaluateAst(ast.value, resolve); return value == null ? null : ast.op === '-' ? -value : value; }
  if (ast.type === 'call') {
    const fn = BUILTIN_FUNCTIONS[ast.name]; if (!fn) throw new Error(`不支持的函数：${ast.name}`);
    const args = ast.args.map((arg) => evaluateAst(arg, resolve));
    if (ast.name !== 'safeDiv' && args.some((value) => value == null)) return null;
    const result = fn(...args); return Number.isFinite(result) ? result : null;
  }
  const left = evaluateAst(ast.left, resolve), right = evaluateAst(ast.right, resolve);
  if (left == null || right == null) return null;
  if (ast.op === '+') return left + right; if (ast.op === '-') return left - right;
  if (ast.op === '*') return left * right; if (ast.op === '^') return left ** right;
  if (ast.op === '/' || ast.op === '%') { if (Math.abs(right) < 1e-12) return null; return ast.op === '/' ? left / right : left % right; }
  throw new Error('不支持的运算符');
}

function validateTemplate(template) {
  const errors = [], warnings = [];
  if (!template || typeof template !== 'object') return { valid: false, errors: ['模板必须是 JSON 对象'], warnings };
  if (template.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!ID_RE.test(String(template.id || ''))) errors.push('模板 id 格式无效');
  if (!String(template.name || '').trim()) errors.push('模板名称不能为空');
  const inputs = Array.isArray(template.inputs) ? template.inputs : [];
  const formulas = template.formulas && typeof template.formulas === 'object' ? template.formulas : {};
  const outputs = Array.isArray(template.outputs) ? template.outputs : [];
  if (inputs.length > LIMITS.inputs) errors.push('输入字段过多');
  if (Object.keys(formulas).length > LIMITS.formulas) errors.push('公式过多');
  const inputIds = new Set();
  for (const input of inputs) {
    if (!ID_RE.test(String(input.id || ''))) errors.push(`输入字段 id 无效：${input.id || '(空)'}`);
    if (inputIds.has(input.id)) errors.push(`输入字段重复：${input.id}`); inputIds.add(input.id);
    if (!['number'].includes(input.type || 'number')) errors.push(`不支持的输入类型：${input.type}`);
    if (Number.isFinite(Number(input.min)) && Number.isFinite(Number(input.max)) && Number(input.min) > Number(input.max)) errors.push(`输入范围无效：${input.id}`);
  }
  const formulaIds = new Set(Object.keys(formulas));
  for (const id of formulaIds) if (!ID_RE.test(id) || inputIds.has(id)) errors.push(`公式 id 无效或冲突：${id}`);
  const asts = {};
  for (const [id, source] of Object.entries(formulas)) {
    try {
      const ast = parseExpression(source); asts[id] = ast;
      for (const reference of identifiers(ast)) if (!inputIds.has(reference) && !formulaIds.has(reference)) errors.push(`公式 ${id} 引用了未知字段 ${reference}`);
      const calls = [];
      (function visit(node) { if (node.type === 'call') { calls.push(node.name); node.args.forEach(visit); } if (node.type === 'binary') { visit(node.left); visit(node.right); } if (node.type === 'unary') visit(node.value); })(ast);
      calls.filter((name) => !BUILTIN_FUNCTIONS[name]).forEach((name) => errors.push(`公式 ${id} 使用了不支持的函数 ${name}`));
    } catch (error) { errors.push(`公式 ${id}：${error.message}`); }
  }
  const visiting = new Set(), visited = new Set();
  const visitFormula = (id) => { if (visiting.has(id)) { errors.push(`公式存在循环依赖：${id}`); return; } if (visited.has(id) || !asts[id]) return; visiting.add(id); for (const ref of identifiers(asts[id])) if (formulaIds.has(ref)) visitFormula(ref); visiting.delete(id); visited.add(id); };
  formulaIds.forEach(visitFormula);
  for (const output of outputs) if (!inputIds.has(output.source) && !formulaIds.has(output.source)) errors.push(`输出引用未知字段：${output.source}`);
  for (const [index, flow] of (Array.isArray(template.cashflows) ? template.cashflows : []).entries()) {
    if (!['income','expense'].includes(flow.direction)) errors.push(`现金流 ${index + 1} 的方向无效`);
    for (const [label, source] of [['金额',flow.amount],['月份',String(flow.monthOffset ?? '0')]]) {
      try {
        const ast=parseExpression(source);
        for(const reference of identifiers(ast))if(!inputIds.has(reference)&&!formulaIds.has(reference))errors.push(`现金流 ${index + 1}${label}引用未知字段 ${reference}`);
        const calls=[];(function visit(node){if(node.type==='call'){calls.push(node.name);node.args.forEach(visit);}if(node.type==='binary'){visit(node.left);visit(node.right);}if(node.type==='unary')visit(node.value);})(ast);
        calls.filter((name)=>!BUILTIN_FUNCTIONS[name]).forEach((name)=>errors.push(`现金流 ${index + 1}${label}使用了不支持的函数 ${name}`));
      } catch(error) { errors.push(`现金流 ${index + 1}${label}：${error.message}`); }
    }
  }
  if (!outputs.length) warnings.push('模板没有配置输出');
  const variable = template.exploration?.variable;
  if (variable && !inputIds.has(variable)) errors.push('探索变量必须引用输入字段');
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings, asts };
}

function calculate(template, rawInputs = {}) {
  const validation = validateTemplate(template); if (!validation.valid) throw new Error(validation.errors.join('；'));
  const inputs = {};
  for (const field of template.inputs) {
    const raw = rawInputs[field.id] ?? field.default;
    if (raw === '' || raw == null || !Number.isFinite(Number(raw))) throw new Error(`${field.label || field.id}需要有效数值`);
    const value = Number(raw);
    if (Number.isFinite(Number(field.min)) && value < Number(field.min)) throw new Error(`${field.label || field.id}低于最小值`);
    if (Number.isFinite(Number(field.max)) && value > Number(field.max)) throw new Error(`${field.label || field.id}高于最大值`);
    inputs[field.id] = value;
  }
  const values = { ...inputs }, resolving = new Set();
  const resolve = (id) => {
    if (Object.prototype.hasOwnProperty.call(values, id)) return values[id];
    if (!validation.asts[id]) throw new Error(`未知字段：${id}`);
    if (resolving.has(id)) throw new Error(`公式循环依赖：${id}`);
    resolving.add(id); const value = evaluateAst(validation.asts[id], resolve); resolving.delete(id); values[id] = value; return value;
  };
  Object.keys(template.formulas).forEach(resolve);
  const outputs = template.outputs.map((output) => ({ ...output, value: resolve(output.source), expression: template.formulas[output.source] || output.source }));
  const cashflows = (template.cashflows || []).map((flow, index) => {
    const amountAst = parseExpression(flow.amount); const offsetAst = parseExpression(String(flow.monthOffset ?? '0'));
    return { id: flow.id || `cashflow-${index + 1}`, name: flow.name || `现金流 ${index + 1}`, direction: flow.direction === 'income' ? 'income' : 'expense', amount: evaluateAst(amountAst, resolve), monthOffset: Math.max(0, Math.floor(evaluateAst(offsetAst, resolve) || 0)) };
  }).filter((flow) => Number.isFinite(flow.amount) && flow.amount >= 0);
  return { engineVersion: ENGINE_VERSION, templateId: template.id, templateVersion: template.version || 1, inputs, values, outputs, cashflows };
}

function explore(template, rawInputs = {}) {
  const config = template.exploration; if (!config) return { variable: null, points: [], crossings: [] };
  const field = template.inputs.find((item) => item.id === config.variable); if (!field) throw new Error('探索变量无效');
  const min = Number(config.min ?? field.min ?? 0), max = Number(config.max ?? field.max ?? min), step = Number(config.step ?? field.step ?? 1);
  if (!(step > 0) || max < min) throw new Error('探索范围无效');
  const count = Math.floor((max - min) / step) + 1; if (count > LIMITS.explorePoints) throw new Error('探索点数量超出限制');
  const points = [];
  for (let index = 0; index < count; index += 1) { const x = Math.min(max, min + index * step); const result = calculate(template, { ...rawInputs, [config.variable]: x }); points.push({ x, values: result.values, outputs: result.outputs }); }
  const crossings = [];
  for (const crossing of config.crossings || []) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = Number(points[index - 1].values[crossing.left]) - Number(points[index - 1].values[crossing.right] ?? crossing.threshold ?? 0);
      const current = Number(points[index].values[crossing.left]) - Number(points[index].values[crossing.right] ?? crossing.threshold ?? 0);
      if (Number.isFinite(previous) && Number.isFinite(current) && (previous === 0 || current === 0 || Math.sign(previous) !== Math.sign(current))) crossings.push({ id: crossing.id || `${crossing.left}-crossing`, from: points[index - 1].x, to: points[index].x, exact: current === 0 ? points[index].x : previous === 0 ? points[index - 1].x : null });
    }
  }
  return { variable: config.variable, points, crossings };
}

const input = (id, label, value, min = 0, max = 1e8, step = 1, unit = '') => ({ id, label, type: 'number', default: value, min, max, step, unit });
const BUILTIN_TEMPLATES = Object.freeze([
  {
    schemaVersion: 1, id: 'builtin_tool_value', version: 1, builtin: true, name: '工具投入 / 使用价值', description: '比较购买成本、使用频率、节省时间与直接收益。',
    inputs: [input('purchasePrice','购买价格',2000),input('usesPerMonth','每月使用次数',8,0,1000,.5),input('months','评估月数',12,1,120,1),input('minutesSavedPerUse','每次节省分钟',30,0,1440,1),input('moneySavedPerUse','每次节省现金',0,0,1e6,.01),input('timeValuePerHour','时间价值/小时',0,0,1e6,.01)],
    formulas: { totalUses:'usesPerMonth * months', costPerUse:'safeDiv(purchasePrice, totalUses)', timeSavedHours:'totalUses * minutesSavedPerUse / 60', directBenefit:'totalUses * moneySavedPerUse', timeBenefit:'timeSavedHours * timeValuePerHour', totalBenefit:'directBenefit + timeBenefit', netValue:'totalBenefit - purchasePrice' },
    outputs: [{source:'costPerUse',label:'单次使用成本',unit:'元'},{source:'timeSavedHours',label:'累计节省时间',unit:'小时'},{source:'netValue',label:'净经济价值',unit:'元'}],
    exploration: { variable:'usesPerMonth', min:0, max:60, step:1, crossings:[{id:'break-even',left:'totalBenefit',right:'purchasePrice'}] },
    cashflows: [{id:'purchase',name:'工具购买',direction:'expense',amount:'purchasePrice',monthOffset:'0'}],
  },
  {
    schemaVersion: 1, id: 'builtin_rent_buy', version: 1, builtin: true, name: '租赁 / 购买', description: '分别比较现金流与包含残值的经济成本。',
    inputs: [input('buyPrice','购买价格',6000),input('resaleValue','预计残值',1000),input('holdingCost','持有固定成本',0),input('buyPerUseCost','购买后单次成本',0),input('rentPerUseFee','单次租赁费',80),input('usesPerMonth','每月使用次数',4,0,1000,.5),input('months','评估月数',12,1,120,1)],
    formulas: { totalUses:'usesPerMonth * months', buyCashOutflow:'buyPrice + holdingCost + buyPerUseCost * totalUses', buyEconomicCost:'buyCashOutflow - resaleValue', rentCost:'rentPerUseFee * totalUses', economicDifference:'buyEconomicCost - rentCost' },
    outputs: [{source:'buyCashOutflow',label:'购买现金流出',unit:'元'},{source:'buyEconomicCost',label:'购买经济成本',unit:'元'},{source:'rentCost',label:'租赁成本',unit:'元'},{source:'economicDifference',label:'购买相对租赁差额',unit:'元'}],
    exploration: { variable:'usesPerMonth', min:0, max:60, step:1, crossings:[{id:'cost-equivalent',left:'buyEconomicCost',right:'rentCost'}] },
    cashflows: [{id:'buy',name:'购买支出',direction:'expense',amount:'buyPrice',monthOffset:'0'}],
  },
  {
    schemaVersion: 1, id: 'builtin_work_compare', version: 1, builtin: true, name: '工作方案比较', description: '比较税后收入、支出、工作与通勤占用时间。税前数据需先由用户换算。',
    inputs: [input('currentIncome','当前税后月收入',0),input('candidateIncome','候选税后月收入',0),input('currentDays','当前每月工作天数',22,0,31,.5),input('candidateDays','候选每月工作天数',22,0,31,.5),input('currentDailyHours','当前每日工时',8,0,24,.25),input('candidateDailyHours','候选每日工时',8,0,24,.25),input('currentMonthlyOvertime','当前每月加班',0,0,744,.5),input('candidateMonthlyOvertime','候选每月加班',0,0,744,.5),input('currentCommuteDaily','当前每日通勤',0,0,24,.25),input('candidateCommuteDaily','候选每日通勤',0,0,24,.25),input('currentSpending','当前月支出',0),input('candidateSpending','候选月支出',0)],
    formulas: { currentBalance:'currentIncome - currentSpending', candidateBalance:'candidateIncome - candidateSpending', balanceDifference:'candidateBalance - currentBalance', currentOccupiedHours:'currentDays * (currentDailyHours + currentCommuteDaily) + currentMonthlyOvertime', candidateOccupiedHours:'candidateDays * (candidateDailyHours + candidateCommuteDaily) + candidateMonthlyOvertime', occupiedHoursDifference:'candidateOccupiedHours - currentOccupiedHours', currentDisposableHourly:'safeDiv(currentBalance, currentOccupiedHours)', candidateDisposableHourly:'safeDiv(candidateBalance, candidateOccupiedHours)', disposableHourlyDifference:'candidateDisposableHourly - currentDisposableHourly' },
    outputs: [{source:'balanceDifference',label:'月结余差额',unit:'元'},{source:'occupiedHoursDifference',label:'占用时间差额',unit:'小时'},{source:'disposableHourlyDifference',label:'每小时可支配收入差额',unit:'元/小时'}],
    exploration: { variable:'candidateIncome', min:0, max:50000, step:500, crossings:[{id:'balance-equivalent',left:'candidateBalance',right:'currentBalance'}] },
  },
]);

window.TaskFlowEvaluationEngine = { ENGINE_VERSION, LIMITS, validateTemplate, calculate, explore, compare: calculate, builtins: () => clone(BUILTIN_TEMPLATES) };
})();
