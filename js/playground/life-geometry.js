import { WORLD_PACKS, DEFAULT_PERSON_TEMPLATE, FIXED_STORY_EXAMPLE, AI_STORY_PROMPT } from './life-geometry-data.js?v=20261022-life-v1';
import { simulateLife, parseLifeImport } from './life-geometry-engine.js?v=20261022-life-v1';

const esc=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const interpolate=(states,age,key)=>{if(!states?.length)return .5;const after=states.find(item=>item.age>=age)||states.at(-1),index=states.indexOf(after),before=states[Math.max(0,index-1)];if(after===before)return Number(after[key]??.5);const t=clamp((age-before.age)/Math.max(1,after.age-before.age));return Number(before[key]??.5)*(1-t)+Number(after[key]??.5)*t;};

export function createArtwork(container){
  container.innerHTML=`<div class="artwork life-artwork">
    <div class="artwork-toolbar life-toolbar">
      <div class="artwork-status"><span class="artwork-mode" data-life-mode>开放人生 · 艺术化模拟</span><small data-life-status>世界规则影响事件；数值不代表人生价值。</small></div>
      <div class="artwork-controls life-main-controls">
        <button class="btn primary" type="button" data-life-play>暂停</button><button class="btn" type="button" data-life-replay>重播</button><button class="btn" type="button" data-life-next>下一段人生</button>
        <label class="artwork-volume">速度 <select data-life-speed><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <button class="btn" type="button" data-life-fullscreen>沉浸模式</button>
      </div>
    </div>
    <div class="life-settings">
      <label>下一段出生年份 <input type="number" min="1940" max="2050" value="1988" data-life-year></label>
      <label>下一段世界 <select data-life-world>${WORLD_PACKS.map(item=>`<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('')}</select></label>
      <span data-life-pending>设置会在“下一段人生”时应用</span>
      <details class="life-import"><summary>导入人生与创作工具</summary><div><input type="file" accept="application/json,.json" data-life-import><button class="btn" type="button" data-copy-prompt>复制 AI 提示词</button><button class="btn" type="button" data-download-example>下载完整示例</button><button class="btn" type="button" data-show-format>查看格式说明</button><p data-import-message>支持开放人物模板与固定故事；文件只在本地读取。</p><pre data-format hidden></pre></div></details>
    </div>
    <div class="artwork-canvas-shell life-canvas-shell"><canvas aria-label="人生时间线，点击事件节点可暂停并查看"></canvas><div class="life-canvas-legend"><span><i></i>当前人物</span><span><i></i>相遇的人</span><span>○ 事件节点</span></div></div>
    <section class="life-event-window" aria-live="polite"><div><span data-life-time>0 岁</span><b data-life-event-title>一条生命线开始延伸</b></div><p data-life-event-text>人物条件与世界规则正在共同决定实际经历。</p></section>
    <div class="life-music"><label class="artwork-file btn">选择本地背景音乐<input type="file" accept="audio/*" data-life-music-file></label><button class="btn" type="button" data-life-music-play disabled>播放音乐</button><button class="btn" type="button" data-life-mute>静音</button><label class="artwork-volume">音量 <input type="range" min="0" max="1" step=".01" value=".28" data-life-volume></label><label><input type="checkbox" checked data-life-loop> 单曲循环</label><small data-life-music-status>音乐与人生推演、事件和曲线完全独立。</small></div>
  </div>`;
  const canvas=container.querySelector('canvas'),ctx=canvas.getContext('2d');
  const playButton=container.querySelector('[data-life-play]'),replayButton=container.querySelector('[data-life-replay]'),nextButton=container.querySelector('[data-life-next]');
  const yearInput=container.querySelector('[data-life-year]'),worldSelect=container.querySelector('[data-life-world]'),speedSelect=container.querySelector('[data-life-speed]');
  const modeLabel=container.querySelector('[data-life-mode]'),statusLabel=container.querySelector('[data-life-status]'),timeLabel=container.querySelector('[data-life-time]'),eventTitle=container.querySelector('[data-life-event-title]'),eventText=container.querySelector('[data-life-event-text]');
  const importInput=container.querySelector('[data-life-import]'),importMessage=container.querySelector('[data-import-message]'),formatPanel=container.querySelector('[data-format]');
  const musicFile=container.querySelector('[data-life-music-file]'),musicPlay=container.querySelector('[data-life-music-play]'),muteButton=container.querySelector('[data-life-mute]'),volume=container.querySelector('[data-life-volume]'),loop=container.querySelector('[data-life-loop]'),musicStatus=container.querySelector('[data-life-music-status]');
  const audio=new Audio();audio.volume=.28;audio.loop=true;
  let objectUrl='',template=structuredClone(DEFAULT_PERSON_TEMPLATE),result=null,mode='open',playhead=0,running=true,destroyed=false,rafId=0,lastFrame=0,width=0,height=0,dpr=1,seedIndex=1,endHold=0,selectedEvent=null;
  const nodes=[];

  function generate(nextSeed=true){
    if(mode==='fixed'&&result){playhead=0;selectedEvent=null;running=true;endHold=0;updateButtons();return;}
    const world=WORLD_PACKS.find(item=>item.id===worldSelect.value)||WORLD_PACKS[0];
    if(nextSeed)seedIndex+=1;
    result=simulateLife(template,world,{birthYear:Number(yearInput.value),seed:`life-${seedIndex}`});
    mode='open';playhead=0;selectedEvent=null;endHold=0;running=true;
    modeLabel.textContent='开放人生 · 艺术化模拟';statusLabel.textContent=`${result.metadata.worldLabel} · ${result.metadata.birthYear} 年出生 · 种子 ${result.metadata.seed}`;
    showEvent(result.events[0]);updateButtons();
  }
  function updateButtons(){playButton.textContent=running?'暂停':'继续';}
  function showEvent(event){if(!event)return;selectedEvent=event;timeLabel.textContent=result.timelineType==='age'?`${Math.round(event.age)} 岁`:`故事时间 ${event.age}`;eventTitle.textContent=event.title;eventText.textContent=event.description||'这一刻改变了生命线的方向。';const panel=container.querySelector('.life-event-window');panel.classList.remove('life-event-change');requestAnimationFrame(()=>panel.classList.add('life-event-change'));}
  function currentEvent(){return [...result.events].filter(item=>item.age<=playhead+.08).at(-1)||result.events[0];}
  function stateY(character,age,base){const health=interpolate(character.annualStates,age,'health'),stability=interpolate(character.annualStates,age,'stability'),mood=interpolate(character.annualStates,age,'mood'),education=interpolate(character.annualStates,age,'education');return base+(health-.5)*-54+(stability-.5)*-36+(mood-.5)*28+Math.sin(age*.35+education*4)*8;}
  function resize(){const rect=canvas.getBoundingClientRect();dpr=Math.min(devicePixelRatio||1,2);width=Math.max(320,rect.width);height=Math.max(360,rect.height);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
  function linePath(character,color,index){
    const left=36,right=width-28,top=54,bottom=height-45,span=Math.max(1,result.endAge),shown=Math.min(playhead,character.timelineEnd),start=character.timelineStart||0;if(shown<start)return;
    const base=height*(index===0?.5:.5+(index%2?.18:-.18));ctx.save();ctx.beginPath();let began=false;
    for(let age=start;age<=shown;age+=.35){const x=left+(age/span)*(right-left),relation=result.relationships.find(item=>item.fromId===result.primaryCharacterId&&item.toId===character.id);let y=stateY(character,age,base);if(index>0&&relation){const segment=relation.segments.find(item=>age>=item.fromAge&&age<=item.toAge);if(segment?.status==='close')y=stateY(result.characters[0],Math.min(age,result.characters[0].timelineEnd),height*.5)+(index%2?24:-24);}
      y=clamp(y,top,bottom);if(!began){ctx.moveTo(x,y);began=true;}else ctx.lineTo(x,y);
    }
    ctx.strokeStyle=color;ctx.lineWidth=index===0?2.7:1.55;ctx.globalAlpha=index===0?.95:.72;ctx.shadowColor=color;ctx.shadowBlur=index===0?13:8;ctx.stroke();ctx.restore();
  }
  function draw(){if(!result||!width)return;ctx.clearRect(0,0,width,height);ctx.fillStyle='#06101f';ctx.fillRect(0,0,width,height);const left=36,right=width-28,center=height*.5;ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=1;for(let i=0;i<5;i++){const y=44+i*(height-88)/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}ctx.beginPath();ctx.moveTo(left,center);ctx.lineTo(right,center);ctx.strokeStyle='rgba(255,255,255,.13)';ctx.stroke();
    linePath(result.characters[0],'#76e4f7',0);result.characters.slice(1).forEach((character,index)=>linePath(character,['#ff9a86','#a78bfa','#8be3bd'][index%3],index+1));
    nodes.length=0;for(const event of result.events){if(event.age>playhead+.05)continue;const characterIndex=Math.max(0,result.characters.findIndex(item=>item.id===event.characterId)),character=result.characters[characterIndex],x=left+(event.age/Math.max(1,result.endAge))*(right-left),base=height*(characterIndex===0?.5:.5+(characterIndex%2?.18:-.18)),y=clamp(stateY(character,Math.min(event.age,character.timelineEnd),base),54,height-45);nodes.push({x,y,event});ctx.beginPath();ctx.arc(x,y,event.type==='death'?5:3.5,0,Math.PI*2);ctx.fillStyle=event.type==='death'?'#ff7d72':'#f7fbff';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=9;ctx.fill();ctx.shadowBlur=0;}
  }
  function frame(now){if(destroyed)return;const delta=Math.min(.05,(now-lastFrame)/1000||0);lastFrame=now;if(running&&result){playhead+=delta*Number(speedSelect.value)*3.1;if(playhead>=result.endAge){playhead=result.endAge;endHold+=delta;if(endHold>3){if(mode==='fixed'){playhead=0;endHold=0;}else generate(true);}}const event=currentEvent();if(event&&event!==selectedEvent)showEvent(event);}draw();rafId=requestAnimationFrame(frame);}
  function togglePlay(){running=!running;selectedEvent=null;updateButtons();}
  function onCanvasClick(event){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,hit=nodes.map(node=>({...node,distance:Math.hypot(node.x-x,node.y-y)})).sort((a,b)=>a.distance-b.distance)[0];if(hit?.distance<18){running=false;playhead=Math.max(playhead,hit.event.age);showEvent(hit.event);updateButtons();draw();}}
  function onSetting(){container.querySelector('[data-life-pending]').textContent='新设置待应用；当前人生不会被改写';}
  async function onImport(){const file=importInput.files?.[0];if(!file)return;try{const imported=parseLifeImport(await file.text());if(imported.kind==='person-template'){template=imported;mode='open';result=null;generate(true);importMessage.textContent=`已导入人物模板：${imported.metadata?.title||imported.person.name}`;}else{result=imported;mode='fixed';playhead=0;selectedEvent=null;running=true;endHold=0;modeLabel.textContent='固定故事 · 不进行时代改写';statusLabel.textContent=imported.metadata?.title||'导入的固定故事';showEvent(result.events[0]);updateButtons();importMessage.textContent='固定故事已通过校验并开始播放。';}}catch(error){importMessage.textContent=`导入失败：${error.message}`;}finally{importInput.value='';}}
  async function copyPrompt(){try{await navigator.clipboard.writeText(AI_STORY_PROMPT);importMessage.textContent='AI 生成提示词已复制。';}catch{importMessage.textContent='浏览器未允许复制，请从格式面板手动复制。';formatPanel.hidden=false;formatPanel.textContent=AI_STORY_PROMPT;}}
  function downloadExample(){const blob=new Blob([JSON.stringify(FIXED_STORY_EXAMPLE,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='life-geometry-fixed-example.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
  function showFormat(){formatPanel.hidden=!formatPanel.hidden;formatPanel.textContent=`支持 kind: person-template（开放人生）或 life-result（固定故事）。\n详见项目 docs/life-geometry-json.md。\n\n${JSON.stringify(DEFAULT_PERSON_TEMPLATE,null,2)}`;}
  function onMusicFile(){const file=musicFile.files?.[0];if(!file)return;audio.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);audio.src=objectUrl;audio.load();musicPlay.disabled=false;musicPlay.textContent='播放音乐';musicStatus.textContent=`已载入 ${file.name}。换人生不会重启音乐。`;}
  async function toggleMusic(){try{if(audio.paused){await audio.play();musicPlay.textContent='暂停音乐';}else{audio.pause();musicPlay.textContent='播放音乐';}}catch(error){musicStatus.textContent=`无法播放：${error.message}`;}}
  function toggleMute(){audio.muted=!audio.muted;muteButton.textContent=audio.muted?'取消静音':'静音';}
  function fullscreen(){(container.requestFullscreen?.()||Promise.reject()).catch(()=>{statusLabel.textContent='当前浏览器不允许进入沉浸模式。';});}
  const listeners=[[playButton,'click',togglePlay],[replayButton,'click',()=>{playhead=0;endHold=0;selectedEvent=null;running=true;showEvent(result.events[0]);updateButtons();}],[nextButton,'click',()=>generate(true)],[yearInput,'change',onSetting],[worldSelect,'change',onSetting],[canvas,'click',onCanvasClick],[importInput,'change',onImport],[container.querySelector('[data-copy-prompt]'),'click',copyPrompt],[container.querySelector('[data-download-example]'),'click',downloadExample],[container.querySelector('[data-show-format]'),'click',showFormat],[musicFile,'change',onMusicFile],[musicPlay,'click',toggleMusic],[muteButton,'click',toggleMute],[volume,'input',()=>{audio.volume=Number(volume.value);}],[loop,'change',()=>{audio.loop=loop.checked;}],[container.querySelector('[data-life-fullscreen]'),'click',fullscreen]];
  listeners.forEach(([element,type,handler])=>element.addEventListener(type,handler));
  function onVisibility(){if(document.hidden){running=false;updateButtons();}}
  document.addEventListener('visibilitychange',onVisibility);const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);generate(false);resize();
  return{start(){if(!destroyed){running=true;lastFrame=performance.now();if(!rafId)rafId=requestAnimationFrame(frame);updateButtons();}},pause(){running=false;updateButtons();},destroy(){if(destroyed)return;destroyed=true;if(rafId)cancelAnimationFrame(rafId);rafId=0;audio.pause();audio.removeAttribute('src');audio.load();if(objectUrl)URL.revokeObjectURL(objectUrl);resizeObserver.disconnect();document.removeEventListener('visibilitychange',onVisibility);listeners.forEach(([element,type,handler])=>element.removeEventListener(type,handler));container.replaceChildren();}};
}
