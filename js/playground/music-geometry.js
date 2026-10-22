const MAX_COMPANIONS = 3;
const MAX_POINTS_PER_LINE = 1100;
const ANALYSIS_INTERVAL_MS = 40;
const POINT_INTERVAL = 1 / 30;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (current, target, delta, seconds) => current + (target - current) * (1 - Math.exp(-delta / seconds));

export function estimateBeatPeriod(onsetTimes, previousPeriod = 0) {
  const recent = onsetTimes.slice(-24);
  if (recent.length < 5) return { periodMs: previousPeriod || 0, confidence: 0 };
  const intervals = [];
  for (let index = 1; index < recent.length; index += 1) {
    let interval = recent[index] - recent[index - 1];
    while (interval > 1000) interval /= 2;
    while (interval < 280) interval *= 2;
    if (interval >= 280 && interval <= 1000) intervals.push(interval);
  }
  if (intervals.length < 4) return { periodMs: previousPeriod || 0, confidence: 0 };
  const ordered = [...intervals].sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)];
  const inliers = intervals.filter((interval) => Math.abs(interval - median) <= median * .16);
  if (inliers.length < 3) return { periodMs: previousPeriod || median, confidence: 0 };
  const periodMs = inliers.reduce((sum, interval) => sum + interval, 0) / inliers.length;
  const deviation = Math.sqrt(inliers.reduce((sum, interval) => sum + (interval - periodMs) ** 2, 0) / inliers.length) / periodMs;
  const confidence = clamp((inliers.length / intervals.length) * Math.min(1, intervals.length / 9) * (1 - deviation * 2.4));
  const stablePeriod = previousPeriod && Math.abs(periodMs - previousPeriod) / previousPeriod < .12 ? previousPeriod * .72 + periodMs * .28 : periodMs;
  return { periodMs: stablePeriod, confidence };
}

export function mapVisualState(features) {
  const medium = features.medium || features;
  const long = features.long || medium;
  const short = features.short || medium;
  const energy = clamp(medium.energy || 0);
  const onsetDensity = clamp(features.onsetDensity || 0);
  const flux = clamp(short.flux || 0);
  const richness = clamp(medium.richness || 0);
  const bandActivity = ['low','mid','high'].filter((key) => (medium[key] || 0) > .12).length;
  return {
    amplitude: 10 + energy * 135 + Math.max(0, energy - (long.energy || 0)) * 72,
    detailRate: .55 + onsetDensity * 4.4 + flux * 2.1,
    travelSpeed: 34 + clamp(long.energy || 0) * 13,
    layerDemand: Math.round(clamp(richness * 7 + bandActivity * .8 + onsetDensity * 1.3, 0, 10)),
    brightness: clamp(.3 + (medium.centroid || 0) * .62),
    tension: clamp((short.energy || 0) * .55 + flux * .45),
  };
}

function createFeatureAnalyzer() {
  const keys = ['energy','low','mid','high','flux','centroid','richness'];
  const raw = Object.fromEntries(keys.map((key) => [key,0]));
  const short = { ...raw }; const medium = { ...raw }; const long = { ...raw };
  const result = { raw, short, medium, long, onsetDensity:0, silenceSeconds:0, beatPeriodMs:0, beatPhase:0, beatConfidence:0 };
  let analyser = null;
  let sampleRate = 48000;
  let timeData = null;
  let frequencyData = null;
  let previousSpectrum = null;
  let lastSampleAt = 0;
  let lastOnsetAt = -Infinity;
  const onsetTimes = [];
  const beatOnsetTimes = [];
  let lastBeatEstimateAt = 0;
  let pendingBeatPeriod = 0;
  let pendingBeatCount = 0;

  function attach(nextAnalyser, nextSampleRate) {
    analyser = nextAnalyser;
    sampleRate = nextSampleRate || 48000;
    timeData = new Float32Array(analyser.fftSize);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
    lastSampleAt = 0; lastOnsetAt = -Infinity; onsetTimes.length = 0; beatOnsetTimes.length = 0;
    lastBeatEstimateAt=0;pendingBeatPeriod=0;pendingBeatCount=0;
    keys.forEach((key) => { raw[key]=0;short[key]=0;medium[key]=0;long[key]=0; });
    result.onsetDensity=0;result.silenceSeconds=0;result.beatPeriodMs=0;result.beatPhase=0;result.beatConfidence=0;
  }

  function detach() {
    analyser=null;timeData=null;frequencyData=null;previousSpectrum=null;lastSampleAt=0;onsetTimes.length=0;beatOnsetTimes.length=0;lastBeatEstimateAt=0;
  }

  function bandAverage(fromHz, toHz) {
    const binHz = sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.floor(fromHz / binHz));
    const end = Math.min(frequencyData.length, Math.ceil(toHz / binHz));
    let total=0;
    for(let index=start;index<end;index+=1) total+=frequencyData[index]/255;
    return total/Math.max(1,end-start);
  }

  function sample(now) {
    if (!analyser || !timeData || !frequencyData) return result;
    const delta = lastSampleAt ? clamp((now-lastSampleAt)/1000,.01,.2) : .04;
    lastSampleAt=now;
    analyser.getFloatTimeDomainData(timeData);
    analyser.getByteFrequencyData(frequencyData);
    let squareTotal=0;let magnitudeTotal=0;let weightedTotal=0;let positiveFlux=0;
    for(let index=0;index<timeData.length;index+=1) squareTotal+=timeData[index]*timeData[index];
    for(let index=1;index<frequencyData.length;index+=1){
      const value=frequencyData[index]/255;
      magnitudeTotal+=value;weightedTotal+=value*index;
      positiveFlux+=Math.max(0,frequencyData[index]-previousSpectrum[index])/255;
      previousSpectrum[index]=frequencyData[index];
    }
    const rms=Math.sqrt(squareTotal/timeData.length);
    raw.energy=clamp(rms*4.2);
    raw.low=clamp(bandAverage(35,260)*1.55);
    raw.mid=clamp(bandAverage(260,2600)*1.7);
    raw.high=clamp(bandAverage(2600,10000)*2.05);
    raw.flux=clamp(positiveFlux/frequencyData.length*5.5);
    raw.centroid=magnitudeTotal>0?clamp((weightedTotal/magnitudeTotal)/frequencyData.length):0;
    let entropy=0;
    if(magnitudeTotal>0){
      for(let index=1;index<frequencyData.length;index+=1){
        const probability=(frequencyData[index]/255)/magnitudeTotal;
        if(probability>0) entropy-=probability*Math.log(probability);
      }
      entropy/=Math.log(Math.max(2,frequencyData.length-1));
    }
    const activeBands=[raw.low,raw.mid,raw.high].filter((value)=>value>.1).length/3;
    raw.richness=clamp(entropy*.68+activeBands*.32);
    const onsetThreshold=Math.max(.055,short.flux*1.42);
    if(raw.flux>onsetThreshold&&now-lastOnsetAt>95){onsetTimes.push(now);beatOnsetTimes.push(now);lastOnsetAt=now;}
    while(onsetTimes.length&&onsetTimes[0]<now-2200)onsetTimes.shift();
    while(beatOnsetTimes.length&&beatOnsetTimes[0]<now-12000)beatOnsetTimes.shift();
    result.onsetDensity=smooth(result.onsetDensity,clamp(onsetTimes.length/11),delta,.35);
    if(now-lastBeatEstimateAt>=480){
      lastBeatEstimateAt=now;const estimate=estimateBeatPeriod(beatOnsetTimes,result.beatPeriodMs);
      if(estimate.confidence>=.38){
        const changed=result.beatPeriodMs&&Math.abs(estimate.periodMs-result.beatPeriodMs)/result.beatPeriodMs>=.14;
        if(changed){const samePending=pendingBeatPeriod&&Math.abs(estimate.periodMs-pendingBeatPeriod)/pendingBeatPeriod<.1;pendingBeatCount=samePending?pendingBeatCount+1:1;pendingBeatPeriod=estimate.periodMs;if(pendingBeatCount>=3){result.beatPeriodMs=estimate.periodMs;pendingBeatCount=0;}}
        else{result.beatPeriodMs=estimate.periodMs;pendingBeatCount=0;}
      }
      result.beatConfidence=smooth(result.beatConfidence,estimate.confidence,Math.max(delta,.48),estimate.confidence>=.38?.9:1.8);
    }
    if(result.beatPeriodMs&&beatOnsetTimes.length){const sinceOnset=Math.max(0,now-beatOnsetTimes.at(-1));result.beatPhase=(sinceOnset%result.beatPeriodMs)/result.beatPeriodMs;}
    result.silenceSeconds=raw.energy<.018?result.silenceSeconds+delta:0;
    keys.forEach((key)=>{
      short[key]=smooth(short[key],raw[key],delta,.18);
      medium[key]=smooth(medium[key],raw[key],delta,1.45);
      long[key]=smooth(long[key],raw[key],delta,6.5);
    });
    return result;
  }

  return { attach, detach, sample, result };
}

function demoFeatures(now) {
  const seconds=(now/1000)%42;
  let energy=.08;let richness=.12;let onset=.08;let low=.06;let mid=.08;let high=.03;
  if(seconds>=6&&seconds<17){const p=(seconds-6)/11;energy=.1+p*.42;richness=.16+p*.48;onset=.16+p*.28;low=.08+p*.4;mid=.12+p*.42;high=.05+p*.3;}
  else if(seconds>=17&&seconds<26){energy=.62;richness=.72;onset=.38;low=.58;mid=.61;high=.44;}
  else if(seconds>=26&&seconds<32){energy=.34;richness=.62;onset=.76;low=.2;mid=.34;high=.52;}
  else if(seconds>=32){const p=1-(seconds-32)/10;energy=.06+p*.3;richness=.1+p*.5;onset=.06+p*.22;low=.05+p*.26;mid=.06+p*.31;high=.03+p*.23;}
  const pulse=Math.max(0,Math.sin(seconds*(2.1+onset*5)))*onset*.18;
  const medium={energy:clamp(energy),low:clamp(low),mid:clamp(mid),high:clamp(high),flux:clamp(onset*.38+pulse),centroid:clamp(.26+high*.55),richness:clamp(richness)};
  const beatConfidence=seconds<6?.12:seconds<32?.82:.48,beatPeriodMs=seconds>=26&&seconds<32?430:620;
  return {raw:{...medium,energy:clamp(energy+pulse)},short:{...medium,energy:clamp(energy+pulse),flux:clamp(onset*.48+pulse)},medium,long:{...medium,energy:clamp(energy*.88),low:clamp(low*.78),mid:clamp(mid*.75),high:clamp(high*.68),richness:clamp(richness*.7)},onsetDensity:clamp(onset),silenceSeconds:0,beatPeriodMs,beatPhase:(seconds*1000%beatPeriodMs)/beatPeriodMs,beatConfidence};
}

const COMPANION_DEFINITIONS = [
  {id:'low-layer',featureSource:'low',on:.13,off:.065,rise:.026,amplitudeScale:1.05,hue:186,phase:.35},
  {id:'mid-layer',featureSource:'mid',on:.15,off:.075,rise:.03,amplitudeScale:.82,hue:225,phase:2.1},
  {id:'high-layer',featureSource:'high',on:.13,off:.06,rise:.035,amplitudeScale:.62,hue:285,phase:4.35},
];

export function createArtwork(container) {
  container.innerHTML=`<section class="artwork artwork-music">
    <div class="artwork-toolbar"><div class="artwork-status"><span class="artwork-mode" data-mode>演示信号 · 非音频分析</span><small data-file>尚未连接音频</small></div><div class="artwork-controls"><button class="btn primary" type="button" data-capture>捕获音乐标签页</button><button class="btn" type="button" data-play>暂停演示</button><label class="btn artwork-file" for="music-file">备用：本地文件<input id="music-file" type="file" accept="audio/*"></label><button class="btn" type="button" data-reset>重置轨迹</button></div></div>
    <div class="artwork-canvas-shell"><canvas aria-label="音乐的一生连续生命轨迹"></canvas><div class="artwork-legend"><span><i class="legend-energy"></i>音乐主线</span><span><i class="legend-low"></i>声音层次</span><span><i class="legend-change"></i>变化细节</span><span><i class="legend-beat"></i>节拍线</span></div><div class="artwork-readout"><span data-scene>平缓生长</span><span data-perf>帧统计采样中</span></div></div>
    <p class="artwork-help" data-message>演示模式以虚拟特征展示从平静、展开到收束的连续轨迹。主丝带始终存在；相对稳定基准持续出现的新频段会形成最多三束伴随丝带。</p>
  </section>`;

  const canvas=container.querySelector('canvas');const context=canvas.getContext('2d',{alpha:false});
  const fileInput=container.querySelector('#music-file');const captureButton=container.querySelector('[data-capture]');const playButton=container.querySelector('[data-play]');const resetButton=container.querySelector('[data-reset]');
  const modeLabel=container.querySelector('[data-mode]');const fileLabel=container.querySelector('[data-file]');const message=container.querySelector('[data-message]');const sceneLabel=container.querySelector('[data-scene]');const perfLabel=container.querySelector('[data-perf]');
  const audio=new Audio();audio.preload='metadata';const featureAnalyzer=createFeatureAnalyzer();
  let audioContext=null;let analyser=null;let activeSourceNode=null;let fileSourceNode=null;let captureStream=null;let captureAudioTrack=null;let captureRequestToken=0;let objectUrl='';
  let mode='demo';let running=false;let destroyed=false;let userPaused=false;let hiddenResume=false;let audioWasPlaying=false;let rafId=0;let lastFrame=0;let lastAnalysisAt=0;let pointAccumulator=0;let worldX=0;let inputEndedAt=0;let demoElapsedMs=0;let frameSampleCount=0;let frameSampleTotal=0;let renderSampleTotal=0;
  let width=1;let height=1;let dpr=1;let latestFeatures=demoFeatures(0);let visualState=mapVisualState(latestFeatures);let mainPhase=0;let beatPhase=0;let beatRate=0;
  const mainLine={id:'main',featureSource:'energy',phase:'active',intensity:1,points:[],createdAt:performance.now(),lastActiveAt:performance.now()};
  const beatLine={id:'beat',featureSource:'beat-period',phase:'active',intensity:1,points:[],createdAt:performance.now(),lastActiveAt:performance.now()};
  let companions=[];const activityTimers=new Map(COMPANION_DEFINITIONS.map((definition)=>[definition.id,{activeMs:0,inactiveMs:0}]));

  function resize(){const bounds=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);width=Math.max(320,Math.round(bounds.width));height=Math.max(360,Math.round(bounds.height));canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);drawFrame(performance.now(),0);}
  function plot(){return{left:30,right:width-18,top:22,bottom:height-24,center:height*.52,span:Math.max(260,width-48)};}
  function viewportStart(){const area=plot();return Math.max(0,worldX-area.span*.5);}
  function drawGrid(){const area=plot();context.save();context.strokeStyle='rgba(133,166,199,.105)';context.lineWidth=1;context.beginPath();for(let x=area.left;x<=area.right;x+=Math.max(48,area.span/14)){context.moveTo(x,area.top);context.lineTo(x,area.bottom);}for(let y=area.top;y<=area.bottom;y+=Math.max(44,(area.bottom-area.top)/9)){context.moveTo(area.left,y);context.lineTo(area.right,y);}context.stroke();context.strokeStyle='rgba(220,232,246,.34)';context.beginPath();context.moveTo(area.left,area.center);context.lineTo(area.right,area.center);context.stroke();context.restore();}

  function resetJourney(){worldX=0;pointAccumulator=0;mainPhase=0;beatPhase=0;beatRate=0;mainLine.points.length=0;mainLine.livePoint=null;beatLine.points.length=0;beatLine.livePoint=null;mainLine.createdAt=performance.now();mainLine.lastActiveAt=mainLine.createdAt;beatLine.createdAt=mainLine.createdAt;beatLine.lastActiveAt=mainLine.createdAt;companions=[];activityTimers.forEach((timer)=>{timer.activeMs=0;timer.inactiveMs=0;});inputEndedAt=0;frameSampleCount=0;frameSampleTotal=0;renderSampleTotal=0;perfLabel.textContent='帧统计采样中';context.fillStyle='#06101f';context.fillRect(0,0,width,height);drawGrid();}
  function featureValue(source){if(source==='onsetDensity')return latestFeatures.onsetDensity||0;return latestFeatures.medium[source]||0;}
  function createCompanion(definition,now){return{id:definition.id,featureSource:definition.featureSource,phase:'entering',intensity:.02,points:[],livePoint:null,createdAt:now,lastActiveAt:now,oscPhase:definition.phase,definition};}

  function updateCompanions(delta,now,allowEntering){
    for(const definition of COMPANION_DEFINITIONS){
      const timer=activityTimers.get(definition.id);const value=featureValue(definition.featureSource);const baseline=latestFeatures.long?.[definition.featureSource]||0;const novelty=Math.max(0,value-baseline);let line=companions.find((item)=>item.id===definition.id);
      const enteringSignal=value>=definition.on&&novelty>=definition.rise;const active=allowEntering&&(line?value>=definition.off:enteringSignal);
      if(active){timer.activeMs+=delta*1000;timer.inactiveMs=0;if(!line&&timer.activeMs>=900&&companions.length<MAX_COMPANIONS){line=createCompanion(definition,now);companions.push(line);}if(line){line.lastActiveAt=now;if(line.phase==='leaving'&&timer.activeMs>=700)line.phase='entering';}}
      else{timer.inactiveMs+=delta*1000;timer.activeMs=0;if(line&&line.phase!=='leaving'&&timer.inactiveMs>=2200)line.phase='leaving';}
      if(!line)continue;const target=line.phase==='leaving'?0:clamp(.24+value*.92);line.intensity=smooth(line.intensity,target,delta,line.phase==='leaving'?1.35:.62);if(line.phase==='entering'&&line.intensity>.78)line.phase='active';
    }
    companions=companions.filter((line)=>!(line.phase==='leaving'&&line.intensity<.018));
  }

  function addTrajectoryPoints(delta,now,generating){
    if(!generating)return;worldX+=visualState.travelSpeed*delta;pointAccumulator+=delta;
    const area=plot();const quiet=latestFeatures.silenceSeconds>1.2;const verticalLimit=(area.bottom-area.top)*.43;const amplitude=quiet?Math.min(visualState.amplitude,11):Math.min(visualState.amplitude,verticalLimit);const mainTravelPace=58+visualState.detailRate*36+latestFeatures.onsetDensity*95;mainPhase+=delta*clamp(mainTravelPace/Math.max(30,amplitude),.48,4.2);const organicMain=Math.sin(mainPhase)+Math.sin(mainPhase*.43+.8)*.28+Math.sin(mainPhase*.17+2.2)*.13;const mainY=area.center+organicMain*amplitude/(1+.28+.13)+Math.sin(mainPhase*2.37)*visualState.tension*amplitude*.13;mainLine.livePoint={x:worldX,y:mainY};mainLine.lastActiveAt=now;
    for(const line of companions){const value=featureValue(line.featureSource);const amplitudeTarget=Math.min((area.bottom-area.top)*.39,(12+visualState.amplitude*.47+value*48)*line.definition.amplitudeScale);const lineAmplitude=amplitudeTarget*line.intensity;const travelPace=48+visualState.detailRate*27+latestFeatures.onsetDensity*68+value*15;const crossingRate=clamp(travelPace/Math.max(24,amplitudeTarget),.38,3.6);line.oscPhase+=delta*crossingRate;const wave=Math.sin(line.oscPhase)+Math.sin(line.oscPhase*.39+line.definition.phase)*.31+Math.sin(line.oscPhase*.16+line.definition.phase*1.7)*.14;line.livePoint={x:worldX,y:area.center+wave*lineAmplitude/(1+.31+.14)};}
    const confidence=clamp(latestFeatures.beatConfidence||0),periodMs=latestFeatures.beatPeriodMs||0,targetRate=confidence>=.34&&periodMs?Math.PI*2/(periodMs/1000):0;beatRate=smooth(beatRate,targetRate,delta,targetRate?.75:1.4);beatPhase+=beatRate*delta;if(targetRate){const measuredPhase=(latestFeatures.beatPhase||0)*Math.PI*2,phaseError=Math.atan2(Math.sin(measuredPhase-beatPhase),Math.cos(measuredPhase-beatPhase));beatPhase+=phaseError*(1-Math.exp(-delta/.8));}const beatBase=area.bottom-(area.bottom-area.top)*.11,neutral=Math.sin(worldX*.012)*1.4,beatWave=Math.sin(beatPhase)*12+Math.max(0,Math.cos(beatPhase))**4*8;beatLine.livePoint={x:worldX,y:beatBase+(confidence>=.34?beatWave*confidence:neutral)};beatLine.lastActiveAt=now;
    if(pointAccumulator<POINT_INTERVAL)return;pointAccumulator%=POINT_INTERVAL;mainLine.points.push({...mainLine.livePoint});beatLine.points.push({...beatLine.livePoint});companions.forEach((line)=>{if(line.livePoint)line.points.push({...line.livePoint});});
    const cutoff=viewportStart()-72;const trim=(line)=>{const firstVisible=line.points.findIndex((point)=>point.x>=cutoff);if(firstVisible>0)line.points.splice(0,firstVisible);if(line.points.length>MAX_POINTS_PER_LINE)line.points.splice(0,line.points.length-MAX_POINTS_PER_LINE);};trim(mainLine);trim(beatLine);companions.forEach(trim);
  }

  function drawPath(line,paint,lineWidth,alpha,blendMode='source-over',offset=0,glow=false){
    if(line.points.length<2||alpha<=0)return;const area=plot();const start=viewportStart();context.save();context.globalCompositeOperation=blendMode;context.lineCap='round';context.lineJoin='round';context.beginPath();let began=false;
    for(let index=0;index<line.points.length;index+=1){const point=line.points[index];const x=area.left+point.x-start;if(x<area.left-4||x>area.right+4)continue;if(!began){context.moveTo(x,point.y+offset);began=true;}else if(index<line.points.length-1){const next=line.points[index+1];const nextX=area.left+next.x-start;context.quadraticCurveTo(x,point.y+offset,(x+nextX)/2,(point.y+next.y+offset)/2);}else context.lineTo(x,point.y+offset);}
    if(began&&line.livePoint){const liveX=area.left+line.livePoint.x-start;if(liveX>=area.left-4&&liveX<=area.right+4)context.lineTo(liveX,line.livePoint.y+offset);}
    if(began){context.strokeStyle=paint;context.lineWidth=lineWidth;context.globalAlpha=alpha;if(glow){context.shadowColor=typeof paint==='string'?paint:'#8be8f5';context.shadowBlur=7*alpha;}context.stroke();}context.restore();
  }
  function drawRibbon(line,color,width,alpha){const area=plot(),paint=context.createLinearGradient(area.left,0,area.right,0);paint.addColorStop(0,'rgba(60,105,154,.08)');paint.addColorStop(.24,color);paint.addColorStop(1,color);for(const [offset,factor] of [[-3,.34],[0,1],[3,.3]])drawPath(line,paint,offset===0?width:Math.max(.55,width*.42),alpha*factor,'lighter',offset,offset===0);}

  function sceneText(){if(mode==='rest')return'尾迹正在消散';if(latestFeatures.silenceSeconds>2.5)return'持续静音 · 视觉休止';if((latestFeatures.medium.energy-latestFeatures.long.energy)>.09)return'力度正在展开';if(latestFeatures.medium.richness>.58)return'声音层次丰富';if(latestFeatures.onsetDensity>.52)return'变化细密';return'平缓生长';}
  function drawFrame(now,endFade){context.fillStyle='#06101f';context.fillRect(0,0,width,height);drawGrid();const fade=1-endFade;const light=Math.round(60+visualState.brightness*18);drawRibbon(mainLine,`hsl(${188+visualState.brightness*42} 92% ${72+visualState.brightness*10}%)`,1.5+latestFeatures.medium.energy*2.2,.9*fade);for(const line of companions){const hue=line.definition.hue+visualState.brightness*18;drawRibbon(line,`hsl(${hue} 84% ${light}%)`,1.15+line.intensity*1.7,line.intensity*.86*fade);}drawPath(beatLine,'#ffd166',1.6,.78*fade,'lighter',0,true);sceneLabel.textContent=sceneText();}
  function updateFeatures(now){if(now-lastAnalysisAt<ANALYSIS_INTERVAL_MS)return;lastAnalysisAt=now;latestFeatures=mode==='demo'?demoFeatures(demoElapsedMs):featureAnalyzer.sample(now);visualState=mapVisualState(latestFeatures);}
  function isGenerating(){return mode==='demo'||mode==='capture'||(mode==='file'&&!audio.paused&&!audio.ended);}
  function frame(now){if(!running||destroyed)return;const frameDelta=Math.max(.001,(now-lastFrame)/1000||.016),delta=Math.min(.05,frameDelta);lastFrame=now;if(mode==='demo')demoElapsedMs+=delta*1000;updateFeatures(now);const generating=isGenerating();updateCompanions(delta,now,generating);addTrajectoryPoints(delta,now,generating);const endFade=mode==='rest'?clamp((now-inputEndedAt)/6200):0,renderStarted=performance.now();drawFrame(now,endFade);frameSampleCount+=1;frameSampleTotal+=frameDelta*1000;renderSampleTotal+=performance.now()-renderStarted;if(frameSampleCount>=90){perfLabel.textContent=`帧 ${Math.round(frameSampleTotal/frameSampleCount)}ms · 绘制 ${(renderSampleTotal/frameSampleCount).toFixed(1)}ms`;frameSampleCount=0;frameSampleTotal=0;renderSampleTotal=0;}if(mode==='rest'&&endFade>=1){running=false;rafId=0;mainLine.points.length=0;beatLine.points.length=0;companions=[];sceneLabel.textContent='轨迹已经归于安静';return;}rafId=requestAnimationFrame(frame);}
  function startLoop(){if(destroyed||running||document.hidden)return;running=true;lastFrame=performance.now();rafId=requestAnimationFrame(frame);}
  function stopLoop(){running=false;if(rafId)cancelAnimationFrame(rafId);rafId=0;}

  async function ensureAudioContext(){if(audioContext)return audioContext;const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)throw new Error('当前浏览器不支持 Web Audio API');audioContext=new AudioContextClass();return audioContext;}
  function disconnectAnalysisGraph(){if(activeSourceNode){try{activeSourceNode.disconnect();}catch{}}if(analyser){try{analyser.disconnect();}catch{}}activeSourceNode=null;analyser=null;featureAnalyzer.detach();}
  function connectAnalysisSource(source,shouldOutput){disconnectAnalysisGraph();analyser=audioContext.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.62;source.connect(analyser);if(shouldOutput)analyser.connect(audioContext.destination);activeSourceNode=source;featureAnalyzer.attach(analyser,audioContext.sampleRate);}
  async function connectFileAnalysis(){await ensureAudioContext();if(!fileSourceNode)fileSourceNode=audioContext.createMediaElementSource(audio);connectAnalysisSource(fileSourceNode,true);}
  function cleanupCaptureStream(){if(captureAudioTrack)captureAudioTrack.removeEventListener('ended',onCaptureEnded);if(captureStream)captureStream.getTracks().forEach((track)=>track.stop());captureAudioTrack=null;captureStream=null;}
  function finishInput(statusText){captureRequestToken+=1;cleanupCaptureStream();audio.pause();disconnectAnalysisGraph();mode='rest';inputEndedAt=performance.now();companions.forEach((line)=>{line.phase='leaving';});modeLabel.textContent='输入已经结束';fileLabel.textContent='尾迹保留中';captureButton.disabled=false;captureButton.textContent='捕获音乐标签页';playButton.disabled=false;playButton.textContent='启动演示';message.textContent=statusText;userPaused=false;startLoop();}
  function onCaptureEnded(){if(!destroyed&&mode==='capture')finishInput('浏览器已结束共享；不会把持续静音误判为结束。新轨迹已停止，已有尾迹正在自然消散。');}
  function stopCapture(){if(mode==='capture')finishInput('已主动停止标签页音频捕获并释放共享轨道；已有尾迹正在自然消散。');}

  async function beginCapture(){
    if(mode==='capture'){stopCapture();return;}if(!navigator.mediaDevices?.getDisplayMedia){message.textContent='当前浏览器不支持标签页音频捕获。请使用最新版 Chrome 或 Edge，或使用本地文件。';return;}
    const requestToken=++captureRequestToken;captureButton.disabled=true;captureButton.textContent='等待选择…';message.textContent='请选择正在播放音乐的标签页，并确认勾选“共享标签页音频”。';let requestedStream=null;
    try{const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true,preferCurrentTab:false,selfBrowserSurface:'exclude',surfaceSwitching:'exclude',systemAudio:'include'});requestedStream=stream;if(destroyed||requestToken!==captureRequestToken){stream.getTracks().forEach((track)=>track.stop());return;}const audioTrack=stream.getAudioTracks()[0];if(!audioTrack){stream.getTracks().forEach((track)=>track.stop());captureButton.disabled=false;captureButton.textContent='捕获音乐标签页';message.textContent='没有收到共享音频。请重新选择音乐标签页，并勾选“共享标签页音频”。';return;}audio.pause();cleanupCaptureStream();await ensureAudioContext();if(audioContext.state==='suspended')await audioContext.resume();if(destroyed||requestToken!==captureRequestToken){stream.getTracks().forEach((track)=>track.stop());return;}captureStream=stream;requestedStream=null;captureAudioTrack=audioTrack;captureAudioTrack.addEventListener('ended',onCaptureEnded,{once:true});connectAnalysisSource(audioContext.createMediaStreamSource(stream),false);mode='capture';userPaused=false;modeLabel.textContent='标签页音频捕获';fileLabel.textContent=audioTrack.label||'正在分析共享音频';captureButton.disabled=false;captureButton.textContent='停止捕获';playButton.disabled=false;playButton.textContent='暂停画面';message.textContent='力度、节奏和频谱层次正分别驱动轨迹；捕获流只用于分析，不会重复输出声音。';resetJourney();startLoop();}
    catch(error){if(requestedStream)requestedStream.getTracks().forEach((track)=>track.stop());if(destroyed||requestToken!==captureRequestToken)return;captureButton.disabled=false;captureButton.textContent='捕获音乐标签页';message.textContent=(error?.name==='NotAllowedError'||error?.name==='AbortError')?'你取消了共享或未授予权限。浏览器不会静默捕获其他标签页。':`无法开始捕获：${error?.message||'浏览器返回未知错误'}。可以改用本地文件。`;}
  }

  function startDemo(){cleanupCaptureStream();audio.pause();disconnectAnalysisGraph();mode='demo';demoElapsedMs=0;latestFeatures=demoFeatures(0);visualState=mapVisualState(latestFeatures);userPaused=false;modeLabel.textContent='演示信号 · 非音频分析';fileLabel.textContent='虚拟特征演示';captureButton.textContent='捕获音乐标签页';playButton.disabled=false;playButton.textContent='暂停演示';message.textContent='演示信号正在模拟平静、展开、丰富与收束；振幅决定路程，节奏密度提高运动速度，两者共同形成周期。';resetJourney();startLoop();}
  async function play(){userPaused=false;if(mode==='rest'){startDemo();return;}if(mode==='demo'){startLoop();playButton.textContent='暂停演示';return;}try{await ensureAudioContext();if(audioContext.state==='suspended')await audioContext.resume();if(mode==='capture'){startLoop();playButton.textContent='暂停画面';return;}await connectFileAnalysis();if(audio.ended)audio.currentTime=0;await audio.play();startLoop();playButton.textContent='暂停音乐';message.textContent='正在分析实际音频：力度控制幅度，起音密度控制细节速度，频谱层次控制伴随线。';}catch(error){stopLoop();message.textContent=`无法播放这个文件：${error?.message||'浏览器拒绝或音频无法解码'}`;playButton.textContent='重试播放';}}
  function pause(markUser=true){if(markUser)userPaused=true;stopLoop();if(mode==='file')audio.pause();if(mode==='capture'&&audioContext?.state==='running')audioContext.suspend().catch(()=>{});playButton.textContent=mode==='demo'?'继续演示':mode==='capture'?'继续分析':mode==='rest'?'启动演示':'继续播放';}
  function togglePlay(){if(running||(mode==='file'&&!audio.paused))pause();else play();}
  function onFileChange(){const file=fileInput.files?.[0];if(!file)return;captureRequestToken+=1;cleanupCaptureStream();disconnectAnalysisGraph();stopLoop();audio.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);audio.src=objectUrl;audio.load();mode='file';userPaused=true;modeLabel.textContent='本地音频分析';fileLabel.textContent=file.name;captureButton.disabled=false;captureButton.textContent='捕获音乐标签页';playButton.disabled=false;playButton.textContent='播放音乐';message.textContent='文件已就绪。点击播放后开始新的连续生命轨迹；文件不会离开当前浏览器。';resetJourney();drawFrame(performance.now(),0);}
  function onEnded(){if(mode==='file')finishInput('音乐播放结束；新轨迹已经停止，整首音乐留下的尾迹正在自然消散。');}
  function onVisibilityChange(){if(document.hidden){hiddenResume=running&&!userPaused;audioWasPlaying=mode==='file'&&!audio.paused;stopLoop();if(audioWasPlaying)audio.pause();if(mode==='capture'&&audioContext?.state==='running')audioContext.suspend().catch(()=>{});return;}if(!hiddenResume||destroyed)return;hiddenResume=false;if(audioWasPlaying||mode==='capture')play();else startLoop();}

  function onReset(){if(mode==='demo'){demoElapsedMs=0;latestFeatures=demoFeatures(0);visualState=mapVisualState(latestFeatures);}resetJourney();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);fileInput.addEventListener('change',onFileChange);captureButton.addEventListener('click',beginCapture);playButton.addEventListener('click',togglePlay);resetButton.addEventListener('click',onReset);audio.addEventListener('ended',onEnded);document.addEventListener('visibilitychange',onVisibilityChange);resize();
  return{start(){userPaused=false;startLoop();},pause(){pause(true);},destroy(){if(destroyed)return;destroyed=true;captureRequestToken+=1;stopLoop();audio.pause();audio.removeAttribute('src');audio.load();cleanupCaptureStream();disconnectAnalysisGraph();if(audioContext&&audioContext.state!=='closed')audioContext.close().catch(()=>{});if(objectUrl)URL.revokeObjectURL(objectUrl);resizeObserver.disconnect();fileInput.removeEventListener('change',onFileChange);captureButton.removeEventListener('click',beginCapture);playButton.removeEventListener('click',togglePlay);resetButton.removeEventListener('click',onReset);audio.removeEventListener('ended',onEnded);document.removeEventListener('visibilitychange',onVisibilityChange);mainLine.points.length=0;beatLine.points.length=0;companions=[];fileSourceNode=null;audioContext=null;container.replaceChildren();}};
}
