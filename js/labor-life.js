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

  function calculateSalaryLegacy(facts = {}) {
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

  function calculateSalaryV2(facts = {}) {
    const totalSalary=number(facts.totalSalary,'实际总工资',{min:0,max:1e9,required:true});
    const actualWorkDays=number(facts.actualWorkDays,'实际上班总天数',{min:0,max:366,required:true});
    const dailyHours=number(facts.dailyHours,'每天正常工作小时',{min:0,max:24,required:true});
    const weekdayOvertimeHours=number(facts.weekdayOvertimeHours,'工作日额外加班小时',{min:0,max:10000});
    const weekendOvertimeDays=number(facts.weekendOvertimeDays,'周六日加班天数',{min:0,max:366});
    const holidayOvertimeDays=number(facts.holidayOvertimeDays,'法定节假日加班天数',{min:0,max:366});
    if(weekendOvertimeDays+holidayOvertimeDays>actualWorkDays+EPSILON)throw new Error('周末与法定节假日加班天数不能超过实际上班总天数');
    const normalWeekdays=round(actualWorkDays-weekendOvertimeDays-holidayOvertimeDays,4);
    const normalHours=round(actualWorkDays*dailyHours,4);
    const overtime15Hours=round(weekdayOvertimeHours,4);
    const overtime20Hours=round(weekendOvertimeDays*dailyHours,4);
    const overtime30Hours=round(holidayOvertimeDays*dailyHours,4);
    const overtimeTotalHours=round(overtime15Hours+overtime20Hours+overtime30Hours,4);
    const totalWorkHours=round(normalHours+weekdayOvertimeHours,4);
    if(totalWorkHours<=0)throw new Error('实际工作总时长必须大于 0');
    const bonus=number(facts.bonus,'奖金',{min:0,max:1e9});
    const allowance=number(facts.allowance,'补贴',{min:0,max:1e9});
    const deductions=number(facts.deductions,'扣款',{min:0,max:1e9});
    const attributablePay=round(totalSalary-bonus-allowance+deductions,4);
    if(attributablePay<0)throw new Error('奖金与补贴不能超过实际工资加扣款，否则无法反推工时工资');
    const weightedHours=round(normalWeekdays*dailyHours+weekdayOvertimeHours*1.5+overtime20Hours*2+overtime30Hours*3,4);
    const estimatedBaseHourlyRate=weightedHours>EPSILON?round(attributablePay/weightedHours):null;
    const theoreticalOvertimePay=estimatedBaseHourlyRate==null?null:round(estimatedBaseHourlyRate*(weekdayOvertimeHours*1.5+overtime20Hours*2+overtime30Hours*3));
    return {totalSalary:round(totalSalary),actualWorkDays,normalWeekdays,dailyHours,normalHours,overtime15Hours,overtime20Hours,overtime30Hours,overtimeTotalHours,totalWorkHours,overtimeShare:optionalRatio(overtimeTotalHours,totalWorkHours),averageHourlyRate:round(totalSalary/totalWorkHours),attributablePay:round(attributablePay),weightedHours,estimatedBaseHourlyRate,theoreticalOvertimePay,formulaVersion:2};
  }

  function calculateSalary(facts = {}) {
    return facts.recordVersion===2||facts.month||Object.prototype.hasOwnProperty.call(facts,'actualWorkDays')?calculateSalaryV2(facts):calculateSalaryLegacy(facts);
  }

  function normalizeCustomExpenses(value) {
    return (Array.isArray(value) ? value : []).map((item,index)=>({
      id:String(item?.id||`custom-${index}`),
      name:String(item?.name||'自定义消费').trim().slice(0,80)||'自定义消费',
      amount:number(item?.amount,`自定义消费 ${index+1}`,{min:-1e9,max:1e9}),
    }));
  }

  function normalizeBonusTiers(value) {
    return (Array.isArray(value)?value:[]).map((item,index)=>({
      id:String(item?.id||`tier-${index}`),
      hours:number(item?.hours,`补贴档位 ${index+1} 的时长`,{min:.5,max:744}),
      amount:number(item?.amount,`补贴档位 ${index+1} 的金额`,{min:0,max:1e9}),
    })).sort((a,b)=>a.hours-b.hours);
  }

  function normalizeOvertimeInput(input = {}) {
    const requestedVersion=Number(input.overtimeVersion||0);
    const legacy=requestedVersion<2&&!['taxiCost','mealCost','nightSubsidyMode','customExpenses'].some((key)=>Object.prototype.hasOwnProperty.call(input,key));
    const dailyHours=number(input.dailyHours||8,'每日加班工时',{min:0.25,max:24,required:true});
    const rawHours=legacy?overtimeHours(input.durationValue||0,input.durationUnit||'hours',dailyHours,'加班时长'):number(input.durationValue,'加班时长',{min:0,max:744});
    const rawMax=number(input.maxHours||12,'最大可选加班时长',{min:0.5,max:744,required:true});
    const maxHours=round(Math.max(.5,Math.round(rawMax*2)/2),2);
    const enteredBase=number(input.baseHourlyRate,'正常时薪',{min:0,max:1e7,required:true});
    const normalWage=number(input.normalWage||0,'正常工资',{min:0,max:1e9});const normalPaidHours=number(input.normalPaidHours||0,'正常计薪工时',{min:0,max:10000});
    const normalHourlyRate=normalWage>0&&normalPaidHours>0?normalWage/normalPaidHours:enteredBase;
    const enteredMultiplier=number(input.multiplier||1.5,'加班倍率',{min:0,max:10,required:true});const directOvertimeRate=number(input.overtimeHourlyRate||0,'加班时薪',{min:0,max:1e7});
    const overtimeHourlyRate=input.overtimeRateMode==='hourly'&&directOvertimeRate>0?directOvertimeRate:normalHourlyRate*enteredMultiplier;
    const multiplier=normalHourlyRate>EPSILON?overtimeHourlyRate/normalHourlyRate:enteredMultiplier;
    return {
      modelVersion:legacy?1:(requestedVersion>=3?3:2),
      scenario:input.scenario==='rest-day'?'rest-day':'after-work',
      baseHourlyRate:round(normalHourlyRate,4),normalHourlyRate:round(normalHourlyRate,4),normalWage:round(normalWage,2),normalPaidHours:round(normalPaidHours,4),
      multiplier:round(multiplier,4),overtimeHourlyRate:round(overtimeHourlyRate,4),overtimeRateMode:input.overtimeRateMode==='hourly'?'hourly':'multiplier',
      selectedHours:legacy?rawHours:round(Math.round(rawHours*2)/2,2),
      dailyHours,
      maxHours,
      fixedCost:legacy?number(input.fixedCost,'额外固定支出',{min:0,max:1e9}):0,
      variableCostPerHour:legacy?number(input.variableCostPerHour,'每小时额外支出',{min:0,max:1e7}):0,
      commuteHours:legacy?number(input.commuteHours,'额外通勤时间',{min:0,max:48}):0,
      taxiCost:legacy?0:number(input.taxiCost,'打车费用',{min:0,max:1e9}),
      mealCost:legacy?0:number(input.mealCost,'外卖费用',{min:0,max:1e9}),
      fixedExtraCost:legacy?0:number(input.fixedExtraCost,'其他一次性费用',{min:0,max:1e9}),
      variableExtraCostPerHour:legacy?0:number(input.variableExtraCostPerHour,'每小时额外费用',{min:0,max:1e7}),
      extraOccupiedHours:legacy?0:number(input.extraOccupiedHours,'额外通勤及等待时间',{min:0,max:48}),
      minimumAcceptableHourly:legacy?0:number(input.minimumAcceptableHourly,'最低接受净时薪',{min:0,max:1e7}),
      customExpenses:legacy?[]:normalizeCustomExpenses(input.customExpenses),
      nightSubsidyMode:input.nightSubsidyMode==='hourly'?'hourly':'fixed',
      nightSubsidyAmount:legacy?0:number(input.nightSubsidyAmount,'夜班补贴',{min:0,max:1e9}),
      wageSettlementMode:input.wageSettlementMode==='complete-unit'?'complete-unit':'actual',
      settlementUnit:number(input.settlementUnit||.5,'工资结算单位',{min:.5,max:24}),
      partialUnitRule:input.partialUnitRule==='proportional'?'proportional':'discard',
      bonusMode:['threshold','tiers'].includes(input.bonusMode)?input.bonusMode:'none',
      bonusThresholdHours:number(input.bonusThresholdHours||0,'一次性补贴门槛',{min:0,max:744}),
      bonusThresholdAmount:number(input.bonusThresholdAmount||0,'一次性补贴金额',{min:0,max:1e9}),
      bonusTiers:normalizeBonusTiers(input.bonusTiers),
      legacyFixedCost:legacy?0:number(input.legacyFixedCost,'旧版固定支出',{min:0,max:1e9}),
      legacyVariableCostPerHour:legacy?0:number(input.legacyVariableCostPerHour,'旧版每小时支出',{min:0,max:1e7}),
      legacyCommuteHours:legacy?0:number(input.legacyCommuteHours,'旧版通勤时间',{min:0,max:48}),
      restValuePerHour:number(input.restValuePerHour,'休息时间价值',{min:0,max:1e7}),
      fatigueCoefficient:number(input.fatigueCoefficient,'疲劳成本系数',{min:0,max:1e7}),
      fatigueMode:['linear','quadratic','threshold'].includes(input.fatigueMode)?input.fatigueMode:'manual',
      fatigueMaxCoefficient:number(input.fatigueMaxCoefficient??10,'最大疲劳系数',{min:0,max:1e7}),
      fatigueThreshold:number(input.fatigueThreshold??40,'疲劳容忍阈值',{min:0,max:99}),
      fatigueRecords:Array.isArray(input.fatigueRecords)?input.fatigueRecords.filter(r=>r&&r.fatigue!=null&&Number.isFinite(Number(r.fatigue))&&Number.isFinite(Number(r.hours))&&Number(r.hours)>0).map(r=>({hours:Number(r.hours),fatigue:Math.max(0,Math.min(100,Number(r.fatigue)))})).sort((a,b)=>a.hours-b.hours):[],

    };
  }

  // Interpolate observations; beyond the last observation, hold its value as a scenario assumption.
  function fatigueAtHours(input,h) {
    const records=[{hours:0,fatigue:0},...input.fatigueRecords];
    if(records.length===1)return null;
    if(h<=0)return 0;
    const next=records.find(r=>r.hours>=h);
    if(!next)return records.at(-1).fatigue;
    const index=records.indexOf(next),prev=records[index-1]||records[0];
    return next.hours===prev.hours?next.fatigue:prev.fatigue+(next.fatigue-prev.fatigue)*(h-prev.hours)/(next.hours-prev.hours);
  }
  function fatigueCoefficientAt(input,h) {
    if(input.fatigueMode==='manual')return input.fatigueCoefficient;
    const score=fatigueAtHours(input,h);
    if(score==null)return 0;
    const x=score/100,max=input.fatigueMaxCoefficient;
    if(input.fatigueMode==='linear')return max*x;
    if(input.fatigueMode==='quadratic')return max*x*x;
    return max*Math.pow(Math.max(0,score-input.fatigueThreshold)/(100-input.fatigueThreshold),2);
  }

  function overtimePoint(input, hours) {
    const h = Math.max(0, Number(hours) || 0);
    const active = h > EPSILON;
    const settledHours=input.wageSettlementMode==='complete-unit'&&input.partialUnitRule==='discard'?Math.floor((h+EPSILON)/input.settlementUnit)*input.settlementUnit:h;
    const overtimeIncome = input.overtimeHourlyRate * settledHours;
    const customExpenseNet=input.customExpenses.reduce((sum,item)=>sum+item.amount,0);
    const fixedCost=active?(input.modelVersion===1?input.fixedCost:input.taxiCost+input.mealCost+input.fixedExtraCost+customExpenseNet+input.legacyFixedCost):0;
    const variableCost=(input.modelVersion===1?input.variableCostPerHour:input.variableExtraCostPerHour+input.legacyVariableCostPerHour)*h;
    const nightSubsidy=active&&input.modelVersion>=2?(input.nightSubsidyMode==='hourly'?input.nightSubsidyAmount*h:input.nightSubsidyAmount):0;
    let settlementBonus=0;
    if(active&&input.modelVersion>=3&&input.bonusMode==='threshold'&&h+EPSILON>=input.bonusThresholdHours)settlementBonus=input.bonusThresholdAmount;
    if(active&&input.modelVersion>=3&&input.bonusMode==='tiers')settlementBonus=input.bonusTiers.filter((tier)=>h+EPSILON>=tier.hours).at(-1)?.amount||0;
    const totalOvertimeIncome=overtimeIncome+nightSubsidy+settlementBonus;
    const normalPayBaseline=input.normalHourlyRate*h;
    const overtimePremium=totalOvertimeIncome-normalPayBaseline;
    const cashNetValue=totalOvertimeIncome-fixedCost-variableCost;
    const commuteHours=input.modelVersion===1?input.commuteHours:input.legacyCommuteHours;
    const actualOccupiedHours=active?h+commuteHours+input.extraOccupiedHours:0;
    const actualNetHourly=actualOccupiedHours>EPSILON?cashNetValue/actualOccupiedHours:null;
    const minimumAcceptableReturn=input.minimumAcceptableHourly*actualOccupiedHours;
    const acceptanceGap=cashNetValue-minimumAcceptableReturn;
    const restOpportunityCost=input.restValuePerHour*actualOccupiedHours;
    const fatigueCost = fatigueCoefficientAt(input,h) * h * h / 2;
    const comprehensiveValue = cashNetValue - restOpportunityCost - fatigueCost;
    const subsidyHourly=input.modelVersion>=2&&input.nightSubsidyMode==='hourly'?input.nightSubsidyAmount:0;
    const marginalNetValue=input.overtimeHourlyRate+subsidyHourly-(input.modelVersion===1?input.variableCostPerHour:input.variableExtraCostPerHour+input.legacyVariableCostPerHour)-input.restValuePerHour-(input.fatigueMode==='manual'?input.fatigueCoefficient*h:(h>0?(fatigueCoefficientAt(input,h)*h*h-fatigueCoefficientAt(input,Math.max(0,h-.01))*Math.max(0,h-.01)**2)/.02:0));
    return {hours:round(h,4),settledHours:round(settledHours,4),overtimeIncome:round(overtimeIncome),overtimeWage:round(overtimeIncome),nightSubsidy:round(nightSubsidy),settlementBonus:round(settlementBonus),totalOvertimeIncome:round(totalOvertimeIncome),actualIncrementalIncome:round(totalOvertimeIncome),normalPayBaseline:round(normalPayBaseline),overtimePremium:round(overtimePremium),premiumPerHour:h>EPSILON?round(overtimePremium/h):0,totalMultiplier:input.normalHourlyRate>EPSILON?round(input.overtimeHourlyRate/input.normalHourlyRate,4):null,premiumMultiplier:input.normalHourlyRate>EPSILON?round(input.overtimeHourlyRate/input.normalHourlyRate-1,4):null,taxiCost:round(active?input.taxiCost:0),mealCost:round(active?input.mealCost:0),customExpenseNet:round(active?customExpenseNet:0),fixedCost:round(fixedCost),variableCost:round(variableCost),extraCosts:round(fixedCost+variableCost),cashNetValue:round(cashNetValue),actualOccupiedHours:round(actualOccupiedHours,4),actualNetHourly:actualNetHourly==null?null:round(actualNetHourly),minimumAcceptableReturn:round(minimumAcceptableReturn),acceptanceGap:round(acceptanceGap),restOpportunityCost:round(restOpportunityCost),fatigueCost:round(fatigueCost),mappedFatigue:fatigueAtHours(input,h),effectiveFatigueCoefficient:round(fatigueCoefficientAt(input,h),4),fatigueEstimateAvailable:input.fatigueMode==='manual'||input.fatigueRecords.length>0,comprehensiveValue:round(comprehensiveValue),marginalNetValue:round(marginalNetValue)};
  }

  function overtimeSettlementPoints(input) {
    const points=[];
    if(input.modelVersion>=3&&input.wageSettlementMode==='complete-unit'&&input.partialUnitRule==='discard')for(let hours=input.settlementUnit;hours<=input.maxHours+EPSILON;hours+=input.settlementUnit)points.push({hours:round(hours,4),kind:'wage-unit',label:`满 ${round(hours,2)} 小时工资结算`});
    if(input.modelVersion>=3&&input.bonusMode==='threshold'&&input.bonusThresholdHours>0&&input.bonusThresholdHours<=input.maxHours)points.push({hours:input.bonusThresholdHours,kind:'bonus',label:`达到 ${round(input.bonusThresholdHours,2)} 小时补贴门槛`});
    if(input.modelVersion>=3&&input.bonusMode==='tiers')input.bonusTiers.filter((tier)=>tier.hours<=input.maxHours).forEach((tier)=>points.push({hours:tier.hours,kind:'bonus',label:`达到 ${round(tier.hours,2)} 小时补贴档位`}));
    return points.sort((a,b)=>a.hours-b.hours).filter((item,index,list)=>index===0||Math.abs(item.hours-list[index-1].hours)>EPSILON||item.kind!==list[index-1].kind);
  }

  function firstPoint(points, predicate, start = 1) {
    for (let index=start; index<points.length; index+=1) if (predicate(points[index], points[index-1], index)) return points[index];
    return null;
  }

  function analyzeOvertime(rawInput = {}, step = 0.5) {
    const input=normalizeOvertimeInput(rawInput);
    const safeStep=input.modelVersion>=2?.5:Math.max(0.05,Math.min(1,Number(step)||.5));
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
    const rates=points.slice(1).map((point,index)=>{const previous=points[index];const width=point.hours-previous.hours;return {fromHours:previous.hours,toHours:point.hours,hours:point.hours,cashRate:round((point.cashNetValue-previous.cashNetValue)/width),comprehensiveRate:round((point.comprehensiveValue-previous.comprehensiveValue)/width)};});
    const zeroCrossings=[];for(let index=1;index<points.length;index+=1){const previous=points[index-1],point=points[index];if((previous.comprehensiveValue<=0&&point.comprehensiveValue>0)||(previous.comprehensiveValue>=0&&point.comprehensiveValue<0))zeroCrossings.push({fromHours:previous.hours,toHours:point.hours,fromValue:previous.comprehensiveValue,toValue:point.comprehensiveValue});}
    const rateTurnsNegative=firstPoint(rates,(point,previous)=>previous.comprehensiveRate>0&&point.comprehensiveRate<=0);
    const customExpenseNet=input.customExpenses.reduce((sum,item)=>sum+item.amount,0);
    const oneTimeCost=input.modelVersion>=2?input.taxiCost+input.mealCost+input.fixedExtraCost+customExpenseNet+input.legacyFixedCost:input.fixedCost;
    const fixedSubsidy=input.modelVersion>=2&&input.nightSubsidyMode==='fixed'?input.nightSubsidyAmount:0;
    const activation={totalOvertimeIncome:round(fixedSubsidy),overtimePremium:round(fixedSubsidy),cashNetValue:round(fixedSubsidy-oneTimeCost),comprehensiveValue:round(fixedSubsidy-oneTimeCost-input.restValuePerHour*(input.modelVersion>=2?input.legacyCommuteHours:input.commuteHours))};
    const jumps=Math.abs(activation.totalOvertimeIncome)>EPSILON||Math.abs(oneTimeCost)>EPSILON?[{fromHours:0,toHours:points[1]?.hours||safeStep,amount:round(activation.cashNetValue),label:'一次性支出 / 固定补贴'}]:[];
    const allPositiveHoursNegative=points.slice(1).every((point)=>point.comprehensiveValue<0);
    const acceptable=points.slice(1).filter((point)=>point.acceptanceGap>=-EPSILON);const acceptableRanges=[];for(const point of acceptable){const previous=acceptableRanges.at(-1);if(previous&&Math.abs(point.hours-previous.toHours-safeStep)<EPSILON)previous.toHours=point.hours;else acceptableRanges.push({fromHours:point.hours,toHours:point.hours});}
    const acceptancePoint=acceptable[0]||null;
    const settlementPoints=overtimeSettlementPoints(input);const nextSettlement=settlementPoints.find((item)=>item.hours>selected.hours+EPSILON)||null;
    const nextPoint=nextSettlement?overtimePoint(input,nextSettlement.hours):null;const nextSettlementDelta=nextSettlement?{...nextSettlement,extraHours:round(nextSettlement.hours-selected.hours,2),extraIncome:round(nextPoint.totalOvertimeIncome-selected.totalOvertimeIncome),extraPremium:round(nextPoint.overtimePremium-selected.overtimePremium)}:null;
    return {input,points,rates,selected,activation,jumps,settlementPoints,nextSettlement:nextSettlementDelta,acceptableRanges,noAcceptableOvertime:acceptable.length===0,nodes:{cashBreakEven,acceptancePoint,comprehensiveBreakEven,optimal,negativeAfterPositive,zeroCrossings,rateTurnsNegative},allPositiveHoursNegative,formulaVersion:input.modelVersion};
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

  const OVERTIME_DECISION_RULES=Object.freeze({
    lowWillingnessMax:25,
    highWillingnessMin:75,
    highFatigueMin:75,
    meaningfulChange:20,
    staleAfterHours:6
  });

  function overtimeDecisionContext({analysis,records=[],decisionDate='',referenceTime=Date.now(),rules=OVERTIME_DECISION_RULES}={}) {
    if(!analysis?.points?.length)throw new Error('缺少加班分析结果');
    const matching=(Array.isArray(records)?records:[]).filter((item)=>!decisionDate||item?.decisionDate===decisionDate).sort((a,b)=>String(a.observedAt||a.createdAt||'').localeCompare(String(b.observedAt||b.createdAt||'')));
    const latest=matching.at(-1)||null,latestTime=latest?Date.parse(latest.observedAt||latest.createdAt||''):NaN,referenceMs=referenceTime instanceof Date?referenceTime.getTime():Number.isFinite(Number(referenceTime))?Number(referenceTime):Date.parse(referenceTime);
    const ageHours=Number.isFinite(latestTime)&&Number.isFinite(referenceMs)?Math.max(0,(referenceMs-latestTime)/3600000):null;
    const stale=Boolean(latest)&&(ageHours==null||ageHours>Number(rules.staleAfterHours));
    const currentRecord=latest&&!stale?latest:null,previousRecord=currentRecord&&matching.length>1?matching.at(-2):null;
    const plannedHours=Number(analysis.selected?.hours||0),actualHours=currentRecord?Number(currentRecord.hours||0):plannedHours;
    const currentPoint=analysis.points.find((point)=>Math.abs(point.hours-actualHours)<1e-9)||analysis.points.reduce((best,point)=>Math.abs(point.hours-actualHours)<Math.abs(best.hours-actualHours)?point:best,analysis.points[0]);
    const optimalHours=Number(analysis.nodes?.optimal?.hours||0),willingness=currentRecord?.willingness==null?null:Number(currentRecord.willingness),fatigue=currentRecord?.fatigue==null?null:Number(currentRecord.fatigue);
    const willingnessDelta=willingness!=null&&previousRecord?.willingness!=null?willingness-Number(previousRecord.willingness):null;
    const nextSettlement=(analysis.settlementPoints||[]).find((point)=>point.hours>currentPoint.hours+1e-9)||null;
    const nextPoint=nextSettlement?(analysis.points.find((point)=>Math.abs(point.hours-nextSettlement.hours)<1e-9)||null):null;
    return {
      rules,matching,latest,currentRecord,previousRecord,stale,ageHours,plannedHours,actualHours:currentPoint.hours,currentPoint,optimalHours,nextSettlement,nextPoint,willingness,fatigue,willingnessDelta,
      lowWillingness:willingness!=null&&willingness<=Number(rules.lowWillingnessMax),
      highWillingness:willingness!=null&&willingness>=Number(rules.highWillingnessMin),
      highFatigue:fatigue!=null&&fatigue>=Number(rules.highFatigueMin),
      willingnessChangedMeaningfully:willingnessDelta!=null&&Math.abs(willingnessDelta)>=Number(rules.meaningfulChange),
      economicPositive:Number(currentPoint.cashNetValue)>0,
      comprehensivePositive:Number(currentPoint.comprehensiveValue)>=0,
      meetsPersonalThreshold:Number(currentPoint.acceptanceGap)>=0,
      positionToOptimal:currentPoint.hours>optimalHours+1e-9?'after':currentPoint.hours<optimalHours-1e-9?'before':'at'
    };
  }

  window.TaskFlowLaborLife={round,overtimeHours,calculateSalary,calculateSalaryLegacy,calculateSalaryV2,normalizeOvertimeInput,overtimePoint,overtimeSettlementPoints,analyzeOvertime,calculateLiving,forecastSavings,salaryTargets,compareJobs,decisionSignals,OVERTIME_DECISION_RULES,overtimeDecisionContext};
})();
