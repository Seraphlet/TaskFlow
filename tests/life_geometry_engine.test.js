const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/playground/life-geometry-engine.js', 'utf8').replaceAll('export ', '');
const sandbox = { module:{exports:{}}, console, JSON, Math, Set };
vm.runInNewContext(`${source}\nmodule.exports={simulateLife,validatePersonTemplate,validateLifeResult,parseLifeImport};`, sandbox);
const { simulateLife, validatePersonTemplate, validateLifeResult } = sandbox.module.exports;

function template() { return {
  schemaVersion:'1.0',kind:'person-template',mode:'open',metadata:{fictional:true},
  person:{id:'p',name:'测试人物',birthConditions:{health:.8,resources:.7,mood:.6,education:.05,stability:.7},traits:{resilience:.8},expectedLifespan:85},
  relatedCharacters:[{id:'friend',name:'朋友',health:.8,expectedLifespan:90,birthOffset:0}],
  candidateEvents:[
    {id:'university',type:'education',title:'大学',preferredAge:18,ageRange:[18,22],probability:1,conditions:{minEducationOpportunity:.5,requiresFlags:['basic-education']},effects:{education:.3,flags:['university']},fallback:{type:'education-interrupted',title:'教育中断',effects:{flags:['education-interrupted']}}},
    {id:'career',type:'career',title:'学历职业',preferredAge:25,ageRange:[24,30],probability:1,conditions:{requiresFlags:['university']},effects:{flags:['career']}},
    {id:'late-marriage',type:'relationship',title:'晚年相遇',preferredAge:40,ageRange:[40,41],probability:1,conditions:{},effects:{}},
    {id:'natural-death',type:'death',title:'85 岁自然离世',preferredAge:85,ageRange:[85,85],probability:1,conditions:{},effects:{death:true}},
  ],
}; }
function world(id, overrides={}) { return {id,label:id,basis:'artistic-simulation',base:{educationOpportunity:.8,economy:.7,medicalCare:.7,mobility:.7,conflictRisk:0},stages:[{from:1900,to:2200,modifiers:{}}],incidents:[],...overrides}; }

const person=template(),calm=world('calm');
const first=simulateLife(person,calm,{birthYear:1950,seed:'same'}),second=simulateLife(person,calm,{birthYear:1950,seed:'same'});
assert.deepStrictEqual(first,second,'same person/world/year/seed must reproduce exactly');

const disrupted=world('disrupted',{base:{educationOpportunity:.2,economy:.3,medicalCare:.4,mobility:.3,conflictRisk:.6}});
const otherEra=simulateLife(person,disrupted,{birthYear:1950,seed:'same'});
assert.notDeepStrictEqual(first.events.map(e=>e.title),otherEra.events.map(e=>e.title),'different world rules must change actual events');
assert.ok(otherEra.events.some(e=>e.title==='教育中断'),'education must change when world opportunity is insufficient');
assert.ok(!otherEra.events.some(e=>e.title==='学历职业'),'career requiring university must not occur after interrupted education');

const fatal=world('fatal',{incidents:[{id:'fatal-27',from:1977,to:1977,probability:1,type:'death',title:'27 岁提前死亡',conditions:{minAge:27,maxAge:27},effects:{death:true}}]});
const shortLife=simulateLife(person,fatal,{birthYear:1950,seed:'same'});
const laterBirth=simulateLife(person,fatal,{birthYear:1980,seed:'same'});
assert.notDeepStrictEqual(shortLife.events.map(e=>e.title),laterBirth.events.map(e=>e.title),'same person and seed must change when birth year crosses a world incident');
assert.strictEqual(shortLife.characters[0].timelineEnd,27,'world event must be able to end a planned long life at 27');
assert.ok(!shortLife.events.some(e=>e.age>27&&e.characterId==='p'),'primary events after death must not occur');
assert.ok(shortLife.candidateResolutions.some(item=>item.candidateId==='natural-death'&&item.resolution==='terminated'),'planned natural death must be terminated');
assert.ok(shortLife.characters.find(item=>item.id==='friend').timelineEnd>27,'companion life must continue after protagonist death');
assert.ok(['primary-death','separation'].includes(shortLife.relationships[0].endedBy),'relationship end must be explicit and independent from companion death');

assert.ok(validatePersonTemplate(person).valid,'valid person template must pass');
assert.ok(validateLifeResult(first).valid,'simulation output must satisfy result contract');
const bad=JSON.parse(JSON.stringify(first));bad.relationships[0].toId='missing';
assert.ok(!validateLifeResult(bad).valid,'invalid character reference must be rejected');
console.log('Life Geometry deterministic simulation and causality tests passed');
