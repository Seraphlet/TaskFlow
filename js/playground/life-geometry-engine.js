const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,Number(value)||0));
const copy=(value)=>JSON.parse(JSON.stringify(value));

function hash(value){let result=2166136261;for(const char of String(value)){result^=char.charCodeAt(0);result=Math.imul(result,16777619);}return result>>>0;}
function keyedRandom(seed,key){let value=hash(`${seed}|${key}`);value+=0x6D2B79F5;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296;}
function issue(path,message){return{path,message};}
function isObject(value){return value&&typeof value==='object'&&!Array.isArray(value);}

export function validatePersonTemplate(value){
  const errors=[];
  if(!isObject(value))return{valid:false,errors:[issue('$','必须是 JSON 对象')]};
  if(value.kind!=='person-template')errors.push(issue('kind','必须为 person-template'));
  if(value.schemaVersion!=='1.0')errors.push(issue('schemaVersion','当前仅支持 1.0'));
  if(value.mode!=='open')errors.push(issue('mode','人物模板必须为 open'));
  if(!value.person?.id||!value.person?.name)errors.push(issue('person','需要 id 和 name'));
  if(!Array.isArray(value.candidateEvents))errors.push(issue('candidateEvents','必须是数组'));
  const ids=new Set([value.person?.id,...(value.relatedCharacters||[]).map(item=>item.id)]);
  for(const [index,event] of (value.candidateEvents||[]).entries()){
    if(!event.id||!event.type||!event.title)errors.push(issue(`candidateEvents[${index}]`,'需要 id、type 和 title'));
    if(!Array.isArray(event.ageRange)||event.ageRange.length!==2)errors.push(issue(`candidateEvents[${index}].ageRange`,'需要 [最早年龄, 最晚年龄]'));
    if(event.relationship?.characterId&&!ids.has(event.relationship.characterId))errors.push(issue(`candidateEvents[${index}].relationship.characterId`,'引用了不存在的人物'));
  }
  return{valid:errors.length===0,errors};
}

export function validateLifeResult(value){
  const errors=[];
  if(!isObject(value))return{valid:false,errors:[issue('$','必须是 JSON 对象')]};
  if(value.kind!=='life-result')errors.push(issue('kind','必须为 life-result'));
  if(value.schemaVersion!=='1.0')errors.push(issue('schemaVersion','当前仅支持 1.0'));
  if(!['age','story-time'].includes(value.timelineType))errors.push(issue('timelineType','必须为 age 或 story-time'));
  if(!Array.isArray(value.characters)||!value.characters.length)errors.push(issue('characters','至少需要一个人物'));
  if(!Array.isArray(value.events))errors.push(issue('events','必须是数组'));
  if(!Number.isFinite(Number(value.endAge))||Number(value.endAge)<0)errors.push(issue('endAge','必须是非负时间终点'));
  const ids=new Set((value.characters||[]).map(item=>item.id));
  if(!ids.has(value.primaryCharacterId))errors.push(issue('primaryCharacterId','主角引用无效'));
  for(const [index,event] of (value.events||[]).entries())if(!ids.has(event.characterId))errors.push(issue(`events[${index}].characterId`,'人物引用无效'));
  for(const [index,relation] of (value.relationships||[]).entries())if(!ids.has(relation.fromId)||!ids.has(relation.toId))errors.push(issue(`relationships[${index}]`,'关系人物引用无效'));
  return{valid:errors.length===0,errors};
}

export function parseLifeImport(value){
  const parsed=typeof value==='string'?JSON.parse(value):value;
  const check=parsed?.kind==='person-template'?validatePersonTemplate(parsed):validateLifeResult(parsed);
  if(!check.valid)throw new Error(check.errors.map(item=>`${item.path}：${item.message}`).join('；'));
  return copy(parsed);
}

function worldAt(world,year){
  const result={...world.base};
  for(const stage of world.stages||[])if(year>=stage.from&&year<=stage.to)for(const[key,value]of Object.entries(stage.modifiers||{}))result[key]=clamp((result[key]||0)+value);
  return result;
}
function conditionsPass(conditions,state,world,template){
  const checks=conditions||{};
  if(checks.requiresFlags?.some(flag=>!state.flags.has(flag)))return false;
  if(checks.minEducationOpportunity!=null&&world.educationOpportunity<checks.minEducationOpportunity)return false;
  if(checks.minResources!=null&&state.resources<checks.minResources)return false;
  if(checks.minEconomy!=null&&world.economy<checks.minEconomy)return false;
  if(checks.minMobility!=null&&world.mobility<checks.minMobility)return false;
  if(checks.minResilience!=null&&(template.person.traits?.resilience||0)<checks.minResilience)return false;
  if(checks.requiresCharacter&&!template.relatedCharacters?.some(item=>item.id===checks.requiresCharacter))return false;
  return true;
}
function applyEffects(state,effects={}){
  for(const key of ['health','resources','mood','education','stability'])if(effects[key]!=null)state[key]=clamp(state[key]+effects[key]);
  for(const flag of effects.flags||[])state.flags.add(flag);
  for(const flag of effects.removeFlags||[])state.flags.delete(flag);
  if(effects.death)state.alive=false;
}
function stateSnapshot(state){return Object.fromEntries(['health','resources','mood','education','stability'].map(key=>[key,state[key]]));}

export function simulateLife(template,world,options={}){
  const validation=validatePersonTemplate(template);if(!validation.valid)throw new Error(validation.errors.map(item=>`${item.path}：${item.message}`).join('；'));
  if(!world?.id||!world?.base)throw new Error('世界规则缺少 id 或 base');
  const birthYear=Number(options.birthYear)||1988,seed=String(options.seed||'life-geometry');
  const person=template.person,initial=person.birthConditions||{};
  const state={health:clamp(initial.health??.7),resources:clamp(initial.resources??.5),mood:clamp(initial.mood??.55),education:clamp(initial.education??.05),stability:clamp(initial.stability??.6),alive:true,flags:new Set()};
  const events=[],annualStates=[],candidateResolutions=[],processedIncidents=new Set(),processedCandidates=new Set();
  const addEvent=(age,event,resolution,source='candidate')=>{applyEffects(state,event.effects);events.push({id:`${source}-${event.id}-${age}`,characterId:person.id,age,year:birthYear+age,type:event.type,title:event.title,description:event.description||'',resolution,source,stateSnapshot:stateSnapshot(state)});};
  addEvent(0,{id:'birth',type:'birth',title:`${person.name}出生`,description:'一条生命线在世界中开始延伸。',effects:{}},'preserved','system');
  let deathAge=null;
  const maxAge=Math.max(100,Number(person.expectedLifespan||85)+8);
  for(let age=0;age<=maxAge&&state.alive;age++){
    const year=birthYear+age,currentWorld=worldAt(world,year);
    if(age===6){state.flags.add('basic-education');addEvent(age,{id:'basic-school',type:'education',title:'开始认识更大的世界',description:'阅读、游戏与身边的人构成最早的学习。',effects:{education:.08}},'preserved','system');}
    state.health=clamp(state.health-(age>52?.006:.001)+currentWorld.medicalCare*.0015);
    state.mood=clamp(state.mood+(keyedRandom(seed,`mood-${age}`)-.5)*.025);
    for(const incident of world.incidents||[]){
      if(processedIncidents.has(incident.id)||year<incident.from||year>incident.to)continue;
      const c=incident.conditions||{};if(age<(c.minAge??0)||age>(c.maxAge??120))continue;
      if(keyedRandom(seed,`world-${incident.id}`)<Number(incident.probability||0)){processedIncidents.add(incident.id);addEvent(age,incident,'changed','world');if(!state.alive){deathAge=age;break;}}
    }
    if(!state.alive)break;
    for(const candidate of template.candidateEvents){
      if(processedCandidates.has(candidate.id))continue;
      const [start,end]=candidate.ageRange; if(age<start||age>end)continue;
      const conditionsOk=conditionsPass(candidate.conditions,state,currentWorld,template);
      const preferred=Number(candidate.preferredAge??start);
      const chance=keyedRandom(seed,`candidate-${candidate.id}`);
      if(conditionsOk&&age>=preferred&&chance<Number(candidate.probability??1)){
        processedCandidates.add(candidate.id);addEvent(age,candidate,age===preferred?'preserved':'delayed');candidateResolutions.push({candidateId:candidate.id,resolution:age===preferred?'preserved':'delayed',age});if(!state.alive){deathAge=age;break;}
      }else if(age===end){
        processedCandidates.add(candidate.id);
        if(candidate.fallback){addEvent(age,{id:`${candidate.id}-fallback`,...candidate.fallback},'changed');candidateResolutions.push({candidateId:candidate.id,resolution:'changed',age});}
        else candidateResolutions.push({candidateId:candidate.id,resolution:'cancelled',age});
      }
    }
    annualStates.push({age,year,...stateSnapshot(state),alive:state.alive});
    if(!state.alive){deathAge=age;break;}
  }
  deathAge=deathAge??annualStates.at(-1)?.age??0;
  for(const candidate of template.candidateEvents)if(!processedCandidates.has(candidate.id))candidateResolutions.push({candidateId:candidate.id,resolution:'terminated',age:deathAge,reason:'primary-death'});
  const characters=[{id:person.id,name:person.name,role:'primary',timelineStart:0,timelineEnd:deathAge,lifeEndReason:events.at(-1)?.type==='death'?'death':'end',annualStates}];
  const relationships=[];
  for(const companion of template.relatedCharacters||[]){
    const startAge=Math.max(5,12+Math.round(keyedRandom(seed,`meet-${companion.id}`)*8));
    const naturalEnd=Math.max(startAge+8,Number(companion.expectedLifespan||80)-Number(companion.birthOffset||0));
    const timelineEnd=Math.min(Math.max(deathAge+5,startAge+10),naturalEnd);
    const companionStates=[];
    for(let age=startAge;age<=timelineEnd;age++)companionStates.push({age,year:birthYear+age,health:clamp((companion.health||.72)-Math.max(0,age-55)*.008),resources:clamp(.45+keyedRandom(seed,`${companion.id}-resources-${age}`)*.2),mood:clamp(.48+keyedRandom(seed,`${companion.id}-mood-${age}`)*.24),education:.45,stability:.58,alive:true});
    characters.push({id:companion.id,name:companion.name,role:'companion',timelineStart:startAge,timelineEnd,lifeEndReason:timelineEnd>deathAge?'continues':'death',annualStates:companionStates});
    events.push({id:`meet-${companion.id}`,characterId:companion.id,age:startAge,year:birthYear+startAge,type:'relationship',title:`遇见${companion.name}`,description:'两条生命线短暂靠近，彼此改变了方向。',resolution:'generated'});
    const separationAge=Math.min(timelineEnd,startAge+14);
    relationships.push({id:`relation-${person.id}-${companion.id}`,fromId:person.id,toId:companion.id,segments:[{fromAge:startAge,toAge:separationAge,status:'close'},{fromAge:separationAge,toAge:Math.min(deathAge,timelineEnd),status:'distant'}],endedBy:deathAge<=timelineEnd?'primary-death':'separation'});
  }
  events.sort((a,b)=>a.age-b.age||a.id.localeCompare(b.id));
  const endAge=Math.max(deathAge,...characters.map(item=>item.timelineEnd));
  return{schemaVersion:'1.0',kind:'life-result',metadata:{title:`${person.name}的一生`,mode:'open',fictional:Boolean(template.metadata?.fictional),basis:world.basis||'artistic-simulation',worldId:world.id,worldLabel:world.label,birthYear,seed,dataVersion:'art-world-v1'},timelineType:'age',primaryCharacterId:person.id,characters,events,relationships,candidateResolutions,endAge};
}
