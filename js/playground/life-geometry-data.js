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
  relatedCharacters:[{id:'zhou-ning',name:'周宁',role:'旧友',birthOffset:1,health:.76,expectedLifespan:82},{id:'xu-yao',name:'许遥',role:'同行者',birthOffset:-2,health:.72,expectedLifespan:78}],
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

export const AI_STORY_EXAMPLE = {
  schemaVersion:'1.0',kind:'life-story',timelineType:'age',primaryCharacterId:'lan',tailDuration:3,
  metadata:{title:'海风经过的那些年',fictional:true,basis:'fictional-story'},
  characters:[
    {id:'lan',name:'阿澜',role:'primary',birthTime:0,endTime:72,initialState:{health:.78,resources:.45,mood:.58,education:.08,stability:.55}},
    {id:'zhou',name:'周舟',role:'companion',birthTime:2,endTime:78,initialState:{health:.82,resources:.5,mood:.62,education:.08,stability:.6}},
  ],
  events:[
    {id:'e1',characterId:'lan',time:0,type:'birth',title:'阿澜出生',description:'海边小城里，一段人生开始。'},
    {id:'e2',characterId:'zhou',time:2,type:'birth',title:'周舟出生',description:'同一个世界里，另一段人生也开始。'},
    {id:'e3',characterId:'lan',time:13,type:'growth',title:'学会修理收音机',description:'她第一次发现耐心可以让沉默的东西重新发声。',stateChanges:{education:.08,mood:.04}},
    {id:'e4',characterId:'zhou',time:16,type:'family',title:'跟随家人迁居',description:'周舟离开旧街，在陌生城市重新认识日常。',stateChanges:{stability:-.08,resources:-.05}},
    {id:'e5',characterId:'lan',time:20,type:'career',title:'在码头找到工作',description:'工作普通而忙碌，生活第一次有了固定节奏。',stateChanges:{resources:.12,stability:.08}},
    {id:'e6',characterId:'zhou',time:25,type:'career',title:'成为社区教师',description:'周舟开始陪伴一群孩子度过漫长下午。',stateChanges:{resources:.1,education:.12}},
    {id:'e7',characterId:'lan',time:29,type:'relationship',title:'两人在雨夜相遇',description:'一次避雨让两条各自生长的生命线靠近。',stateChanges:{mood:.08}},
    {id:'e8',characterId:'zhou',time:43,type:'migration',title:'周舟再次远行',description:'新的工作让周舟离开海边，两人逐渐少了联系。',stateChanges:{stability:-.04,mood:-.05}},
    {id:'e9',characterId:'lan',time:55,type:'daily-life',title:'照料门前的小花园',description:'多数日子平静重复，植物记录了缓慢变化。',stateChanges:{mood:.05,stability:.04}},
    {id:'e10',characterId:'zhou',time:61,type:'relationship',title:'寄来一封旧信',description:'多年后的问候没有改写过去，却让记忆重新清晰。',stateChanges:{mood:.06}},
    {id:'e11',characterId:'lan',time:72,type:'death',title:'阿澜离世',description:'她的一生在一个平静清晨结束。',stateChanges:{health:-.8}},
    {id:'e12',characterId:'zhou',time:76,type:'daily-life',title:'周舟仍会走到海边',description:'一个人的生命结束后，另一个人的日子仍在继续。',stateChanges:{mood:-.03}},
  ],
  relationships:[{id:'r1',fromId:'lan',toId:'zhou',startTime:29,endTime:43,status:'close',endReason:'separation'}],
};

export const AI_STORY_PROMPT = `你是一名结构化故事编辑。请把用户随后提供的人物设定、小说梗概或传记资料转换成可直接导入 TaskFlow Life Geometry 的 JSON。

输出目标：生成一个固定故事。网页会自动补全状态时间线和绘图采样；你绝对不要生成 annualStates、Canvas 坐标或代码。

严格要求：
1. 只输出一个合法 JSON 对象，不使用 Markdown 代码围栏，不附解释。
2. schemaVersion 必须是 "1.0"，kind 必须是 "life-story"。
3. timelineType 使用 "age"；只有原作没有年龄且不能合理确定时才用 "story-time"。所有 event.time 都是同一条世界时间轴上的非负数字，不是每个人各自从 0 开始的年龄。
4. primaryCharacterId 必须引用 characters 中存在的唯一 id。所有 characterId、fromId、toId 都必须引用已有且不重复的人物 id。
5. characters 必填 id、name；role 可为 primary 或 companion；birthTime、endTime 为可选非负数字；initialState 可选，health/resources/mood/education/stability 取 0–1。
6. events 至少包含 id、characterId、time、type、title、description。stateChanges 可选，仅能包含 health/resources/mood/education/stability 的 -1–1 增量。事件事实写在结构化字段中，不把规则藏进 description。
7. 同一人物死亡事件 type="death" 后不得再有该人物事件；其他仍存人物可以继续。关系结束不等于死亡。
8. relationships 可选；每项含 fromId、toId、startTime、endTime，startTime 不得晚于 endTime；status 可用 close/distant，endReason 可用 separation/death。
9. 普通生活事件应多于极端事件；事件应有因果连续性，严肃内容克制表达。真实人物必须在 metadata 中以 basis 说明资料依据；无法确认的内容标为虚构，不冒充史实。
10. 必须保留人物之间独立发生的事件，不要让伴随人物只在与主角相遇时出现。

完整可导入示例：
${JSON.stringify(AI_STORY_EXAMPLE,null,2)}

现在请依据用户接下来提供的材料生成 JSON。`;
