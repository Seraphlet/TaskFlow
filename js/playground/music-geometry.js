const MAX_COMPANIONS = 7;
const MAX_POINTS_PER_LINE = 1100;
const ANALYSIS_INTERVAL_MS = 40;
const POINT_INTERVAL = 1 / 30;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (current, target, delta, seconds) => current + (target - current) * (1 - Math.exp(-delta / seconds));

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
  const result = { raw, short, medium, long, onsetDensity:0, silenceSeconds:0 };
  let analyser = null;
  let sampleRate = 48000;
  let timeData = null;
  let frequencyData = null;
  let previousSpectrum = null;
  let lastSampleAt = 0;
  let lastOnsetAt = -Infinity;
  const onsetTimes = [];

  function attach(nextAnalyser, nextSampleRate) {
    analyser = nextAnalyser;
    sampleRate = nextSampleRate || 48000;
    timeData = new Float32Array(analyser.fftSize);
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
    lastSampleAt = 0; lastOnsetAt = -Infinity; onsetTimes.length = 0;
    keys.forEach((key) => { raw[key]=0;short[key]=0;medium[key]=0;long[key]=0; });
    result.onsetDensity=0; result.silenceSeconds=0;
  }

  function detach() {
    analyser=null;timeData=null;frequencyData=null;previousSpectrum=null;lastSampleAt=0;onsetTimes.length=0;
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
    if(raw.flux>onsetThreshold&&now-lastOnsetAt>95){onsetTimes.push(now);lastOnsetAt=now;}
    while(onsetTimes.length&&onsetTimes[0]<now-2200)onsetTimes.shift();
    result.onsetDensity=smooth(result.onsetDensity,clamp(onsetTimes.length/11),delta,.35);
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
  return {raw:{...medium,energy:clamp(energy+pulse)},short:{...medium,energy:clamp(energy+pulse),flux:clamp(onset*.48+pulse)},medium,long:{...medium,energy:clamp(energy*.88)},onsetDensity:clamp(onset),silenceSeconds:0};
}

const COMPANION_DEFINITIONS = [
  {id:'low-a',featureSource:'low',priority:1,on:.10,off:.055,amplitudeScale:1.12,hue:190,phase:.3},
  {id:'mid-a',featureSource:'mid',priority:2,on:.10,off:.055,amplitudeScale:.88,hue:220,phase:1.7},
  {id:'high-a',featureSource:'high',priority:3,on:.09,off:.045,amplitudeScale:.62,hue:274,phase:2.8},
  {id:'rich-a',featureSource:'richness',priority:4,on:.34,off:.23,amplitudeScale:.76,hue:326,phase:4.1},
  {id:'low-b',featureSource:'low',priority:5,on:.31,off:.20,amplitudeScale:.94,hue:176,phase:5.2},
  {id:'mid-b',featureSource:'mid',priority:6,on:.29,off:.18,amplitudeScale:.72,hue:240,phase:6.3},
  {id:'high-b',featureSource:'high',priority:7,on:.25,off:.15,amplitudeScale:.54,hue:294,phase:7.5},
  {id:'rich-b',featureSource:'richness',priority:8,on:.58,off:.43,amplitudeScale:.68,hue:342,phase:8.8},
  {id:'pulse-a',featureSource:'onsetDensity',priority:9,on:.44,off:.27,amplitudeScale:.48,hue:32,phase:9.7},
  {id:'pulse-b',featureSource:'onsetDensity',priority:10,on:.69,off:.48,amplitudeScale:.42,hue:58,phase:11.1},
];

export function createArtwork(container) {
  container.innerHTML=`<section class="artwork artwork-music">
    <div class="artwork-toolbar"><div class="artwork-status"><span class="artwork-mode" data-mode>演示信号 · 非音频分析</span><small data-file>尚未连接音频</small></div><div class="artwork-controls"><button class="btn primary" type="button" data-capture>捕获音乐标签页</button><button class="btn" type="button" data-play>暂停演示</button><label class="btn artwork-file" for="music-file">备用：本地文件<input id="music-file" type="file" accept="audio/*"></label><button class="btn" type="button" data-reset>重置轨迹</button></div></div>
    <div class="artwork-canvas-shell"><canvas aria-label="音乐的一生连续生命轨迹"></canvas><div class="artwork-legend"><span><i class="legend-energy"></i>音乐主线</span><span><i class="legend-low"></i>声音层次</span><span><i class="legend-change"></i>变化细节</span></div><div class="artwork-readout" data-scene>平缓生长</div></div>
    <p class="artwork-help" data-message>演示模式以虚拟特征展示从平静、展开到收束的连续轨迹。每条线穿越同一横轴；振幅决定路程，节奏密度决定运动速度，因此会形成多种生命节奏。</p>
  </section>`;

  const canvas=container.querySelector('canvas');const context=canvas.getContext('2d',{alpha:false});
  const fileInput=container.querySelector('#music-file');const captureButton=container.querySelector('[data-capture]');const playButton=container.querySelector('[data-play]');const resetButton=container.querySelector('[data-reset]');
  const modeLabel=container.querySelector('[data-mode]');const fileLabel=container.querySelector('[data-file]');const message=container.querySelector('[data-message]');const sceneLabel=container.querySelector('[data-scene]');
  const audio=new Audio();audio.preload='metadata';const featureAnalyzer=createFeatureAnalyzer();
  let audioContext=null;let analyser=null;let activeSourceNode=null;let fileSourceNode=null;let captureStream=null;let captureAudioTrack=null;let captureRequestToken=0;let objectUrl='';
  let mode='demo';let running=false;let destroyed=false;let userPaused=false;let hiddenResume=false;let audioWasPlaying=false;let rafId=0;let lastFrame=0;let lastAnalysisAt=0;let pointAccumulator=0;let worldX=0;let inputEndedAt=0;let demoElapsedMs=0;
  let width=1;let height=1;let dpr=1;let latestFeatures=demoFeatures(0);let visualState=mapVisualState(latestFeatures);let mainPhase=0;
  const mainLine={id:'main',featureSource:'energy',phase:'active',intensity:1,points:[],createdAt:performance.now(),lastActiveAt:performance.now()};
  let companions=[];const activityTimers=new Map(COMPANION_DEFINITIONS.map((definition)=>[definition.id,{activeMs:0,inactiveMs:0}]));

  function resize(){const bounds=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);width=Math.max(320,Math.round(bounds.width));height=Math.max(360,Math.round(bounds.height));canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);drawFrame(performance.now(),0);}
  function plot(){return{left:30,right:width-18,top:22,bottom:height-24,center:height*.52,span:Math.max(260,width-48)};}
  function viewportStart(){const area=plot();return Math.max(0,worldX-area.span+18);}
  function drawGrid(){const area=plot();context.save();context.strokeStyle='rgba(133,166,199,.105)';context.lineWidth=1;context.beginPath();for(let x=area.left;x<=area.right;x+=Math.max(48,area.span/14)){context.moveTo(x,area.top);context.lineTo(x,area.bottom);}for(let y=area.top;y<=area.bottom;y+=Math.max(44,(area.bottom-area.top)/9)){context.moveTo(area.left,y);context.lineTo(area.right,y);}context.stroke();context.strokeStyle='rgba(220,232,246,.34)';context.beginPath();context.moveTo(area.left,area.center);context.lineTo(area.right,area.center);context.stroke();context.restore();}

  function resetJourney(){worldX=0;pointAccumulator=0;mainPhase=0;mainLine.points.length=0;mainLine.createdAt=performance.now();mainLine.lastActiveAt=mainLine.createdAt;companions=[];activityTimers.forEach((timer)=>{timer.activeMs=0;timer.inactiveMs=0;});inputEndedAt=0;context.fillStyle='#06101f';context.fillRect(0,0,width,height);drawGrid();}
  function featureValue(source){if(source==='onsetDensity')return latestFeatures.onsetDensity||0;return latestFeatures.medium[source]||0;}
  function createCompanion(definition,now){return{id:definition.id,featureSource:definition.featureSource,phase:'entering',intensity:.02,points:[],createdAt:now,lastActiveAt:now,oscPhase:definition.phase,definition};}

  function updateCompanions(delta,now,allowEntering){
    for(const definition of COMPANION_DEFINITIONS){
      const timer=activityTimers.get(definition.id);const value=featureValue(definition.featureSource);let line=companions.find((item)=>item.id===definition.id);
      const threshold=line?definition.off:definition.on;const demanded=definition.priority<=visualState.layerDemand;const active=allowEntering&&demanded&&value>=threshold;
      if(active){timer.activeMs+=delta*1000;timer.inactiveMs=0;if(!line&&timer.activeMs>=720&&companions.length<MAX_COMPANIONS){line=createCompanion(definition,now);companions.push(line);}if(line){line.lastActiveAt=now;if(line.phase==='leaving'&&timer.activeMs>=560)line.phase='entering';}}
      else{timer.inactiveMs+=delta*1000;timer.activeMs=0;if(line&&line.phase!=='leaving'&&timer.inactiveMs>=1450)line.phase='leaving';}
      if(!line)continue;const target=line.phase==='leaving'?0:clamp(.24+value*.92);line.intensity=smooth(line.intensity,target,delta,line.phase==='leaving'?1.35:.62);if(line.phase==='entering'&&line.intensity>.78)line.phase='active';
    }
    companions=companions.filter((line)=>!(line.phase==='leaving'&&line.intensity<.018));
  }

  function addTrajectoryPoints(delta,now,generating){
    if(!generating)return;worldX+=visualState.travelSpeed*delta;pointAccumulator+=delta;if(pointAccumulator<POINT_INTERVAL)return;const elapsed=pointAccumulator;pointAccumulator%=POINT_INTERVAL;
    const area=plot();const quiet=latestFeatures.silenceSeconds>1.2;const verticalLimit=(area.bottom-area.top)*.43;const amplitude=quiet?Math.min(visualState.amplitude,11):Math.min(visualState.amplitude,verticalLimit);const mainTravelPace=58+visualState.detailRate*36+latestFeatures.onsetDensity*95;mainPhase+=elapsed*clamp(mainTravelPace/Math.max(30,amplitude),.48,4.2);const mainY=area.center+Math.sin(mainPhase)*amplitude+Math.sin(mainPhase*2.73+.8)*visualState.tension*amplitude*.24;mainLine.points.push({x:worldX,y:mainY});mainLine.lastActiveAt=now;
    for(const line of companions){const value=featureValue(line.featureSource);const amplitudeTarget=Math.min((area.bottom-area.top)*.46,(14+visualState.amplitude*.55+value*58)*line.definition.amplitudeScale);const lineAmplitude=amplitudeTarget*line.intensity;const travelPace=52+visualState.detailRate*32+latestFeatures.onsetDensity*82+value*18;const crossingRate=clamp(travelPace/Math.max(24,amplitudeTarget),.42,4.35);line.oscPhase+=elapsed*crossingRate;const phaseModulation=Math.sin(line.oscPhase*.31+line.definition.phase)*visualState.tension*.4;const y=area.center+Math.sin(line.oscPhase+phaseModulation)*lineAmplitude;line.points.push({x:worldX,y});}
    const cutoff=viewportStart()-90;const trim=(line)=>{while(line.points.length&&line.points[0].x<cutoff)line.points.shift();if(line.points.length>MAX_POINTS_PER_LINE)line.points.splice(0,line.points.length-MAX_POINTS_PER_LINE);};trim(mainLine);companions.forEach(trim);
  }

  function drawPath(line,color,lineWidth,alpha,blendMode='source-over'){
    if(line.points.length<2||alpha<=0)return;const area=plot();const start=viewportStart();context.save();context.globalCompositeOperation=blendMode;context.lineCap='round';context.lineJoin='round';context.beginPath();let began=false;
    for(let index=0;index<line.points.length;index+=1){const point=line.points[index];const x=area.left+point.x-start;if(x<area.left-4||x>area.right+4)continue;if(!began){context.moveTo(x,point.y);began=true;}else if(index<line.points.length-1){const next=line.points[index+1];const nextX=area.left+next.x-start;context.quadraticCurveTo(x,point.y,(x+nextX)/2,(point.y+next.y)/2);}else context.lineTo(x,point.y);}
    if(began){const ageFade=context.createLinearGradient(area.left,0,area.right,0);ageFade.addColorStop(0,'rgba(60, 105, 154, .08)');ageFade.addColorStop(.24,color);ageFade.addColorStop(1,color);context.strokeStyle=ageFade;context.lineWidth=lineWidth;context.globalAlpha=alpha;context.shadowColor=color;context.shadowBlur=8*alpha;context.stroke();}context.restore();
  }

  function sceneText(){if(mode==='rest')return'尾迹正在消散';if(latestFeatures.silenceSeconds>2.5)return'持续静音 · 视觉休止';if((latestFeatures.medium.energy-latestFeatures.long.energy)>.09)return'力度正在展开';if(latestFeatures.medium.richness>.58)return'声音层次丰富';if(latestFeatures.onsetDensity>.52)return'变化细密';return'平缓生长';}
  function drawFrame(now,endFade){context.fillStyle='#06101f';context.fillRect(0,0,width,height);drawGrid();const fade=1-endFade;const light=Math.round(60+visualState.brightness*18);drawPath(mainLine,`hsl(${188+visualState.brightness*42} 92% ${72+visualState.brightness*10}%)`,1.5+latestFeatures.medium.energy*2.2,.9*fade,'lighter');for(const line of companions){const hue=line.definition.hue+visualState.brightness*18;drawPath(line,`hsl(${hue} 84% ${light}%)`,1.25+line.intensity*2,line.intensity*.9*fade);}sceneLabel.textContent=sceneText();}
  function updateFeatures(now){if(now-lastAnalysisAt<ANALYSIS_INTERVAL_MS)return;lastAnalysisAt=now;latestFeatures=mode==='demo'?demoFeatures(demoElapsedMs):featureAnalyzer.sample(now);visualState=mapVisualState(latestFeatures);}
  function isGenerating(){return mode==='demo'||mode==='capture'||(mode==='file'&&!audio.paused&&!audio.ended);}
  function frame(now){if(!running||destroyed)return;const delta=Math.min(.05,Math.max(.001,(now-lastFrame)/1000||.016));lastFrame=now;if(mode==='demo')demoElapsedMs+=delta*1000;updateFeatures(now);const generating=isGenerating();updateCompanions(delta,now,generating);addTrajectoryPoints(delta,now,generating);const endFade=mode==='rest'?clamp((now-inputEndedAt)/6200):0;drawFrame(now,endFade);if(mode==='rest'&&endFade>=1){running=false;rafId=0;mainLine.points.length=0;companions=[];sceneLabel.textContent='轨迹已经归于安静';return;}rafId=requestAnimationFrame(frame);}
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
  return{start(){userPaused=false;startLoop();},pause(){pause(true);},destroy(){if(destroyed)return;destroyed=true;captureRequestToken+=1;stopLoop();audio.pause();audio.removeAttribute('src');audio.load();cleanupCaptureStream();disconnectAnalysisGraph();if(audioContext&&audioContext.state!=='closed')audioContext.close().catch(()=>{});if(objectUrl)URL.revokeObjectURL(objectUrl);resizeObserver.disconnect();fileInput.removeEventListener('change',onFileChange);captureButton.removeEventListener('click',beginCapture);playButton.removeEventListener('click',togglePlay);resetButton.removeEventListener('click',onReset);audio.removeEventListener('ended',onEnded);document.removeEventListener('visibilitychange',onVisibilityChange);mainLine.points.length=0;companions=[];fileSourceNode=null;audioContext=null;container.replaceChildren();}};
}
