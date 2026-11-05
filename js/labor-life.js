(() => {
  const EPSILON = 1e-9;
  const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
  const number = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) => {
    if ((value === '' || value == null) && !required) return 0;
    const next = Number(value);
    if (!Number.isFinite(next)) throw new Error(`${label}必须是有效数字`);
    if (next < min) throw new Error(`${label}不能小于 ${min}`);
    if (next > max) throw new Error(`${label}不能大于 ${max}`);
    return next;
  };
  const optionalRatio = (numerator, denominator) => denominator > EPSILON ? round(numerator / denominator, 4) : null;

  function overtimeHours(value, unit, dailyHours, label = '加班时间') {
    const amount = number(value, label, { min:0, max:10000 });
    if (!['hours','days'].includes(unit)) throw new Error(`${label}的单位无效`);
    if (unit === 'days' && amount > 0 && dailyHours <= 0) throw new Error('按天输入加班时，每日工时必须大于 0');
    return round(unit === 'days' ? amount * dailyHours : amount, 4);
  }

  function calculateSalary(facts = {}) {
    const totalSalary = number(facts.totalSalary, '实际总工资', { min:0, max:1e9, required:true });
    const normalDays = number(facts.normalDays, '正常工作天数', { min:0, max:366, required:true });
    const dailyHours = number(facts.dailyHours, '每日正常工时', { min:0, max:24, required:true });
    const normalHours = round(normalDays * dailyHours, 4);
    const overtime15Hours = overtimeHours(facts.overtime15Value, facts.overtime15Unit || 'hours', dailyHours, '1.5 倍加班时间');
    const overtime20Hours = overtimeHours(facts.overtime20Value, facts.overtime20Unit || 'hours', dailyHours, '2 倍加班时间');
    const overtime30Hours = overtimeHours(facts.overtime30Value, facts.overtime30Unit || 'hours', dailyHours, '3 倍加班时间');
    const overtimeTotalHours = round(overtime15Hours + overtime20Hours + overtime30Hours, 4);
    const totalWorkHours = round(normalHours + overtimeTotalHours, 4);
    if (totalWorkHours <= 0) throw new Error('实际工作总时长必须大于 0');
    const bonus = number(facts.bonus, '奖金', { min:0, max:1e9 });
    const allowance = number(facts.allowance, '补贴', { min:0, max:1e9 });
    const deductions = number(facts.deductions, '扣款', { min:0, max:1e9 });
    const attributablePay = round(totalSalary - bonus - allowance + deductions, 4);
    if (attributablePay < 0) throw new Error('奖金与补贴不能超过实际工资加扣款，否则无法反推工时工资');
    const weightedHours = round(normalHours + overtime15Hours * 1.5 + overtime20Hours * 2 + overtime30Hours * 3, 4);
    return {
      totalSalary:round(totalSalary), normalHours, overtime15Hours, overtime20Hours, overtime30Hours,
      overtimeTotalHours, totalWorkHours, overtimeShare:optionalRatio(overtimeTotalHours,totalWorkHours),
      averageHourlyRate:round(totalSalary / totalWorkHours), attributablePay:round(attributablePay), weightedHours,
      estimatedBaseHourlyRate:weightedHours > EPSILON ? round(attributablePay / weightedHours) : null,
      formulaVersion:1,
    };
  }

  function normalizeOvertimeInput(input = {}) {
    const dailyHours = number(input.dailyHours || 8, '每日加班工时', { min:0.25, max:24, required:true });
    return {
      scenario:input.scenario === 'rest-day' ? 'rest-day' : 'after-work',
      baseHourlyRate:number(input.baseHourlyRate, '基础时薪', { min:0, max:1e7, required:true }),
      multiplier:number(input.multiplier || 1.5, '加班倍率', { min:0, max:10, required:true }),
      selectedHours:overtimeHours(input.durationValue || 0, input.durationUnit || 'hours', dailyHours, '加班时长'),
      dailyHours,
      fixedCost:number(input.fixedCost, '额外固定支出', { min:0, max:1e9 }),
      variableCostPerHour:number(input.variableCostPerHour, '每小时额外支出', { min:0, max:1e7 }),
      commuteHours:number(input.commuteHours, '额外通勤时间', { min:0, max:48 }),
      restValuePerHour:number(input.restValuePerHour, '休息时间价值', { min:0, max:1e7 }),
      fatigueCoefficient:number(input.fatigueCoefficient, '疲劳成本系数', { min:0, max:1e7 }),
      maxHours:number(input.maxHours || 12, '最大可选加班时长', { min:0.25, max:744, required:true }),
    };
  }

  function overtimePoint(input, hours) {
    const h = Math.max(0, Number(hours) || 0);
    const active = h > EPSILON;
    const overtimeIncome = input.baseHourlyRate * input.multiplier * h;
    const fixedCost = active ? input.fixedCost : 0;
    const variableCost = input.variableCostPerHour * h;
    const cashNetValue = overtimeIncome - fixedCost - variableCost;
    const restOpportunityCost = input.restValuePerHour * (h + (active ? input.commuteHours : 0));
    const fatigueCost = input.fatigueCoefficient * h * h / 2;
    const comprehensiveValue = cashNetValue - restOpportunityCost - fatigueCost;
    const marginalNetValue = input.baseHourlyRate * input.multiplier - input.variableCostPerHour - input.restValuePerHour - input.fatigueCoefficient * h;
    return { hours:round(h,4), overtimeIncome:round(overtimeIncome), fixedCost:round(fixedCost), variableCost:round(variableCost), cashNetValue:round(cashNetValue), restOpportunityCost:round(restOpportunityCost), fatigueCost:round(fatigueCost), comprehensiveValue:round(comprehensiveValue), marginalNetValue:round(marginalNetValue) };
  }

  function firstPoint(points, predicate, start = 1) {
    for (let index=start; index<points.length; index+=1) if (predicate(points[index], points[index-1], index)) return points[index];
    return null;
  }

  function analyzeOvertime(rawInput = {}, step = 0.25) {
    const input=normalizeOvertimeInput(rawInput);
    const safeStep=Math.max(0.05,Math.min(1,Number(step)||0.25));
    const count=Math.ceil(input.maxHours/safeStep);
    const points=[];
    for(let index=0; index<=count; index+=1) points.push(overtimePoint(input,Math.min(input.maxHours,index*safeStep)));
    if(points.at(-1).hours!==input.maxHours) points.push(overtimePoint(input,input.maxHours));
    const optimal=points.reduce((best,point)=>point.comprehensiveValue>best.comprehensiveValue?point:best,points[0]);
    const cashBreakEven=firstPoint(points,(point)=>point.cashNetValue>=0);
    const comprehensiveBreakEven=firstPoint(points,(point)=>point.comprehensiveValue>=0);
    let hasBeenPositive=false;
    const negativeAfterPositive=firstPoint(points,(point)=>{if(point.comprehensiveValue>=0)hasBeenPositive=true;return hasBeenPositive&&point.comprehensiveValue<0;});
    const selected=overtimePoint(input,Math.min(input.selectedHours,input.maxHours));
    return { input, points, selected, nodes:{ cashBreakEven, comprehensiveBreakEven, optimal, negativeAfterPositive }, formulaVersion:1 };
  }

  function calculateLiving(facts = {}) {
    const fields=['rent','food','transport','utilities','dailyNeeds','otherNecessary','nonEssential','oneTime','workRelated','availableSavings','actualIncome'];
    const values=Object.fromEntries(fields.map((field)=>[field,number(facts[field],field,{min:0,max:1e10})]));
    const necessaryLiving=values.rent+values.food+values.transport+values.utilities+values.dailyNeeds+values.otherNecessary;
    const ordinarySpending=necessaryLiving+values.nonEssential+values.oneTime;
    const totalSpending=ordinarySpending+values.workRelated;
    const monthlyBalance=values.actualIncome-totalSpending;
    return {...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,round(value)])),necessaryLiving:round(necessaryLiving),ordinarySpending:round(ordinarySpending),totalSpending:round(totalSpending),monthlyBalance:round(monthlyBalance),savingsRate:values.actualIncome>EPSILON?round(monthlyBalance/values.actualIncome,4):null,costCoverage:necessaryLiving>EPSILON?round(values.actualIncome/necessaryLiving,4):null,savingsCoverageMonths:necessaryLiving>EPSILON?round(values.availableSavings/necessaryLiving,2):null,formulaVersion:1};
  }

  function forecastSavings(raw = {}) {
    const months=Math.round(number(raw.months || 12,'预测月数',{min:1,max:120,required:true}));
    const startSavings=number(raw.startSavings,'当前储蓄',{min:0,max:1e12});
    let income=number(raw.monthlyIncome,'预测月收入',{min:0,max:1e10});
    let spending=number(raw.monthlySpending,'预测月支出',{min:0,max:1e10});
    let necessary=number(raw.necessaryLiving,'必要生活费',{min:0,max:1e10});
    const safetyMonths=number(raw.safetyMonths || 3,'安全储蓄月数',{min:0,max:120});
    const incomeGrowth=Math.pow(1+number(raw.annualIncomeGrowth,'收入年增长率',{min:-99.99,max:1000})/100,1/12)-1;
    const spendingGrowth=Math.pow(1+number(raw.annualSpendingGrowth,'支出年增长率',{min:-99.99,max:1000})/100,1/12)-1;
    let savings=startSavings,belowSafetyMonth=null,exhaustedMonth=null;
    const points=[{month:0,income:round(income),spending:round(spending),savings:round(savings),safetyLine:round(necessary*safetyMonths),kind:'forecast'}];
    for(let month=1;month<=months;month+=1){income*=1+incomeGrowth;spending*=1+spendingGrowth;necessary*=1+spendingGrowth;savings+=income-spending;const safetyLine=necessary*safetyMonths;points.push({month,income:round(income),spending:round(spending),savings:round(savings),safetyLine:round(safetyLine),kind:'forecast'});if(belowSafetyMonth==null&&savings<safetyLine)belowSafetyMonth=month;if(exhaustedMonth==null&&savings<=0)exhaustedMonth=month;}
    return {points,belowSafetyMonth,exhaustedMonth,assumptions:{months,safetyMonths,annualIncomeGrowth:number(raw.annualIncomeGrowth,'收入年增长率',{min:-99.99,max:1000}),annualSpendingGrowth:number(raw.annualSpendingGrowth,'支出年增长率',{min:-99.99,max:1000})},formulaVersion:1};
  }

  function salaryTargets(raw = {}) {
    const necessaryLiving=number(raw.necessaryLiving,'必要生活支出',{min:0,max:1e10});
    const targetSavings=number(raw.targetSavings,'目标月储蓄',{min:0,max:1e10});
    const bufferRatio=number(raw.bufferRatio,'缓冲比例',{min:0,max:10});
    const survival=necessaryLiving,stable=necessaryLiving+targetSavings,target=stable*(1+bufferRatio);
    return {survival:round(survival),stable:round(stable),target:round(target),bufferRatio:round(bufferRatio,4),basis:'after-tax',formulaVersion:1};
  }

  function compareJobs(raw = {}) {
    const candidateBasis=raw.candidateBasis==='before-tax'?'before-tax':'after-tax';
    const currentIncome=number(raw.currentIncome,'当前到手收入',{min:0,max:1e10});
    const candidateListedSalary=number(raw.candidateSalary,'候选工资',{min:0,max:1e10});
    const candidateAfterTaxEstimate=number(raw.candidateAfterTaxEstimate,'候选税后估算',{min:0,max:1e10});
    if(candidateBasis==='before-tax'&&candidateAfterTaxEstimate<=0)return {comparable:false,reason:'候选工资为税前口径；请补充可信的税后到手估算后再比较。',basis:{current:'after-tax',candidate:'before-tax'},formulaVersion:1};
    const candidateIncome=candidateBasis==='before-tax'?candidateAfterTaxEstimate:candidateListedSalary;
    const currentWorkHours=number(raw.currentWorkHours,'当前工作时长',{min:0,max:1000});
    const currentDays=number(raw.currentDays,'当前工作天数',{min:0,max:366});
    const currentCommuteDaily=number(raw.currentCommuteDaily,'当前日均通勤时间',{min:0,max:24});
    const currentSpending=number(raw.currentSpending,'当前总支出',{min:0,max:1e10});
    const currentWorkRelated=number(raw.currentWorkRelated,'当前工作增量支出',{min:0,max:1e10});
    const candidateDays=number(raw.candidateDays,'候选工作天数',{min:0,max:366});
    const candidateDailyHours=number(raw.candidateDailyHours,'候选每日工时',{min:0,max:24});
    const candidateOvertimeHours=number(raw.candidateOvertimeHours,'候选预计加班',{min:0,max:1000});
    const candidateCommuteDaily=number(raw.candidateCommuteDaily,'候选日均通勤时间',{min:0,max:24});
    const candidateTransport=number(raw.candidateTransport,'候选工作交通费',{min:0,max:1e10});
    const candidateLivingDelta=number(raw.candidateLivingDelta,'生活成本变化',{min:-1e10,max:1e10});
    const candidateOtherCost=number(raw.candidateOtherCost,'其他必要支出变化',{min:-1e10,max:1e10});
    const currentOccupiedHours=currentWorkHours+currentDays*currentCommuteDaily;
    const candidateOccupiedHours=candidateDays*(candidateDailyHours+candidateCommuteDaily)+candidateOvertimeHours;
    const currentBalance=currentIncome-currentSpending;
    const candidateSpending=Math.max(0,currentSpending-currentWorkRelated+candidateTransport+candidateLivingDelta+candidateOtherCost);
    const candidateBalance=candidateIncome-candidateSpending;
    const currentDisposableHourly=currentOccupiedHours>EPSILON?currentBalance/currentOccupiedHours:null;
    const candidateDisposableHourly=candidateOccupiedHours>EPSILON?candidateBalance/candidateOccupiedHours:null;
    return {comparable:true,basis:{current:'after-tax',candidate:candidateBasis,candidateComparison:'after-tax'},currentIncome:round(currentIncome),candidateIncome:round(candidateIncome),incomeDifference:round(candidateIncome-currentIncome),currentSpending:round(currentSpending),candidateSpending:round(candidateSpending),currentBalance:round(currentBalance),candidateBalance:round(candidateBalance),balanceDifference:round(candidateBalance-currentBalance),currentOccupiedHours:round(currentOccupiedHours),candidateOccupiedHours:round(candidateOccupiedHours),occupiedHoursDifference:round(candidateOccupiedHours-currentOccupiedHours),currentDisposableHourly:currentDisposableHourly==null?null:round(currentDisposableHourly),candidateDisposableHourly:candidateDisposableHourly==null?null:round(candidateDisposableHourly),disposableHourlyDifference:currentDisposableHourly==null||candidateDisposableHourly==null?null:round(candidateDisposableHourly-currentDisposableHourly),formulaVersion:1};
  }

  function decisionSignals({salaryRecords=[],livingRecords=[],targets=null,comparison=null}={}) {
    const salaries=[...salaryRecords].sort((a,b)=>String(a.facts?.periodStart||'').localeCompare(String(b.facts?.periodStart||'')));
    const living=[...livingRecords].sort((a,b)=>String(a.facts?.month||'').localeCompare(String(b.facts?.month||'')));
    const signals=[];
    const latestLiving=living.at(-1)?.snapshot;
    if(living.slice(-2).length===2&&living.slice(-2).every((item)=>item.snapshot?.monthlyBalance<0))signals.push({level:'warning',text:'连续两期收支为负，值得开始检查支出或寻找收入改善机会。'});
    if(latestLiving?.savingsCoverageMonths!=null&&latestLiving.savingsCoverageMonths<3)signals.push({level:'warning',text:'可用储蓄不足 3 个月必要生活费，已接近常见安全线。'});
    const recentRates=salaries.slice(-3).map((item)=>item.snapshot?.averageHourlyRate).filter(Number.isFinite);
    if(recentRates.length===3&&recentRates[0]>recentRates[1]&&recentRates[1]>recentRates[2])signals.push({level:'info',text:'平均实际时薪连续三期下降，建议核对工时和收入变化。'});
    const pair=salaries.slice(-2);if(pair.length===2&&pair[1].snapshot?.overtimeTotalHours>pair[0].snapshot?.overtimeTotalHours&&pair[1].snapshot?.averageHourlyRate<=pair[0].snapshot?.averageHourlyRate)signals.push({level:'info',text:'最近一期加班增加，但平均实际时薪没有提高。'});
    if(targets&&salaries.length>=2&&salaries.slice(-2).every((item)=>item.snapshot?.totalSalary<targets.stable))signals.push({level:'warning',text:'当前工资连续低于稳定线，值得开始寻找更合适的机会，但这不等同于适合立即离职。'});
    if(comparison?.comparable&&comparison.balanceDifference<=0)signals.push({level:'info',text:'候选工作扣除新增生活与工作成本后，月度结余没有改善。'});
    return signals;
  }

  window.TaskFlowLaborLife={round,overtimeHours,calculateSalary,normalizeOvertimeInput,overtimePoint,analyzeOvertime,calculateLiving,forecastSavings,salaryTargets,compareJobs,decisionSignals};
})();
