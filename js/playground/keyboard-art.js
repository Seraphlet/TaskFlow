const KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'];
const MAX_MARKS = 900;

export function createArtwork(container) {
  container.innerHTML = `<section class="artwork artwork-keyboard">
    <div class="artwork-toolbar">
      <div class="artwork-status"><span class="artwork-mode">键盘已连接</span><small data-status>敲击 A–K 开始绘画</small></div>
      <div class="artwork-controls"><button class="btn primary" type="button" data-random>随机一击</button><button class="btn" type="button" data-pause>暂停</button><button class="btn" type="button" data-clear>清空画布</button></div>
    </div>
    <div class="artwork-canvas-shell keyboard-canvas-shell">
      <canvas aria-label="键盘交互式生成绘画"></canvas>
      <div class="key-map" aria-label="按键效果说明">${KEYS.map((key) => `<span><kbd>${key}</kbd><small>${({A:'光点',S:'圆环',D:'螺旋',F:'花纹',G:'爆发',H:'分支',J:'丝线',K:'组合'})[key]}</small></span>`).join('')}</div>
    </div>
    <p class="artwork-help">按键只在这个作品运行时生效；输入框获得焦点或离开页面后不会触发绘画。连续输入会自动限制实体数量。</p>
  </section>`;

  const canvas = container.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const randomButton = container.querySelector('[data-random]');
  const pauseButton = container.querySelector('[data-pause]');
  const clearButton = container.querySelector('[data-clear]');
  const status = container.querySelector('[data-status]');
  let width = 1; let height = 1; let dpr = 1;
  let marks = [];
  let rafId = 0;
  let lastFrame = 0;
  let running = false;
  let destroyed = false;
  let hiddenResume = false;
  let lastTrigger = 0;
  let listenersActive = false;
  let sequence = 0;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(320, Math.round(bounds.width));
    height = Math.max(360, Math.round(bounds.height));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    clear();
  }

  function clear() {
    marks.length = 0;
    const gradient = context.createRadialGradient(width * .5, height * .46, 20, width * .5, height * .5, Math.max(width, height) * .72);
    gradient.addColorStop(0, '#102347'); gradient.addColorStop(1, '#050b17');
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  }

  function palette(index = 0) { return [188, 212, 254, 328, 24, 146][(sequence + index) % 6]; }
  function origin() { return { x: width * (.18 + Math.random() * .64), y: height * (.2 + Math.random() * .6) }; }
  function add(mark) { marks.push(mark); if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS); }
  function particle(x, y, options = {}) {
    const angle = options.angle ?? Math.random() * Math.PI * 2;
    const speed = options.speed ?? 35 + Math.random() * 155;
    add({ type:options.type || 'dot', x, y, px:x, py:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, age:0, life:options.life || .8+Math.random()*1.8, size:options.size || 1+Math.random()*4, hue:options.hue ?? palette(), spin:options.spin || 0, angle, radius:options.radius || 0, growth:options.growth || 0, phase:Math.random()*Math.PI*2 });
  }

  function trigger(key) {
    if (!running || destroyed) return;
    sequence += 1;
    const p = origin(); const hue = palette();
    if (key === 'A') for (let i=0;i<32;i+=1) particle(p.x,p.y,{type:'dot',hue,angle:(i/32)*Math.PI*2+Math.random()*.08,speed:55+Math.random()*120,size:1+Math.random()*3});
    if (key === 'S') for (let i=0;i<4;i+=1) add({type:'ring',x:p.x,y:p.y,age:-i*.08,life:1.8,radius:8,growth:75+i*28,hue:hue+i*14,size:1.2+i*.4});
    if (key === 'D') for (let i=0;i<54;i+=1) particle(p.x,p.y,{type:'orbit',hue:hue+i*.8,angle:i*.34,speed:18+i*.8,radius:2+i*1.2,spin:.9+Math.random()*1.2,life:2.7,size:1.2+(i%4)*.45});
    if (key === 'F') for (let petal=0;petal<8;petal+=1) for (let i=0;i<7;i+=1) particle(p.x,p.y,{type:'petal',hue:hue+petal*6,angle:(petal/8)*Math.PI*2,speed:30+i*16,spin:(petal%2?1:-1)*.35,life:2.2,size:1.5+i*.18});
    if (key === 'G') for (let i=0;i<68;i+=1) particle(p.x,p.y,{type:'shard',hue:hue+Math.random()*34,angle:Math.random()*Math.PI*2,speed:80+Math.random()*260,life:.65+Math.random()*1.2,size:1+Math.random()*5});
    if (key === 'H') for (let branch=0;branch<9;branch+=1) for (let i=0;i<8;i+=1) particle(p.x,p.y,{type:'branch',hue:hue+branch*4,angle:(branch/9)*Math.PI*2+(i-4)*.018,speed:35+i*24,life:2.2,size:1+i*.12,spin:Math.sin(branch)*.12});
    if (key === 'J') for (let i=0;i<22;i+=1) particle(p.x,p.y,{type:'thread',hue:hue+i*2,angle:(i/22)*Math.PI*2,speed:25+Math.random()*75,life:3.2,size:.8+Math.random()*1.5,spin:(Math.random()-.5)*2.4});
    if (key === 'K') { const choices=KEYS.slice(0,-1); trigger(choices[Math.floor(Math.random()*choices.length)]); trigger(choices[Math.floor(Math.random()*choices.length)]); }
    status.textContent = `${key} · ${({A:'光点发散',S:'圆环扩散',D:'螺旋轨迹',F:'对称花纹',G:'粒子爆发',H:'分支生长',J:'丝线运动',K:'随机组合'})[key]}`;
  }

  function update(mark, delta) {
    mark.age += delta;
    if (mark.age < 0) return true;
    mark.px = mark.x; mark.py = mark.y;
    if (mark.type === 'ring') { mark.radius += mark.growth*delta; return mark.age < mark.life; }
    if (mark.type === 'orbit') {
      mark.angle += mark.spin*delta; mark.radius += mark.vx*.06*delta;
      mark.x += Math.cos(mark.angle)*mark.radius*delta; mark.y += Math.sin(mark.angle)*mark.radius*delta;
    } else {
      const turn = mark.spin * delta;
      const vx = mark.vx*Math.cos(turn)-mark.vy*Math.sin(turn); const vy = mark.vx*Math.sin(turn)+mark.vy*Math.cos(turn);
      mark.vx=vx; mark.vy=vy;
      if (mark.type === 'thread') { mark.vx += Math.sin(mark.age*8+mark.phase)*18*delta; mark.vy += Math.cos(mark.age*6+mark.phase)*18*delta; }
      if (mark.type === 'shard') mark.vy += 90*delta;
      mark.x += mark.vx*delta; mark.y += mark.vy*delta;
    }
    return mark.age < mark.life && mark.x>-80 && mark.x<width+80 && mark.y>-80 && mark.y<height+80;
  }

  function draw(mark) {
    if (mark.age < 0) return;
    const alpha = Math.max(0, 1-mark.age/mark.life);
    context.save(); context.globalCompositeOperation='lighter';
    context.strokeStyle=`hsla(${mark.hue},88%,70%,${alpha*.8})`; context.fillStyle=`hsla(${mark.hue},92%,74%,${alpha*.85})`;
    if (mark.type === 'ring') { context.lineWidth=mark.size; context.beginPath(); context.arc(mark.x,mark.y,mark.radius,0,Math.PI*2); context.stroke(); }
    else if (mark.type === 'shard') { context.lineWidth=mark.size; context.beginPath(); context.moveTo(mark.px,mark.py); context.lineTo(mark.x,mark.y); context.stroke(); }
    else if (['thread','branch','petal'].includes(mark.type)) { context.lineWidth=mark.size; context.beginPath(); context.moveTo(mark.px,mark.py); context.quadraticCurveTo((mark.px+mark.x)/2+Math.sin(mark.phase+mark.age*5)*8,(mark.py+mark.y)/2+Math.cos(mark.phase+mark.age*4)*8,mark.x,mark.y); context.stroke(); }
    else { context.beginPath(); context.arc(mark.x,mark.y,mark.size,0,Math.PI*2); context.fill(); }
    context.restore();
  }

  function frame(time) {
    if (!running || destroyed) return;
    const delta=Math.min(.05,Math.max(.001,(time-lastFrame)/1000||.016)); lastFrame=time;
    context.fillStyle='rgba(5,11,23,.105)'; context.fillRect(0,0,width,height);
    marks=marks.filter((mark)=>update(mark,delta)); marks.forEach(draw);
    rafId=requestAnimationFrame(frame);
  }

  function isTypingTarget(target) { return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable); }
  function onKeydown(event) {
    const key=event.key.toUpperCase();
    if (!KEYS.includes(key) || isTypingTarget(event.target)) return;
    const current=performance.now();
    if (event.repeat && current-lastTrigger<90) return;
    lastTrigger=current; event.preventDefault(); trigger(key);
  }
  function attachKeyboard() { if (listenersActive) return; document.addEventListener('keydown',onKeydown); listenersActive=true; }
  function detachKeyboard() { if (!listenersActive) return; document.removeEventListener('keydown',onKeydown); listenersActive=false; }
  function start() { if (destroyed || running || document.hidden) return; running=true; lastFrame=performance.now(); attachKeyboard(); pauseButton.textContent='暂停'; rafId=requestAnimationFrame(frame); }
  function pause() { running=false; if(rafId)cancelAnimationFrame(rafId);rafId=0;detachKeyboard();pauseButton.textContent='继续'; }
  function onVisibilityChange(){if(document.hidden){hiddenResume=running;pause();}else if(hiddenResume&&!destroyed){hiddenResume=false;start();}}
  function toggle(){if(running)pause();else start();}
  function random(){trigger(KEYS[Math.floor(Math.random()*KEYS.length)]);}

  const resizeObserver=new ResizeObserver(resize); resizeObserver.observe(canvas);
  randomButton.addEventListener('click',random); pauseButton.addEventListener('click',toggle); clearButton.addEventListener('click',clear); document.addEventListener('visibilitychange',onVisibilityChange);
  resize();
  return { start, pause, destroy(){if(destroyed)return;destroyed=true;pause();resizeObserver.disconnect();randomButton.removeEventListener('click',random);pauseButton.removeEventListener('click',toggle);clearButton.removeEventListener('click',clear);document.removeEventListener('visibilitychange',onVisibilityChange);marks.length=0;container.replaceChildren();} };
}
