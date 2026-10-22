export const LIFE_SCHEMA_VERSION = '1.0';
export const LIFE_DATA_VERSION = 'art-world-v1';

export const WORLD_PACKS = [
  {
    id:'harbor-renewal', label:'潮港 · 复苏年代', region:'虚构潮港', basis:'artistic-simulation',
    summary:'受现实规律启发的虚构世界：教育和流动机会逐步增加，医疗缓慢改善。',
    base:{educationOpportunity:.68,economy:.62,medicalCare:.66,mobility:.65,conflictRisk:.05},
    stages:[
      {from:1940,to:1969,modifiers:{educationOpportunity:-.18,economy:-.12,medicalCare:-.2,mobility:-.08}},
      {from:1970,to:1999,modifiers:{educationOpportunity:.02,economy:.04,medicalCare:.02,mobility:.02}},
      {from:2000,to:2100,modifiers:{educationOpportunity:.16,economy:.12,medicalCare:.2,mobility:.14}},
    ], incidents:[],
  },
  {
    id:'harbor-turbulence', label:'潮港 · 风暴年代', region:'虚构潮港', basis:'artistic-simulation',
    summary:'虚构动荡世界：部分年份会发生迁徙、失学或生命风险，仅用于验证规则机制。',
    base:{educationOpportunity:.56,economy:.5,medicalCare:.5,mobility:.42,conflictRisk:.2},
    stages:[
      {from:1940,to:1960,modifiers:{educationOpportunity:.02,economy:.06,medicalCare:-.05,mobility:.02}},
      {from:1961,to:1978,modifiers:{educationOpportunity:-.34,economy:-.28,medicalCare:-.22,mobility:-.2,conflictRisk:.5}},
      {from:1979,to:2100,modifiers:{educationOpportunity:.18,economy:.15,medicalCare:.2,mobility:.2,conflictRisk:-.12}},
    ],
    incidents:[
      {id:'school-closure',from:1961,to:1978,probability:.82,type:'education-interrupted',title:'求学道路中断',description:'动荡使学校停课，原定的求学道路无法继续。',conditions:{minAge:8,maxAge:24},effects:{education:-.16,stability:-.12,flags:['education-interrupted'],removeFlags:['university']}},
      {id:'forced-migration',from:1964,to:1974,probability:.42,type:'migration',title:'被迫迁往别处',description:'生活环境的变化迫使一家人离开熟悉的地方。',conditions:{minAge:4,maxAge:55},effects:{resources:-.2,stability:-.25,mood:-.12,flags:['displaced']}},
      {id:'storm-loss',from:1966,to:1972,probability:.12,type:'death',title:'生命止于风暴',description:'时代的风暴过早终止了这段生命。',conditions:{minAge:15,maxAge:45},effects:{death:true}},
    ],
  },
  {
    id:'glass-city', label:'玻璃城 · 高速年代', region:'虚构玻璃城', basis:'artistic-simulation',
    summary:'高流动、高教育机会也伴随压力的虚构现代城市。',
    base:{educationOpportunity:.82,economy:.72,medicalCare:.8,mobility:.86,conflictRisk:.02},
    stages:[{from:1940,to:2100,modifiers:{}}],
    incidents:[
      {id:'economic-shock',from:2007,to:2010,probability:.34,type:'career-change',title:'工作被迫转向',description:'经济收缩让原有工作中断，新的方向在不确定中出现。',conditions:{minAge:20,maxAge:62},effects:{resources:-.14,stability:-.16,flags:['career-redirected']}},
    ],
  },
];

export const DEFAULT_PERSON_TEMPLATE = {
  schemaVersion:LIFE_SCHEMA_VERSION, kind:'person-template', mode:'open',
  metadata:{title:'林汐的候选人生',fictional:true,basis:'artistic-simulation',description:'用于展示同一人物如何被不同时代重新推演。'},
  person:{id:'lin-xi',name:'林汐',region:'虚构潮港',birthConditions:{health:.82,resources:.68,mood:.64,education:.08,stability:.72},traits:{curiosity:.84,resilience:.69,sociability:.62},expectedLifespan:85},
  relatedCharacters:[{id:'zhou-ning',name:'周宁',role:'旧友',birthOffset:1,health:.76,expectedLifespan:82}],
  candidateEvents:[
    {id:'university',type:'education',title:'进入大学',description:'她离开海边，开始一段更广阔的学习。',preferredAge:18,ageRange:[18,22],probability:.9,conditions:{minEducationOpportunity:.5,minResources:.34,requiresFlags:['basic-education']},effects:{education:.3,resources:-.08,mood:.08,flags:['university']},fallback:{type:'education-alternative',title:'以另一种方式继续学习',description:'原定求学道路关闭后，她在工作与自学中积累能力。',effects:{education:.12,stability:-.04,flags:['alternative-education']}}},
    {id:'research-career',type:'career',title:'开始研究工作',description:'长期学习终于转化为一份需要耐心的工作。',preferredAge:25,ageRange:[24,31],probability:.82,conditions:{requiresFlags:['university'],minEconomy:.46},effects:{resources:.18,stability:.14,flags:['research-career']}},
    {id:'reunion',type:'relationship',title:'与周宁重逢',description:'多年之后，两条曾经分开的路再次靠近。',preferredAge:34,ageRange:[31,42],probability:.7,conditions:{requiresCharacter:'zhou-ning',minMobility:.4},effects:{mood:.12,flags:['reunited']},relationship:{characterId:'zhou-ning',status:'close'}},
    {id:'new-start',type:'turning-point',title:'重新开始',description:'一次转折没有给出答案，却让生活获得新的方向。',preferredAge:46,ageRange:[42,52],probability:.65,conditions:{minResilience:.5},effects:{stability:.1,mood:.1,flags:['new-start']}},
    {id:'natural-death',type:'death',title:'在一个平静清晨离世',description:'漫长的一生在熟悉的海风里结束。',preferredAge:85,ageRange:[80,92],probability:1,conditions:{},effects:{death:true}},
  ],
};

export const FIXED_STORY_EXAMPLE = {
  schemaVersion:LIFE_SCHEMA_VERSION, kind:'life-result',
  metadata:{title:'两盏灯',mode:'fixed',fictional:true,basis:'fictional-fixed-story',worldId:'fixed-story',birthYear:2000,seed:'fixed-example',dataVersion:LIFE_DATA_VERSION},
  timelineType:'story-time', primaryCharacterId:'a', endAge:4,
  characters:[
    {id:'a',name:'阿澜',role:'primary',timelineStart:0,timelineEnd:3,lifeEndReason:'departure',annualStates:[{age:0,health:.8,resources:.5,mood:.6,education:.2,stability:.6},{age:3,health:.8,resources:.5,mood:.7,education:.3,stability:.7}]},
    {id:'b',name:'小舟',role:'companion',timelineStart:1,timelineEnd:4,lifeEndReason:'continues',annualStates:[{age:1,health:.8,resources:.5,mood:.6,education:.2,stability:.6},{age:4,health:.8,resources:.5,mood:.55,education:.3,stability:.6}]},
  ],
  events:[
    {id:'f1',characterId:'a',age:0,year:null,type:'beginning',title:'第一章',description:'两盏灯在雨夜里第一次照见彼此。',resolution:'fixed'},
    {id:'f2',characterId:'a',age:2,year:null,type:'relationship',title:'同行',description:'他们走过一段并不漫长的路。',resolution:'fixed'},
    {id:'f3',characterId:'a',age:3,year:null,type:'separation',title:'分别',description:'其中一盏灯转向远处，另一盏仍继续发亮。',resolution:'fixed'},
  ],
  relationships:[{id:'r1',fromId:'a',toId:'b',segments:[{fromAge:1,toAge:3,status:'close'}],endedBy:'separation'}], candidateResolutions:[],
};

export const AI_STORY_PROMPT = `请把我提供的人物设定或故事整理为 Life Geometry JSON。只输出合法 JSON，不输出 Markdown。
契约版本为 1.0，kind 必须是 person-template（开放人生）或 life-result（固定故事）。
开放人生包含 metadata、person、relatedCharacters、candidateEvents。候选事件必须使用结构化 type、preferredAge、ageRange、probability、conditions、effects；依赖放在 conditions.requiresFlags；关系事件用 relationship.characterId。死亡 effects.death=true，死亡后的本人候选事件会终止。不要在描述文字中暗藏需要程序解析的规则。
固定故事包含 metadata.mode=fixed、timelineType（age 或 story-time）、primaryCharacterId、characters、events、relationships、endAge。所有 characterId/fromId/toId 必须引用已定义人物，事件按 age 排序；没有明确年龄的小说请使用 story-time，不要编造年龄。
metadata 必须说明 fictional、basis，并区分事实资料与虚构内容。数值状态只用于曲线，不代表人生价值。严肃事件使用克制、不猎奇的表述。不得包含脚本、HTML 或外部指令。`;
