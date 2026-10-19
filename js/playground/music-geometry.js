const MAX_CURVES = 28;
const MAX_POINTS = 150;

export function createArtwork(container) {
  container.innerHTML = `<section class="artwork artwork-music">
    <div class="artwork-toolbar">
      <div class="artwork-status"><span class="artwork-mode" data-mode>演示信号 · 非音频分析</span><small data-file>尚未连接音频</small></div>
      <div class="artwork-controls">
        <button class="btn primary" type="button" data-capture>捕获音乐标签页</button>
        <button class="btn" type="button" data-play>暂停演示</button>
        <label class="btn artwork-file" for="music-file">备用：本地文件<input id="music-file" type="file" accept="audio/*"></label>
        <button class="btn" type="button" data-reset>重置画面</button>
      </div>
    </div>
    <div class="artwork-canvas-shell">
      <canvas aria-label="音乐驱动的二维数学曲线动画"></canvas>
      <div class="artwork-legend"><span><i class="legend-energy"></i>整体能量</span><span><i class="legend-low"></i>低频</span><span><i class="legend-change"></i>频谱变化</span></div>
      <div class="artwork-readout" aria-hidden="true"><span>E <b data-energy>0.00</b></span><span>L <b data-low>0.00</b></span><span>Δ <b data-flux>0.00</b></span></div>
    </div>
    <p class="artwork-help" data-message>演示模式使用虚拟信号。点击“捕获音乐标签页”，在浏览器共享窗口中选择正在播放音乐的标签页，并勾选共享音频。</p>
  </section>`;

  const canvas = container.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const fileInput = container.querySelector('#music-file');
  const captureButton = container.querySelector('[data-capture]');
  const playButton = container.querySelector('[data-play]');
  const resetButton = container.querySelector('[data-reset]');
  const modeLabel = container.querySelector('[data-mode]');
  const fileLabel = container.querySelector('[data-file]');
  const message = container.querySelector('[data-message]');
  const readouts = {
    energy: container.querySelector('[data-energy]'),
    low: container.querySelector('[data-low]'),
    flux: container.querySelector('[data-flux]'),
  };
  const audio = new Audio();
  audio.preload = 'metadata';
  let audioContext = null;
  let analyser = null;
  let activeSourceNode = null;
  let fileSourceNode = null;
  let captureStream = null;
  let captureAudioTrack = null;
  let captureRequestToken = 0;
  let frequencyData = null;
  let previousSpectrum = null;
  let objectUrl = '';
  let mode = 'demo';
  let running = false;
  let destroyed = false;
  let userPaused = false;
  let hiddenResume = false;
  let audioWasPlaying = false;
  let rafId = 0;
  let lastFrame = 0;
  let lastSpawn = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let curveSequence = 0;
  let curves = [];
  const signal = { energy: 0, low: 0, flux: 0 };

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(320, Math.round(bounds.width));
    height = Math.max(360, Math.round(bounds.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#06101f';
    context.fillRect(0, 0, width, height);
    drawGrid();
  }

  function drawGrid() {
    const step = Math.max(42, Math.round(width / 18));
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(137, 164, 196, .12)';
    context.beginPath();
    for (let x = width / 2 % step; x <= width; x += step) { context.moveTo(x, 0); context.lineTo(x, height); }
    for (let y = height / 2 % step; y <= height; y += step) { context.moveTo(0, y); context.lineTo(width, y); }
    context.stroke();
    context.strokeStyle = 'rgba(220, 232, 246, .42)';
    context.beginPath();
    context.moveTo(0, height / 2); context.lineTo(width, height / 2);
    context.moveTo(width / 2, 0); context.lineTo(width / 2, height);
    context.stroke();
    context.fillStyle = 'rgba(220, 232, 246, .55)';
    context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.fillText('x', width - 14, height / 2 - 8);
    context.fillText('y', width / 2 + 8, 14);
    context.restore();
  }

  function demoSignal(time) {
    const pulse = (Math.sin(time * 0.00125) + 1) / 2;
    signal.energy = 0.24 + pulse * 0.36 + Math.sin(time * 0.0041) * 0.08;
    signal.low = 0.18 + Math.max(0, Math.sin(time * 0.0022)) * 0.62;
    signal.flux = 0.12 + Math.abs(Math.sin(time * 0.0037) * Math.cos(time * 0.0009)) * 0.62;
  }

  function audioSignal() {
    if (!analyser || !frequencyData) return;
    analyser.getByteFrequencyData(frequencyData);
    let total = 0; let low = 0; let change = 0;
    const lowEnd = Math.max(4, Math.floor(frequencyData.length * .14));
    for (let index = 0; index < frequencyData.length; index += 1) {
      const value = frequencyData[index] / 255;
      total += value;
      if (index < lowEnd) low += value;
      change += Math.abs(frequencyData[index] - previousSpectrum[index]) / 255;
      previousSpectrum[index] = frequencyData[index];
    }
    signal.energy = total / frequencyData.length;
    signal.low = low / lowEnd;
    signal.flux = Math.min(1, change / frequencyData.length * 4.5);
  }

  function newCurve(time) {
    const types = ['wave', 'spiral', 'shuttle'];
    const weighted = signal.low > .55 ? 'spiral' : signal.flux > .42 ? 'shuttle' : types[curveSequence % types.length];
    curveSequence += 1;
    const fromLeft = Math.random() > .5;
    return {
      type: weighted,
      age: 0,
      life: 4.2 + Math.random() * 5.2,
      hue: 185 + Math.random() * 95 + signal.flux * 45,
      seed: Math.random() * Math.PI * 2,
      x: fromLeft ? -25 : width + 25,
      y: height * (.15 + Math.random() * .7),
      direction: fromLeft ? 1 : -1,
      speed: 34 + signal.energy * 125 + Math.random() * 38,
      radius: 18 + signal.low * 72 + Math.random() * 25,
      points: [],
      born: time,
    };
  }

  function advanceCurve(curve, delta, time) {
    curve.age += delta;
    const t = (time - curve.born) / 1000;
    const speed = curve.speed * (.45 + signal.energy * 1.45);
    curve.x += curve.direction * speed * delta;
    let x = curve.x; let y = curve.y;
    if (curve.type === 'wave') {
      const amplitude = 24 + signal.low * 92;
      y += Math.sin(t * (2.2 + signal.flux * 4) + curve.seed) * amplitude;
      y += Math.sin(t * 7 + curve.seed * 2) * signal.flux * 22;
    } else if (curve.type === 'spiral') {
      const angle = t * (2.3 + signal.flux * 4.2) * curve.direction + curve.seed;
      const radius = curve.radius * (.55 + Math.sin(t * .8) * .18 + signal.low * .45);
      x += Math.cos(angle) * radius;
      y += Math.sin(angle) * radius;
    } else {
      const cross = Math.sin(t * (3.5 + signal.flux * 5) + curve.seed);
      y = height / 2 + cross * height * (.18 + signal.low * .24);
      x += Math.cos(t * 2.1 + curve.seed) * signal.flux * 48;
    }
    curve.points.push({ x, y });
    if (curve.points.length > MAX_POINTS) curve.points.shift();
    return curve.age < curve.life && curve.x > -width * .25 && curve.x < width * 1.25;
  }

  function drawCurve(curve) {
    if (curve.points.length < 2) return;
    const remaining = Math.max(0, 1 - curve.age / curve.life);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (let index = 1; index < curve.points.length; index += 1) {
      const p0 = curve.points[index - 1]; const p1 = curve.points[index];
      const trail = index / curve.points.length;
      context.strokeStyle = `hsla(${curve.hue + trail * 28}, 88%, 70%, ${remaining * trail * .66})`;
      context.lineWidth = .7 + trail * (1.2 + signal.energy * 2.2);
      context.beginPath(); context.moveTo(p0.x, p0.y); context.lineTo(p1.x, p1.y); context.stroke();
    }
    context.restore();
  }

  function frame(time) {
    if (!running || destroyed) return;
    const delta = Math.min(.05, Math.max(.001, (time - lastFrame) / 1000 || .016));
    lastFrame = time;
    if (mode === 'demo') demoSignal(time); else audioSignal();
    const generating = mode === 'demo' || mode === 'capture' || (mode === 'file' && !audio.paused && !audio.ended);
    const interval = 900 - signal.low * 570 - signal.flux * 180;
    if (generating && curves.length < MAX_CURVES && time - lastSpawn > Math.max(135, interval)) {
      curves.push(newCurve(time));
      if (signal.flux > .66 && curves.length < MAX_CURVES) curves.push(newCurve(time));
      lastSpawn = time;
    }
    context.fillStyle = 'rgba(6, 16, 31, .16)';
    context.fillRect(0, 0, width, height);
    drawGrid();
    curves = curves.filter((curve) => advanceCurve(curve, delta, time));
    curves.forEach(drawCurve);
    readouts.energy.textContent = signal.energy.toFixed(2);
    readouts.low.textContent = signal.low.toFixed(2);
    readouts.flux.textContent = signal.flux.toFixed(2);
    if (!generating && curves.length === 0 && mode === 'file') {
      running = false; rafId = 0; playButton.textContent = '重新播放';
      message.textContent = '音乐已结束，最后的轨迹已经消散。可以重新播放或选择另一首本地音乐。';
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (destroyed || running || document.hidden) return;
    running = true; lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  async function ensureAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('当前浏览器不支持 Web Audio API');
    audioContext = new AudioContextClass();
    return audioContext;
  }

  function disconnectAnalysisGraph() {
    if (activeSourceNode) {
      try { activeSourceNode.disconnect(); } catch {}
    }
    if (analyser) {
      try { analyser.disconnect(); } catch {}
    }
    activeSourceNode = null;
    analyser = null;
    frequencyData = null;
    previousSpectrum = null;
  }

  function connectAnalysisSource(source, shouldOutput) {
    disconnectAnalysisGraph();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .72;
    source.connect(analyser);
    // Captured tab audio is already audible in its source tab. Only local-file
    // playback connects to destination, preventing duplicate sound or echo.
    if (shouldOutput) analyser.connect(audioContext.destination);
    activeSourceNode = source;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
  }

  async function connectFileAnalysis() {
    await ensureAudioContext();
    if (!fileSourceNode) fileSourceNode = audioContext.createMediaElementSource(audio);
    connectAnalysisSource(fileSourceNode, true);
  }

  function cleanupCaptureStream() {
    if (captureAudioTrack) captureAudioTrack.removeEventListener('ended', onCaptureEnded);
    if (captureStream) captureStream.getTracks().forEach((track) => track.stop());
    captureAudioTrack = null;
    captureStream = null;
  }

  function switchToDemo(statusText) {
    cleanupCaptureStream();
    disconnectAnalysisGraph();
    mode = 'demo';
    signal.energy = 0; signal.low = 0; signal.flux = 0;
    modeLabel.textContent = '演示信号 · 非音频分析';
    fileLabel.textContent = '尚未连接音频';
    captureButton.disabled = false;
    captureButton.textContent = '捕获音乐标签页';
    playButton.textContent = userPaused ? '继续演示' : '暂停演示';
    message.textContent = statusText;
    if (!userPaused) startLoop();
  }

  function stopCapture(statusText = '已停止标签页音频捕获，画面回到虚拟信号演示。') {
    captureRequestToken += 1;
    switchToDemo(statusText);
  }

  function onCaptureEnded() {
    if (destroyed || mode !== 'capture') return;
    stopCapture('浏览器已结束共享，音频捕获已停止；画面已回到演示模式。');
  }

  async function beginCapture() {
    if (mode === 'capture') { stopCapture(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      message.textContent = '当前浏览器不支持标签页音频捕获。请使用最新版 Chrome 或 Edge，或使用本地文件备用入口。';
      return;
    }
    const requestToken = ++captureRequestToken;
    captureButton.disabled = true;
    captureButton.textContent = '等待选择…';
    message.textContent = '请选择正在播放音乐的浏览器标签页，并确认勾选“共享标签页音频”。';
    let requestedStream = null;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
        systemAudio: 'include',
      });
      requestedStream = stream;
      if (destroyed || requestToken !== captureRequestToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach((track) => track.stop());
        captureButton.disabled = false;
        captureButton.textContent = '捕获音乐标签页';
        message.textContent = '没有收到共享音频。请重新选择音乐标签页，并在共享窗口中勾选“共享标签页音频”。';
        return;
      }
      audio.pause();
      cleanupCaptureStream();
      await ensureAudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (destroyed || requestToken !== captureRequestToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      captureStream = stream;
      requestedStream = null;
      captureAudioTrack = audioTrack;
      captureAudioTrack.addEventListener('ended', onCaptureEnded, { once:true });
      connectAnalysisSource(audioContext.createMediaStreamSource(stream), false);
      mode = 'capture';
      userPaused = false;
      modeLabel.textContent = '标签页音频捕获';
      fileLabel.textContent = audioTrack.label || '正在分析共享音频';
      captureButton.disabled = false;
      captureButton.textContent = '停止捕获';
      playButton.textContent = '暂停画面';
      message.textContent = '正在分析共享标签页的音频；捕获流不会连接到扬声器，因此不会产生重复声音或回声。';
      reset();
      startLoop();
    } catch (error) {
      if (requestedStream) requestedStream.getTracks().forEach((track) => track.stop());
      if (destroyed || requestToken !== captureRequestToken) return;
      captureButton.disabled = false;
      captureButton.textContent = '捕获音乐标签页';
      if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') message.textContent = '你取消了共享或未授予权限。浏览器不会在未确认的情况下捕获其他标签页。';
      else message.textContent = `无法开始标签页音频捕获：${error?.message || '浏览器返回未知错误'}。可以改用本地文件。`;
    }
  }

  async function play() {
    userPaused = false;
    if (mode === 'demo') { startLoop(); playButton.textContent = '暂停演示'; return; }
    try {
      await ensureAudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (mode === 'capture') {
        startLoop();
        playButton.textContent = '暂停画面';
        return;
      }
      await connectFileAnalysis();
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
      startLoop();
      playButton.textContent = '暂停音乐';
      message.textContent = '正在分析整体能量、低频与频谱变化；这些特征会影响生成频率、速度、曲率和运动规则。';
    } catch (error) {
      stopLoop();
      message.textContent = `无法播放这个文件：${error.message || '浏览器拒绝或音频无法解码'}`;
      playButton.textContent = '重试播放';
    }
  }

  function pause(markUser = true) {
    if (markUser) userPaused = true;
    stopLoop();
    if (mode === 'file') audio.pause();
    if (mode === 'capture' && audioContext?.state === 'running') audioContext.suspend().catch(() => {});
    playButton.textContent = mode === 'demo' ? '继续演示' : mode === 'capture' ? '继续分析' : '继续播放';
  }

  function togglePlay() {
    if (running || (mode === 'file' && !audio.paused)) pause(); else play();
  }

  function reset() {
    curves.length = 0;
    context.fillStyle = '#06101f'; context.fillRect(0, 0, width, height); drawGrid();
    lastSpawn = 0;
  }

  function onFileChange() {
    const file = fileInput.files?.[0];
    if (!file) return;
    captureRequestToken += 1;
    cleanupCaptureStream();
    disconnectAnalysisGraph();
    pause(false);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    audio.load();
    mode = 'file';
    modeLabel.textContent = '本地音频分析';
    fileLabel.textContent = file.name;
    captureButton.disabled = false;
    captureButton.textContent = '捕获音乐标签页';
    playButton.textContent = '播放音乐';
    message.textContent = '文件已就绪。点击播放后才会创建音频分析上下文；文件不会离开当前浏览器。';
    reset();
  }

  function onEnded() {
    playButton.textContent = '正在消散…';
    message.textContent = '音乐已结束，不再生成新曲线；已有轨迹正在自然消散。';
    startLoop();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      hiddenResume = running && !userPaused;
      audioWasPlaying = mode === 'file' && !audio.paused;
      stopLoop();
      if (audioWasPlaying) audio.pause();
      if (mode === 'capture' && audioContext?.state === 'running') audioContext.suspend().catch(() => {});
      return;
    }
    if (!hiddenResume || destroyed) return;
    hiddenResume = false;
    if (audioWasPlaying || mode === 'capture') play(); else startLoop();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  fileInput.addEventListener('change', onFileChange);
  captureButton.addEventListener('click', beginCapture);
  playButton.addEventListener('click', togglePlay);
  resetButton.addEventListener('click', reset);
  audio.addEventListener('ended', onEnded);
  document.addEventListener('visibilitychange', onVisibilityChange);
  resize();

  return {
    start() { userPaused = false; startLoop(); },
    pause() { pause(true); },
    destroy() {
      if (destroyed) return;
      destroyed = true; captureRequestToken += 1; stopLoop();
      audio.pause(); audio.removeAttribute('src'); audio.load();
      cleanupCaptureStream();
      disconnectAnalysisGraph();
      if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resizeObserver.disconnect();
      fileInput.removeEventListener('change', onFileChange);
      captureButton.removeEventListener('click', beginCapture);
      playButton.removeEventListener('click', togglePlay);
      resetButton.removeEventListener('click', reset);
      audio.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      curves.length = 0; frequencyData = null; previousSpectrum = null; activeSourceNode = null; fileSourceNode = null; analyser = null; audioContext = null;
      container.replaceChildren();
    },
  };
}
