const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const context={window:{},Number,Math,Object,Array,String,Boolean,Set};
vm.runInNewContext(fs.readFileSync('js/labor-life.js','utf8'),context);
const api=context.window.TaskFlowLaborLife;

const salary=api.calculateSalary({totalSalary:10000,normalDays:20,dailyHours:8,overtime15Value:10,overtime15Unit:'hours',overtime20Value:1,overtime20Unit:'days',overtime30Value:0,overtime30Unit:'hours',bonus:1000,allowance:500,deductions:200});
assert.strictEqual(salary.normalHours,160);
assert.strictEqual(salary.overtime20Hours,8,'day based overtime uses daily hours');
assert.strictEqual(salary.totalWorkHours,178);
assert.strictEqual(salary.attributablePay,8700,'adjustments are removed from final take-home without double adding');
assert.strictEqual(salary.averageHourlyRate,56.18);
assert.strictEqual(salary.estimatedBaseHourlyRate,45.55);
assert.throws(()=>api.calculateSalary({totalSalary:1,normalDays:0,dailyHours:0}),/总时长/);

const monthly=api.calculateSalary({recordVersion:2,month:'2026-11',totalSalary:12000,actualWorkDays:25,dailyHours:8,weekdayOvertimeHours:10,weekendOvertimeDays:3,holidayOvertimeDays:0,bonus:0,allowance:0,deductions:0});
assert.strictEqual(monthly.formulaVersion,2);
assert.strictEqual(monthly.totalWorkHours,210,'weekend days are already included in actual work days');
assert.strictEqual(monthly.overtime20Hours,24,'weekend classification converts days using daily hours');
assert.strictEqual(monthly.averageHourlyRate,57.14);
assert.strictEqual(monthly.weightedHours,239,'weighted estimate separates ordinary, weekday overtime, and weekend work');
const mixedMonthly=api.calculateSalary({recordVersion:2,month:'2026-10',totalSalary:10000,actualWorkDays:24,dailyHours:8,weekdayOvertimeHours:4,weekendOvertimeDays:2,holidayOvertimeDays:1});
assert.strictEqual(mixedMonthly.totalWorkHours,196,'weekend and holiday days do not increase actual day count twice');
assert.strictEqual(mixedMonthly.overtime30Hours,8);
assert.throws(()=>api.calculateSalary({recordVersion:2,month:'2026-09',totalSalary:1,actualWorkDays:2,dailyHours:8,weekendOvertimeDays:2,holidayOvertimeDays:1}),/不能超过/);
assert.throws(()=>api.calculateSalary({recordVersion:2,month:'2026-09',totalSalary:1,actualWorkDays:0,dailyHours:8}),/总时长/);

const overtime=api.analyzeOvertime({scenario:'rest-day',baseHourlyRate:50,multiplier:2,durationValue:4,durationUnit:'hours',dailyHours:8,fixedCost:100,variableCostPerHour:5,commuteHours:2,restValuePerHour:20,fatigueCoefficient:3,maxHours:12});
assert.strictEqual(overtime.points[0].cashNetValue,0,'no overtime does not incur fixed cost');
assert.strictEqual(overtime.points[0].comprehensiveValue,0,'zero hours remains a legal candidate');
assert.strictEqual(overtime.selected.overtimeIncome,400);
assert.strictEqual(overtime.selected.cashNetValue,280);
assert.strictEqual(overtime.selected.comprehensiveValue,136);
assert(overtime.nodes.optimal.hours>=0&&overtime.nodes.optimal.hours<=12);

for(const multiplier of [1.5,2,3]){
  const result=api.analyzeOvertime({overtimeVersion:2,baseHourlyRate:40,multiplier,durationValue:1,maxHours:4});
  assert.strictEqual(result.selected.overtimeWage,40*multiplier,`${multiplier}x overtime wage is correct`);
}
const overtimeV2=api.analyzeOvertime({overtimeVersion:2,baseHourlyRate:50,multiplier:2,durationValue:2,taxiCost:30,mealCost:20,customExpenses:[{name:'额外饮料',amount:10},{name:'节省娱乐',amount:-15}],nightSubsidyMode:'fixed',nightSubsidyAmount:25,restValuePerHour:10,fatigueCoefficient:2,maxHours:6});
assert.strictEqual(overtimeV2.formulaVersion,2);
assert.strictEqual(overtimeV2.points[0].totalOvertimeIncome,0,'zero hours never earns subsidy');
assert.strictEqual(overtimeV2.points[0].fixedCost,0,'zero hours never incurs one-time costs');
assert.strictEqual(overtimeV2.selected.overtimeWage,200);
assert.strictEqual(overtimeV2.selected.nightSubsidy,25);
assert.strictEqual(overtimeV2.selected.totalOvertimeIncome,225);
assert.strictEqual(overtimeV2.selected.customExpenseNet,-5,'negative custom consumption increases cash value');
assert.strictEqual(overtimeV2.selected.cashNetValue,180);
assert.strictEqual(overtimeV2.selected.comprehensiveValue,156);
assert.strictEqual(overtimeV2.points[1].hours,.5,'V2 curves always use half-hour intervals');
assert.strictEqual(overtimeV2.rates[0].cashRate,60,'first discrete rate reflects the fixed subsidy and one-time costs');
assert(overtimeV2.jumps.length===1,'fixed subsidy and costs expose an activation jump');
const hourlySubsidy=api.analyzeOvertime({overtimeVersion:2,baseHourlyRate:50,multiplier:2,durationValue:2,nightSubsidyMode:'hourly',nightSubsidyAmount:8,maxHours:4});
assert.strictEqual(hourlySubsidy.selected.nightSubsidy,16);
assert.strictEqual(hourlySubsidy.selected.totalOvertimeIncome,216);
assert.strictEqual(hourlySubsidy.jumps.length,0,'hourly subsidy does not create a fixed activation jump');
const negativeChoice=api.analyzeOvertime({overtimeVersion:2,baseHourlyRate:0,multiplier:1.5,durationValue:2,restValuePerHour:10,maxHours:4});
assert.strictEqual(negativeChoice.allPositiveHoursNegative,true);
assert.strictEqual(negativeChoice.nodes.optimal.hours,0,'not working overtime remains the best legal candidate');
const fatigueTurn=api.analyzeOvertime({overtimeVersion:2,baseHourlyRate:50,multiplier:1.5,durationValue:2,fatigueCoefficient:30,maxHours:8});
assert(fatigueTurn.nodes.rateTurnsNegative,'discrete rate analysis finds a positive-to-negative interval');

const living=api.calculateLiving({actualIncome:10000,rent:2500,food:1500,transport:300,utilities:400,dailyNeeds:500,otherNecessary:300,nonEssential:800,oneTime:200,workRelated:500,availableSavings:30000});
assert.strictEqual(living.necessaryLiving,5500);
assert.strictEqual(living.totalSpending,7000);
assert.strictEqual(living.monthlyBalance,3000);
assert.strictEqual(living.savingsCoverageMonths,5.45);

const forecast=api.forecastSavings({startSavings:10000,monthlyIncome:4000,monthlySpending:5000,necessaryLiving:3000,safetyMonths:3,months:12,annualIncomeGrowth:0,annualSpendingGrowth:0});
assert.strictEqual(forecast.belowSafetyMonth,2);
assert.strictEqual(forecast.exhaustedMonth,10);
assert.strictEqual(forecast.points.length,13);

const targets=api.salaryTargets({necessaryLiving:5000,targetSavings:2000,bufferRatio:.2});
assert.deepStrictEqual(JSON.parse(JSON.stringify(targets)),{survival:5000,stable:7000,target:8400,bufferRatio:.2,basis:'after-tax',formulaVersion:1});

const blocked=api.compareJobs({currentIncome:9000,candidateBasis:'before-tax',candidateSalary:12000,candidateAfterTaxEstimate:0});
assert.strictEqual(blocked.comparable,false,'before-tax salary without a take-home estimate is not compared');
const compared=api.compareJobs({currentIncome:9000,currentWorkHours:176,currentDays:22,currentCommuteDaily:1,currentSpending:6500,currentWorkRelated:500,candidateBasis:'after-tax',candidateSalary:11000,candidateDays:22,candidateDailyHours:8,candidateOvertimeHours:10,candidateCommuteDaily:.5,candidateTransport:300,candidateLivingDelta:500,candidateOtherCost:100});
assert.strictEqual(compared.comparable,true);
assert.strictEqual(compared.balanceDifference,1600);
assert.strictEqual(compared.occupiedHoursDifference,-1);

console.log('Labor and life calculation tests passed');
