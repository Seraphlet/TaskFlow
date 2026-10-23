const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/playground/life-geometry-layout.js', 'utf8').replaceAll('export ', '');
const sandbox = { module:{exports:{}}, Math, Map, Set, Object };
vm.runInNewContext(`${source}\nmodule.exports={relationshipMetricsAt,ensembleFrame,visibleTrackIds};`, sandbox);
const { relationshipMetricsAt, ensembleFrame, visibleTrackIds } = sandbox.module.exports;

const relation={fromId:'main',toId:'friend',segments:[
  {fromAge:10,toAge:20,status:'close'},
  {fromAge:20,toAge:40,status:'distant'},
  {fromAge:40,toAge:42,status:'reconnecting'},
  {fromAge:42,toAge:60,status:'close'},
]};
assert.ok(relationshipMetricsAt(relation,15).closeness>.7,'companionship must keep tracks near');
assert.ok(relationshipMetricsAt(relation,30).visibility<.25,'lost contact must fade without deleting data');
assert.ok(relationshipMetricsAt(relation,41).visibility>.6,'reconnecting must bring a track back');
assert.ok(relationshipMetricsAt(relation,70).visibility<.06,'ended history must remain data but leave the visible field');

const characters=[
  {id:'main',role:'primary',timelineStart:0,timelineEnd:80},
  {id:'friend',role:'friend',timelineStart:0,timelineEnd:90},
  {id:'friend-of-friend',role:'friend',timelineStart:0,timelineEnd:90},
];
const relationships=[relation,{fromId:'friend',toId:'friend-of-friend',segments:[{fromAge:10,toAge:60,status:'close'}]}];
const frame=ensembleFrame({characters,relationships,primaryId:'main',time:15,baseLanes:[0,.25,-.3],baseOffsets:[2,18,-12]});
const main=frame.find((item)=>item.id==='main'),friend=frame.find((item)=>item.id==='friend'),network=frame.find((item)=>item.id==='friend-of-friend');
assert.strictEqual(main.lane,0,'the observed protagonist must stay at the visual center');
assert.ok(Math.abs(friend.lane)<.25,'a close friend must approach the protagonist while retaining an independent line');
assert.ok(network.visibility>.1,'relationships between non-primary people must propagate into the ensemble view');

const afterMainDeath=ensembleFrame({characters,relationships,primaryId:'main',time:85,baseLanes:[0,.25,-.3],baseOffsets:[2,18,-12]});
assert.ok(afterMainDeath.find((item)=>item.id==='friend').visibility>=.44,'survivors must remain visible after the protagonist dies');
assert.ok(afterMainDeath.find((item)=>item.id==='friend-of-friend').visibility>=.44,'the surviving ensemble must continue on the shared world timeline');

const many=Array.from({length:12},(_,index)=>({id:index?'p'+index:'main',role:index?'companion':'primary',timelineStart:0,timelineEnd:100}));
const manyFrame=many.map((character,index)=>({id:character.id,visibility:1-index/20}));
const visible=visibleTrackIds(manyFrame,many,20,8);
assert.strictEqual(visible.length,8,'rendering must cap simultaneous visible tracks');
assert.ok(visible.includes('main'),'the observed protagonist must remain selected');

console.log('Life Geometry V4 relationship-driven layout tests passed');
