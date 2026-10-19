const { LocalStorageAdapter, STORES, ACTIVE_STORES } = window.TaskFlowStorage;
const { NoopNotificationAdapter, NotificationEvents, formatTaskNotification } = window.TaskFlowNotifications;
const { LocalNotesAdapter, MemosNotesAdapter, NotesCredentialStore, NotesDraftStore } = window.TaskFlowNotes;
const { DemoRadarProvider, RemoteRadarProvider, RadarCredentialStore, DEFAULT_MODEL_ID, DEFAULT_DAILY_LIMIT, DEFAULT_PROFILE, QUOTAS, normalizeLegacyItems, usedIdsThroughLegacyIndex } = window.TaskFlowRadar;

const storage = new LocalStorageAdapter();
const notifications = new NoopNotificationAdapter();
const notesCredentials = new NotesCredentialStore();
const notesDrafts = new NotesDraftStore(storage);
const radarProvider = new DemoRadarProvider();
const radarCredentials = new RadarCredentialStore();
const app = document.querySelector('#app');
const STATUS = ['Todo', 'Doing', 'Blocked', 'Done'];
const STATUS_LABELS = { Todo: '待办', Doing: '进行中', Blocked: '已阻塞', Done: '已完成' };
const FIELD_LABELS = { status: '任务状态', currentSummary: '当前整体进度', remark: '备注', next: '下一步行动', blockedReason: '阻塞说明', owner: '负责人' };
const CATEGORIES = ['AI Engineering', 'Company', 'Learning', 'Project', 'Personal'];
const RADAR_ACTIVE_KEY = 'taskflow-radar-active-profile-v1';
const NOTES_UI_KEY = 'taskflow-notes-ui-v1';
const state = { route: 'home', playgroundView: 'list', taskId: null, noteId: null, noteDraft: null, noteDraftRevision: 0, noteDraftRestored: false, noteSaving: false, selectedCategory: 'All', search: '', status: 'All', taskHistoryTab: 'activity', drawer: null, data: {}, notes: [], notesMode: 'Local', notesError: '', memosTest: null, radarProfiles: [], radarBatches: [], radarHistory: [], radarProfileId: '', radarMessage: '', radarTest: null, radarSearching: false };
let noteDraftTimer = null;
let noteDraftWrite = Promise.resolve();
let appLoaded = false;
let homeClockTimer = null;
let activeArtwork = null;
let artworkLoadToken = 0;
const PLAYGROUND_MODULES = {
  music: './playground/music-geometry.js?v=20261019-playground-v1-1',
  keyboard: './playground/keyboard-art.js?v=20261019-playground-v1-1',
};
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const dateText = (iso) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const badge = (status) => `<span class="badge ${String(status || 'Todo').toLowerCase()}">${esc(STATUS_LABELS[status] || status || '待办')}</span>`;

async function loadData() {
  await storage.init();
  const appStores = ACTIVE_STORES || STORES.filter((name) => !['companies', 'comments'].includes(name));
  const entries = await Promise.all(appStores.map(async (name) => [name, await storage.all(name)]));
  state.data = Object.fromEntries(entries);
  // A cached pre-V5 storage adapter does not know about radarHistory. Keep the
  // page usable while the versioned assets below force the matching adapter on
  // the next load; existing IndexedDB records are never replaced here.
  state.data.radarHistory = Array.isArray(state.data.radarHistory) ? state.data.radarHistory : [];
  await loadNotes();
  await loadRadar();
}

function radarBatchId(profileId) { return `batch_${profileId}`; }
function activeRadarProfile() { return state.radarProfiles.find((profile) => profile.id === state.radarProfileId) || state.radarProfiles[0]; }
function activeRadarBatch() { return state.radarBatches.find((batch) => batch.profileId === state.radarProfileId); }
function localDayKey(value = new Date()) { const date=new Date(value); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function radarDailyUsage() { const today=localDayKey(); return state.radarHistory.filter((entry)=>entry.remote&&!['limited','blocked'].includes(entry.status)&&localDayKey(entry.createdAt)===today).length; }
function activeRadarHistory() { return state.radarHistory.filter((entry)=>entry.profileId===state.radarProfileId).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); }

async function saveRadarHistory(entry) {
  await storage.put('radarHistory', entry);
  const index=state.radarHistory.findIndex((item)=>item.id===entry.id);
  if(index>=0) state.radarHistory[index]=entry; else state.radarHistory.push(entry);
}

function radarShortages(items) {
  return Object.fromEntries(Object.entries(QUOTAS).map(([section, quota]) => [section, Math.max(0, quota - items.filter((item) => item.section === section).length)]));
}

async function createRadarBatch(profile, sequence = 1) {
  const result = await radarProvider.getNextBatch(profile, []);
  const timestamp = now();
  return { id:radarBatchId(profile.id), profileId:profile.id, sequence, items:result.items, usedItemIds:result.items.map((item)=>item.id), shortages:result.shortages, provider:result.provider, exhausted:result.exhausted, createdAt:timestamp, updatedAt:timestamp };
}

async function loadRadar() {
  const timestamp = now();
  const preexistingBatches = [...state.data.radarBatches];
  state.radarProfiles = [...state.data.radarProfiles];
  state.radarBatches = [...state.data.radarBatches];
  state.radarHistory = [...(state.data.radarHistory || [])];
  const interrupted=state.radarHistory.filter((entry)=>entry.status==='searching').map((entry)=>({...entry,status:'error',message:'页面在本次搜索完成前关闭或刷新；可再次探索，后端已完成的结果会自动恢复。',completedAt:timestamp}));
  if(interrupted.length) {
    await storage.putMany('radarHistory',interrupted);
    const replacements=new Map(interrupted.map((entry)=>[entry.id,entry]));
    state.radarHistory=state.radarHistory.map((entry)=>replacements.get(entry.id)||entry);
  }
  let defaultProfile = state.radarProfiles.find((profile) => profile.id === DEFAULT_PROFILE.id);
  if (!defaultProfile) {
    defaultProfile = { ...structuredClone(DEFAULT_PROFILE), createdAt:timestamp, updatedAt:timestamp };
    await storage.put('radarProfiles', defaultProfile);
    state.radarProfiles.push(defaultProfile);
  }
  state.radarProfiles.sort((a,b) => Number(b.isDefault)-Number(a.isDefault) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || a.name.localeCompare(b.name,'zh-CN'));
  if (!state.radarBatches.some((batch) => batch.profileId === defaultProfile.id)) {
    const legacy = state.data.radar.find((item) => item.id === 'current');
    let batch;
    if (legacy?.items?.length) {
      const items = normalizeLegacyItems(legacy.items);
      batch = { id:radarBatchId(defaultProfile.id), profileId:defaultProfile.id, sequence:Number(legacy.index || 0) + 1, items, usedItemIds:usedIdsThroughLegacyIndex(legacy.index), shortages:radarShortages(items), provider:'Demo', exhausted:false, createdAt:legacy.createdAt || timestamp, updatedAt:timestamp };
    } else batch = await createRadarBatch(defaultProfile);
    await storage.put('radarBatches', batch); state.radarBatches.push(batch);
  }
  for (const profile of state.radarProfiles) {
    if (state.radarBatches.some((batch) => batch.profileId === profile.id)) continue;
    const batch = await createRadarBatch(profile);
    await storage.put('radarBatches', batch); state.radarBatches.push(batch);
  }
  const migratedHistory=[];
  for(const batch of preexistingBatches) {
    const id=`radar_history_migrated_${batch.id}`;
    if(!batch.items?.length||state.radarHistory.some((entry)=>entry.id===id)) continue;
    const profile=state.radarProfiles.find((item)=>item.id===batch.profileId);
    migratedHistory.push({id,profileId:batch.profileId,profileName:profile?.name||'历史方向',profileSnapshot:profile?structuredClone(profile):null,remote:Boolean(batch.provider&&batch.provider!=='Demo'),status:'success',items:structuredClone(batch.items),shortages:batch.shortages||radarShortages(batch.items),provider:batch.provider||'Demo',modelId:batch.modelId||'',message:'从升级前保留的当前批次迁移。',createdAt:batch.createdAt||timestamp,completedAt:batch.updatedAt||batch.createdAt||timestamp,migrated:true});
  }
  if(migratedHistory.length) { await storage.putMany('radarHistory',migratedHistory); state.radarHistory.push(...migratedHistory); }
  let savedProfileId = '';
  try { savedProfileId = localStorage.getItem(RADAR_ACTIVE_KEY) || ''; } catch {}
  state.radarProfileId = state.radarProfiles.some((profile) => profile.id === savedProfileId) ? savedProfileId : defaultProfile.id;
}

function selectRadarProfile(profileId) {
  if (!state.radarProfiles.some((profile) => profile.id === profileId)) return;
  state.radarProfileId = profileId; state.radarMessage = '';
  try { localStorage.setItem(RADAR_ACTIVE_KEY, profileId); } catch {}
}

function currentNotesAdapter() {
  const config = notesCredentials.getConfig();
  if (config.mode !== 'Memos') return new LocalNotesAdapter(storage);
  return new MemosNotesAdapter({ serverUrl: config.serverUrl, token: notesCredentials.getToken(), apiBase: config.apiBase });
}

function notesUiState() {
  try { return JSON.parse(localStorage.getItem(NOTES_UI_KEY)) || {}; }
  catch { return {}; }
}

function persistNotesUi(open = state.route === 'notes') {
  const all = notesUiState();
  all[state.notesMode] = { noteId:state.noteId || '', open:Boolean(open), updatedAt:now() };
  try { localStorage.setItem(NOTES_UI_KEY, JSON.stringify(all)); } catch {}
}

async function restoreNoteDraft(noteId) {
  if (!noteId) { state.noteDraft=null; state.noteDraftRevision=0; state.noteDraftRestored=false; return; }
  const draft = await notesDrafts.get(state.notesMode, noteId);
  state.noteDraft = draft || null;
  state.noteDraftRevision = Number(draft?.revision || 0);
  state.noteDraftRestored = Boolean(draft);
}

async function loadNotes() {
  const config = notesCredentials.getConfig();
  const nextMode = config.mode === 'Memos' ? 'Memos' : 'Local';
  const modeChanged = state.notesMode !== nextMode;
  state.notesMode = nextMode;
  state.notesError = '';
  try { state.notes = await currentNotesAdapter().list(); }
  catch (error) { state.notes = []; state.notesError = error.message; }
  const saved = notesUiState()[state.notesMode] || {};
  if (modeChanged || !state.noteId) state.noteId = saved.noteId || null;
  const storedDraft = state.noteId ? await notesDrafts.get(state.notesMode, state.noteId) : null;
  const valid = state.noteId && (String(state.noteId).startsWith('new:') || state.notes.some((note) => note.id === state.noteId) || storedDraft);
  if (!valid) state.noteId = null;
  state.noteDraft = valid ? storedDraft : null;
  state.noteDraftRevision = Number(state.noteDraft?.revision || 0);
  state.noteDraftRestored = Boolean(state.noteDraft);
  if (!appLoaded && saved.open && state.noteId) state.route = 'notes';
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.querySelector('#toast-region').append(el);
  setTimeout(() => el.remove(), 3200);
}

function shell(content, title, subtitle) {
  const homeClass = state.route === 'home' ? ' home-shell' : '';
  return `<div class="app-shell${homeClass}">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></div><div><h1>TaskFlow</h1><small>个人工作台</small></div></div>
      <div class="nav-kicker">工作空间</div>
      <nav class="nav-list" aria-label="主导航">
        ${navButton('home','⌂','首页')}
        ${navButton('radar','⌁','探索雷达')}
        ${navButton('notes','✎','随手笔记')}
        ${navButton('categories','◇','内容分类')}
        ${navButton('tasks','▣','任务管理')}
        ${navButton('playground','✦','数字艺术')}
      </nav>
      <div class="local-note"><span class="storage-dot"></span><div><b>本地优先</b><small>Notes 数据源：${esc(state.notesMode)}</small></div><button class="sidebar-settings" data-nav="settings" aria-label="打开设置">⚙</button></div>
    </aside>
    <main class="main"><header class="topbar"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="topbar-state"><span class="status-pulse"></span><span>${['notes','categories'].includes(state.route) ? esc(state.notesMode) : '本地存储'}</span></div></header>${content}</main>
  </div>${renderDrawer()}`;
}

function navButton(route, icon, label) {
  const active = (state.route === route || (route === 'tasks' && state.route === 'task-detail')) ? 'active' : '';
  return `<button class="nav-btn ${active}" data-nav="${route}"><span class="nav-icon">${icon}</span>${label}</button>`;
}

function homeDateParts(value = new Date()) {
  return {
    day:String(value.getDate()).padStart(2,'0'),
    month:new Intl.DateTimeFormat('zh-CN',{month:'long'}).format(value),
    weekday:new Intl.DateTimeFormat('zh-CN',{weekday:'long'}).format(value),
    year:String(value.getFullYear()),
    date:`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`,
    iso:value.toISOString(),
  };
}

function updateHomeTime() {
  if (state.route !== 'home') return;
  const current = new Date();
  const clock = document.querySelector('#home-clock');
  const date = homeDateParts(current);
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(current);
    clock.dateTime = date.iso;
  }
  const day = document.querySelector('[data-home-date-day]');
  const month = document.querySelector('[data-home-date-month]');
  const weekday = document.querySelector('[data-home-date-weekday]');
  const year = document.querySelector('[data-home-date-year]');
  const dateCard = document.querySelector('[data-home-date]');
  if (day) day.textContent = date.day;
  if (month) month.textContent = date.month;
  if (weekday) weekday.textContent = date.weekday;
  if (year) year.textContent = date.year;
  if (dateCard) dateCard.dateTime = date.date;
}

function stopHomeClock() {
  if (homeClockTimer) clearInterval(homeClockTimer);
  homeClockTimer = null;
}

function startHomeClock() {
  stopHomeClock();
  updateHomeTime();
  homeClockTimer = setInterval(updateHomeTime, 1000);
}

function homePage() {
  const tasks = [...state.data.tasks].sort((a,b) => String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  const focusTask = tasks.find((task) => task.status === 'Doing') || tasks.find((task) => task.status === 'Blocked') || tasks.find((task) => task.status === 'Todo');
  const taskCounts = Object.fromEntries(STATUS.map((status) => [status, tasks.filter((task) => task.status === status).length]));
  const recentNotes = [...state.notes].sort((a,b) => String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0, 3);
  const radarBatch = activeRadarBatch();
  const radarItems = (radarBatch?.items || []).slice(0, 2);
  const today = homeDateParts();
  const focusContent = focusTask ? `<span class="home-card-kicker">当前焦点</span><div class="home-focus-title"><h3>${esc(focusTask.title)}</h3>${badge(focusTask.status)}</div><p class="prose">${esc(focusTask.next || focusTask.requirement || '暂未设置下一步')}</p><button class="btn dark" data-task="${esc(focusTask.id)}">打开任务 →</button>` : `<span class="home-card-kicker">当前焦点</span><h3>从一件具体的事开始</h3><p>还没有待推进的任务。创建任务后，这里会显示真实的下一步。</p><button class="btn dark" data-open="new-task">＋ 新建任务</button>`;
  return shell(`<section class="page home-page">
    <header class="home-heading"><div><span class="eyebrow">PERSONAL WORKSPACE</span><h3>今天，把重要的事放在眼前</h3><p>任务、记录与探索都来自现有本地数据，不额外请求服务。</p></div><time class="home-clock" id="home-clock" datetime="${today.iso}" aria-label="当前本地时间">00:00:00</time></header>
    <div class="home-bento">
      <article class="home-card home-card-interactive home-focus">${focusContent}</article>
      <article class="home-card home-date" aria-label="今日日期"><span class="home-card-kicker">今日日期</span><time data-home-date datetime="${today.date}"><strong data-home-date-day>${today.day}</strong><span><b data-home-date-weekday>${today.weekday}</b><small><i data-home-date-month>${today.month}</i> · <i data-home-date-year>${today.year}</i></small></span></time></article>
      <article class="home-card home-card-interactive home-tasks"><div class="home-card-head"><div><span class="home-card-kicker">任务节奏</span><h4>${tasks.length} 个任务</h4></div><button class="home-link" data-nav="tasks">查看全部 →</button></div><div class="home-task-counts">${STATUS.map((status)=>`<div><b>${taskCounts[status]}</b><span>${STATUS_LABELS[status]}</span></div>`).join('')}</div></article>
      <article class="home-card home-card-interactive home-notes"><div class="home-card-head"><div><span class="home-card-kicker">最近记录</span><h4>${state.notesMode} Notes</h4></div><button class="home-link" data-nav="notes">打开笔记 →</button></div>${recentNotes.length?`<div class="home-note-list">${recentNotes.map((note)=>`<button data-open-note="${esc(note.id)}"><b>${esc(note.title || note.content?.split(/\n/)[0]?.slice(0,40) || '未命名记录')}</b><span>${esc(noteCategory(note))} · ${dateText(note.updatedAt)}</span></button>`).join('')}</div>`:'<p class="home-empty">还没有记录，随手写下第一条想法。</p>'}</article>
      <article class="home-card home-card-interactive home-radar"><div class="home-card-head"><div><span class="home-card-kicker">探索窗口</span><h4>${esc(activeRadarProfile()?.name || '探索雷达')}</h4></div><button class="home-link" data-nav="radar">进入 Radar →</button></div>${radarItems.length?`<div class="home-radar-list">${radarItems.map((item)=>`<div><span>${esc(item.section)}</span><b>${esc(item.title)}</b></div>`).join('')}</div>`:'<p class="home-empty">当前方向还没有可展示的探索内容。</p>'}</article>
      <article class="home-card home-card-interactive home-actions"><div><span class="home-card-kicker">快捷操作</span><h4>直接开始</h4></div><div class="home-action-list"><button data-open="new-task"><span>＋</span>新建任务</button><button data-new-note><span>✎</span>写笔记</button><button data-nav="radar"><span>⌁</span>打开 Radar</button></div></article>
    </div>
  </section>`, '首页', '本地工作台 · 不主动联网');
}

function playgroundPage() {
  if (state.playgroundView === 'music' || state.playgroundView === 'keyboard') {
    const isMusic = state.playgroundView === 'music';
    const title = isMusic ? 'Music Geometry' : 'Keyboard Art';
    const subtitle = isMusic ? '让声音推动曲线穿过坐标空间' : '用 A–K 键生成光线、粒子与数学花纹';
    return shell(`<section class="page playground-page playground-work-page">
      <div class="playground-work-head">
        <button class="btn" type="button" data-playground-back>← 返回作品列表</button>
        <div><span class="eyebrow">LIVE CANVAS</span><h3>${title}</h3><p>${subtitle}</p></div>
      </div>
      <div id="playground-mount" class="playground-mount" data-artwork="${state.playgroundView}">
        <div class="playground-loading" role="status"><span></span><b>正在唤醒作品…</b><small>仅在此刻加载对应模块</small></div>
      </div>
    </section>`, 'Playground', `数字艺术实验室 · ${title}`);
  }
  return shell(`<section class="page playground-page">
    <div class="page-head playground-intro"><div><span class="eyebrow">DIGITAL ART LAB</span><h3>让代码暂时离开效率</h3><p>两个独立的实时画布，只在你选择作品后加载和运行。</p></div><span class="playground-cold-badge">按需唤醒</span></div>
    <div class="playground-grid">
      <article class="playground-card playground-card-music">
        <div class="playground-card-art" aria-hidden="true"><i></i><i></i><i></i><span>∿</span></div>
        <div class="playground-card-copy"><span class="home-card-kicker">AUDIO × MATHEMATICS</span><h4>Music Geometry</h4><p>主动选择正在播放音乐的浏览器标签页，看波动、旋转和穿梭轨迹随共享音频改变行为。</p><ul><li>标签页音频捕获</li><li>三类动态曲线</li><li>本地文件备用</li></ul><button class="btn primary" type="button" data-playground-open="music">进入作品 →</button></div>
      </article>
      <article class="playground-card playground-card-keyboard">
        <div class="playground-card-art keyboard-preview" aria-hidden="true"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><span>✦</span></div>
        <div class="playground-card-copy"><span class="home-card-kicker">KEYS × GENERATIVE ART</span><h4>Keyboard Art</h4><p>敲击 A–K，让不同规则生成光点、花纹与丝线，并以柔和的合成音效回应每次创作。</p><ul><li>8 种视听效果</li><li>静音与音量控制</li><li>粒子和声部保护</li></ul><button class="btn primary" type="button" data-playground-open="keyboard">进入作品 →</button></div>
      </article>
    </div>
    <p class="playground-footnote">作品模块不会在首页或此列表页预加载；离开作品后动画、音频和输入监听会停止。</p>
  </section>`, 'Playground', '原生 Canvas · 本地运行 · 不保存作品数据');
}

function destroyActiveArtwork() {
  artworkLoadToken += 1;
  if (!activeArtwork) return;
  try { activeArtwork.instance.destroy(); }
  catch (error) { console.warn('Playground cleanup failed', error); }
  activeArtwork = null;
}

async function mountArtwork(kind) {
  const modulePath = PLAYGROUND_MODULES[kind];
  const mount = document.querySelector('#playground-mount');
  if (!modulePath || !mount) return;
  const token = ++artworkLoadToken;
  try {
    const module = await import(modulePath);
    if (token !== artworkLoadToken || state.route !== 'playground' || state.playgroundView !== kind || !mount.isConnected) return;
    if (typeof module.createArtwork !== 'function') throw new Error('作品模块没有提供 createArtwork()');
    const instance = module.createArtwork(mount);
    if (!instance || ['start','pause','destroy'].some((method) => typeof instance[method] !== 'function')) throw new Error('作品生命周期接口不完整');
    if (token !== artworkLoadToken || !mount.isConnected) { instance.destroy(); return; }
    activeArtwork = { kind, instance };
    instance.start();
  } catch (error) {
    if (token !== artworkLoadToken || !mount.isConnected) return;
    mount.innerHTML = `<div class="playground-load-error"><b>作品暂时无法启动</b><p>${esc(error.message || '模块加载失败')}</p><button class="btn" type="button" data-playground-retry="${kind}">重试</button></div>`;
  }
}

function taskList() {
  const tasks = [...state.data.tasks]
    .filter((t) => !state.search || `${t.title} ${t.requirement} ${t.ownerName || ''}`.toLowerCase().includes(state.search.toLowerCase()))
    .filter((t) => state.status === 'All' || t.status === state.status)
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = Object.fromEntries(STATUS.map((s) => [s, state.data.tasks.filter((t) => t.status === s).length]));
  const total = Math.max(state.data.tasks.length, 1);
  return shell(`<section class="page">
    <div class="page-head"><div><span class="eyebrow">TASK CENTER</span><h3>把注意力放在下一步</h3><p>集中查看任务状态、负责人和最近更新。</p></div><button class="btn primary" data-open="new-task">＋ 新建任务</button></div>
    <div class="stat-row">${STATUS.map((s) => `<div class="card stat stat-${s.toLowerCase()}"><div><span>${STATUS_LABELS[s]}</span><b>${counts[s]}</b></div><i aria-hidden="true"><em style="width:${Math.round(counts[s] / total * 100)}%"></em></i></div>`).join('')}</div>
    <div class="toolbar surface-toolbar"><div class="search"><span>⌕</span><label class="sr-only" for="task-search">搜索任务</label><input id="task-search" class="input" type="search" placeholder="搜索任务、要求或负责人" value="${esc(state.search)}"></div>
      <select id="status-filter" class="select filter" aria-label="状态筛选"><option value="All">全部状态</option>${STATUS.map((s) => `<option value="${s}" ${state.status === s ? 'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
    <div class="card task-table">${tasks.length ? `<table><thead><tr><th>任务</th><th>状态</th><th>负责人</th><th>下一步</th><th>更新</th><th aria-label="打开"></th></tr></thead><tbody>${tasks.map((t) => `<tr class="click-row" data-task="${t.id}"><td><div class="title-cell">${esc(t.title)}</div><div class="subtle">${esc((t.requirement || '').slice(0,70))}</div></td><td>${badge(t.status)}</td><td><span class="owner-cell">${esc(t.ownerName || '未分配')}</span></td><td class="next-cell">${esc(t.next || '—')}</td><td class="subtle">${dateText(t.updatedAt)}</td><td class="row-arrow">→</td></tr>`).join('')}</tbody></table>` : empty('还没有匹配的任务','新建一个任务，开始记录进展。')}</div>
  </section>`, '任务管理', `${state.data.tasks.length} 个任务 · 浏览器本地持久化`);
}

function taskDetail() {
  const task = state.data.tasks.find((t) => t.id === state.taskId);
  if (!task) { state.route = 'tasks'; return taskList(); }
  const activities = state.data.activity.filter((a) => a.taskId === task.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const handoffs = state.data.handoffs.filter((h) => h.taskId === task.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const showingActivity = state.taskHistoryTab !== 'handoffs';
  const latestProgress = activities.find((a) => a.type === 'update' && a.progress?.trim());
  return shell(`<section class="page task-detail-page">
    <button class="back-link" data-nav="tasks">← 返回任务列表</button>
    <header class="task-detail-head"><div><div class="task-title-line"><h3>${esc(task.title)}</h3>${badge(task.status)}</div><div class="task-meta"><span><b>负责人</b>${esc(task.ownerName || '未分配')}</span><span><b>最近更新</b>${dateText(task.updatedAt || task.createdAt)}</span></div></div><button class="btn danger small" data-delete-task="${task.id}">删除任务</button></header>
    <div class="task-description"><span>任务要求</span><div class="prose">${esc(task.requirement || '暂无任务要求')}</div></div>
    <div class="task-actions" aria-label="任务操作"><button class="btn primary" data-open="update-task">更新进度</button><button class="btn dark" data-open="handoff">交接任务</button></div>
    <section class="task-focus" aria-label="任务当前情况">
      <div class="task-summary"><h4>最新进展</h4><div class="prose">${esc(latestProgress?.progress || '暂无进展记录')}</div>${task.status === 'Blocked' && task.blockedReason ? `<div class="warning"><b>阻塞说明：</b><span class="prose">${esc(task.blockedReason)}</span></div>`:''}</div>
      <div class="task-next"><span>下一步</span><div class="prose">${esc(task.next || '暂未设置下一步')}</div></div>
    </section>
    <section class="task-remark"><h4>备注</h4><div class="prose">${esc(task.remark || '暂无备注')}</div>${task.delivery ? `<p class="subtle">交付对象或标准：${esc(task.delivery)}</p>` : ''}</section>
    <section class="task-history"><div class="history-tabs" role="tablist" aria-label="任务历史"><button class="history-tab ${showingActivity ? 'active':''}" type="button" role="tab" aria-selected="${showingActivity}" data-history-tab="activity">进度记录 <span>${activities.length}</span></button><button class="history-tab ${showingActivity ? '':'active'}" type="button" role="tab" aria-selected="${!showingActivity}" data-history-tab="handoffs">交接记录 <span>${handoffs.length}</span></button></div>
      <div class="history-panel" role="tabpanel">${showingActivity ? (activities.length ? `<div class="timeline">${activities.map(activityItem).join('')}</div>` : '<p class="subtle">暂无进度记录</p>') : (handoffs.length ? `<div class="timeline">${handoffs.map(handoffItem).join('')}</div>` : '<p class="subtle">暂无交接记录</p>')}</div>
    </section>
  </section>`, '任务详情', task.title);
}

function activityItem(a) {
  const changeValue = (change, value) => change.field === 'status' ? (STATUS_LABELS[value] || value || '空') : (value || '空');
  const changes = (a.changes || []).map((c) => `${FIELD_LABELS[c.field] || c.field}：${changeValue(c, c.from)} → ${changeValue(c, c.to)}`).join('；');
  return `<div class="event"><div class="event-head"><div><b>${esc(a.actor || '未署名')}</b><span class="event-kind">${esc(a.type === 'handoff' ? '任务交接' : a.type === 'created' ? '创建任务' : '进度更新')}</span></div><time>${dateText(a.createdAt)}</time></div>${a.progress ? `<div class="event-content prose">${esc(a.progress)}</div>`:''}${changes ? `<p class="event-changes">${esc(changes)}</p>`:''}</div>`;
}

function handoffItem(h) {
  const progress = h.progress || (h.remark ? `旧记录未保存进度；备注快照：${h.remark}` : '无');
  return `<div class="event handoff-event"><div class="event-head"><div><b>${esc(h.fromName || '未分配')} → ${esc(h.toName || '未知成员')}</b><span class="event-kind">负责人交接</span></div><time>${dateText(h.createdAt)}</time></div>${h.note ? `<div class="event-content prose">${esc(h.note)}</div>`:''}<dl class="snapshot"><div><dt>当时任务状态</dt><dd>${esc(STATUS_LABELS[h.status] || h.status || '未记录')}</dd></div><div><dt>当时进度快照</dt><dd class="prose">${esc(progress)}</dd></div><div><dt>当时下一步</dt><dd class="prose">${esc(h.next || '无')}</dd></div></dl></div>`;
}

function noteCategory(note) {
  return CATEGORIES.includes(note.category) ? note.category : note.companyName ? 'Company' : 'Personal';
}

function categoryOptions(selected = 'Personal') {
  return CATEGORIES.map((category) => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('');
}

function noteListItem(note) {
  const title = note.title?.trim() || note.content?.trim().split(/\n/)[0]?.slice(0, 42) || '未命名记录';
  return `<button class="note-list-item ${state.noteId === note.id ? 'active' : ''}" data-select-note="${esc(note.id)}"><span class="note-list-title">${esc(title)}</span><span class="note-list-meta"><b>${esc(noteCategory(note))}</b>${dateText(note.updatedAt)}</span><span class="note-list-preview">${esc(note.content || '暂无正文')}</span></button>`;
}

function draftFor(noteId) {
  return state.noteDraft?.noteId === noteId && state.noteDraft?.source === state.notesMode ? state.noteDraft : null;
}

function setDraftStatus(text, error = false) {
  const status = document.querySelector('#note-draft-status');
  if (status) { status.textContent = text; status.classList.toggle('error-text', error); }
}

function noteDraftFromForm(form) {
  const noteId = form.dataset.noteId;
  const original = state.notes.find((note) => note.id === noteId);
  const data = new FormData(form);
  return {
    source:state.notesMode,
    noteId,
    title:String(data.get('title') || ''),
    content:String(data.get('content') || ''),
    category:String(data.get('category') || 'Personal'),
    createdAt:state.noteDraft?.createdAt || now(),
    updatedAt:now(),
    revision:Math.max(Number(state.noteDraftRevision || 0), Number(state.noteDraft?.revision || 0)) + 1,
    dirty:!original || String(data.get('title')||'') !== String(original.title||'') || String(data.get('content')||'') !== String(original.content||'') || String(data.get('category')||'') !== String(noteCategory(original))
  };
}

function queueNoteDraft(draft) {
  state.noteDraft = draft;
  state.noteDraftRevision = draft.revision;
  setDraftStatus('草稿保存中…');
  noteDraftWrite = noteDraftWrite.catch(() => {}).then(() => notesDrafts.save(draft)).then((saved) => {
    if (state.noteDraft?.noteId === saved.noteId && Number(saved.revision) === Number(state.noteDraftRevision)) setDraftStatus('草稿已自动保存');
    return saved;
  }).catch((error) => { setDraftStatus(`草稿保存失败：${error.message}`, true); throw error; });
  return noteDraftWrite;
}

function scheduleNoteDraft(form) {
  const draft = noteDraftFromForm(form);
  state.noteDraft = draft;
  state.noteDraftRevision = draft.revision;
  state.noteDraftRestored = false;
  form.dataset.dirty = String(draft.dirty);
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = !draft.dirty || state.noteSaving;
  clearTimeout(noteDraftTimer);
  noteDraftTimer = setTimeout(() => queueNoteDraft(draft).catch(() => {}), 280);
}

async function flushNoteDraft() {
  const form = document.querySelector('#note-editor-form');
  clearTimeout(noteDraftTimer);
  noteDraftTimer = null;
  if (form) {
    const draft = noteDraftFromForm(form);
    if (draft.dirty || String(draft.noteId).startsWith('new:')) await queueNoteDraft(draft);
  }
  await noteDraftWrite.catch(() => {});
}

async function openNoteEditor(noteId) {
  if (state.route === 'notes') await flushNoteDraft();
  state.noteId = noteId;
  await restoreNoteDraft(noteId);
  state.route = 'notes';
  persistNotesUi(true);
  render();
}

async function startNewNote() {
  if (state.route === 'notes') await flushNoteDraft();
  const noteId = `new:${crypto.randomUUID()}`;
  const timestamp = now();
  const draft = {source:state.notesMode,noteId,title:'',content:'',category:state.selectedCategory==='All'?'Personal':state.selectedCategory,createdAt:timestamp,updatedAt:timestamp,revision:1,dirty:false};
  state.noteId=noteId; state.noteDraft=draft; state.noteDraftRevision=1;
  state.noteDraftRestored=false;
  await notesDrafts.save(draft);
  persistNotesUi(true);
  render();
}

function noteEditor(note) {
  const isNew = !note || String(note.id).startsWith('new:');
  const draft = draftFor(note.id) || note || {};
  const dirty = Boolean(draft.dirty);
  return `<form class="note-workspace-editor" id="note-editor-form" data-note-id="${esc(note.id)}" data-dirty="${dirty}">
    <div class="note-editor-toolbar"><span>${isNew ? '新记录' : `更新于 ${dateText(note.updatedAt)}`}</span>${isNew ? '' : `<button type="button" class="btn small danger" data-delete-note="${esc(note.id)}">删除</button>`}</div>
    <input class="note-title-input" name="title" maxlength="160" placeholder="标题（可空）" value="${esc(draft.title || '')}">
    <textarea class="note-body-input" name="content" placeholder="记下此刻的想法…" autofocus>${esc(draft.content || '')}</textarea>
    <footer class="note-editor-footer"><label>Category <select class="select" name="category">${categoryOptions(draft.category || 'Personal')}</select></label><div><span class="save-status subtle" id="note-draft-status">${state.noteDraftRestored ? '已恢复本地草稿' : '没有未保存的修改'}</span><button class="btn primary" type="submit" ${dirty && !state.noteSaving ? '' : 'disabled'}>${state.noteSaving?'正在保存…':'保存 Note'}</button></div></footer>
  </form>`;
}

function notesPage() {
  const q = state.search.toLowerCase();
  const notes = [...state.notes]
    .filter((n) => state.selectedCategory === 'All' || noteCategory(n) === state.selectedCategory)
    .filter((n) => !q || `${n.title || ''} ${n.content || ''} ${noteCategory(n)}`.toLowerCase().includes(q))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  // IndexedDB draft records have their own storage key in `id`; the editor
  // must keep using the logical noteId or a restored new draft is mistaken for
  // an existing note and its draft cannot be cleared after a formal save.
  let selected = String(state.noteId||'').startsWith('new:') ? { ...state.noteDraft, id:state.noteId } : state.notes.find((n) => n.id === state.noteId) || (state.noteDraft ? {...state.noteDraft,id:state.noteId} : null);
  if (!selected && notes.length) { selected = notes[0]; state.noteId = selected.id; }
  const unavailable = state.notesError ? `<div class="warning"><b>${esc(state.notesMode)} 当前不可用：</b>${esc(state.notesError)}</div>` : '';
  return shell(`<section class="page notes-page"><div class="page-head"><div><span class="eyebrow">QUICK CAPTURE</span><h3>随手记下，再慢慢整理</h3><p>快速记录，按分类查看；标题可以留空。</p></div><button class="btn primary" data-new-note ${state.notesError ? 'disabled' : ''}>＋ 新建笔记</button></div>${unavailable}
    <div class="notes-workspace card"><aside class="notes-list-pane"><div class="notes-list-tools"><div class="search"><span>⌕</span><label class="sr-only" for="note-search">搜索记录</label><input id="note-search" class="input" type="search" placeholder="搜索记录" value="${esc(state.search)}"></div><select id="note-category-filter" class="select" aria-label="分类筛选"><option value="All">全部分类</option>${categoryOptions(state.selectedCategory)}</select></div><div class="notes-list">${notes.length ? notes.map(noteListItem).join('') : `<div class="empty compact"><b>暂无记录</b><p>新建一条简单记录。</p></div>`}</div></aside><section class="note-editor-pane">${selected ? noteEditor(selected) : empty('选择或新建 Note','编辑区会在这里打开。')}</section></div>
  </section>`, '随手笔记', `${state.notes.length} 条记录 · ${state.notesMode}`);
}

function categoriesPage() {
  const groups = CATEGORIES.map((category) => ({ category, notes: state.notes.filter((note) => noteCategory(note) === category).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) }));
  const active = state.selectedCategory === 'All' ? null : groups.find((group) => group.category === state.selectedCategory);
  return shell(`<section class="page"><div class="page-head"><div><span class="eyebrow">LIBRARY</span><h3>内容分类</h3><p>轻量聚合笔记，快速回到同一主题。</p></div></div>
    <div class="category-grid">${groups.map((group) => `<button class="card category-card ${active?.category === group.category ? 'active' : ''}" data-category="${esc(group.category)}"><span>${esc(group.category)}</span><b>${group.notes.length}</b><small>条记录</small></button>`).join('')}</div>
    <section class="category-notes"><div class="section-title"><h4>${active ? esc(active.category) : '最近记录'}</h4><button class="btn small" data-category="All">查看全部</button></div>${(active ? active.notes : [...state.notes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)).length ? `<div class="category-note-list">${(active ? active.notes : [...state.notes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)).map((note) => `<button data-open-note="${esc(note.id)}"><b>${esc(note.title || note.content?.slice(0, 52) || '未命名记录')}</b><span>${esc(noteCategory(note))} · ${dateText(note.updatedAt)}</span></button>`).join('')}</div>` : `<div class="card">${empty('这个分类还没有记录','在 Notes 中创建或调整一条记录。')}</div>`}</section>
  </section>`, '内容分类', '简单分类 · 与 Notes 共用数据');
}

function radarCard(item) {
  const sourceType = item.provider && item.provider !== 'Demo' ? '联网来源' : '演示内容';
  return `<article class="card radar-card"><div class="radar-card-top"><span class="category-chip">${esc(item.domain)}</span><span class="subtle">${sourceType} · ${esc(item.sourceName)}</span></div><h4>${esc(item.title)}</h4><p>${esc(item.explanation)}</p>${item.changeSummary ? `<div class="radar-change"><b>本次变化</b><span>${esc(item.changeSummary)}</span></div>` : ''}<div class="radar-why"><b>为什么值得关注</b><span>${esc(item.why)}</span></div><footer><a class="btn small" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a><button class="btn small primary" data-save-radar="${esc(item.id)}">Save Notes</button></footer></article>`;
}

function radarHistoryEntry(entry) {
  const labels={searching:'搜索中',success:'已完成',empty:'无新内容',error:'失败',limited:'达到当日上限',blocked:'已有搜索进行中'};
  const items=Array.isArray(entry.items)?entry.items:[];
  const scope=[...(entry.profileSnapshot?.coreDomains||[]),...(entry.profileSnapshot?.adjacentDomains||[])];
  const usage=entry.searchUsage;
  const usageText=usage?`Tavily：${Number(usage.tavilyCredits||0)} credits / ${Number(usage.tavilyRequests||0)} 次请求；缓存命中 ${Number(usage.cacheHits||0)} 次；DeepSeek Search ${Number(usage.deepseekSearchRequests||0)} 次${usage.accounting==='reserved'?'。Tavily credits 为响应未确认时的保守预留值':''}`:'';
  return `<details class="radar-history-entry" ${entry.status==='searching'?'open':''}><summary><span><b>${esc(labels[entry.status]||entry.status)}</b><small>${dateText(entry.createdAt)} · ${entry.remote?'联网探索':'演示探索'} · ${items.length} 条</small></span><span>查看内容</span></summary><div class="radar-history-body">${scope.length?`<p class="subtle">方向：${esc(scope.join('、'))}</p>`:''}${usageText?`<p class="subtle">${esc(usageText)}</p>`:''}${entry.message?`<p>${esc(entry.message)}</p>`:''}${items.length?`<div class="radar-history-items">${items.map((item)=>`<article><div><b>${esc(item.title)}</b><small>${esc(item.section)} · ${esc(item.sourceName||'Web')}</small></div><p>${esc(item.explanation||'')}</p>${item.sourceUrl?`<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a>`:''}</article>`).join('')}</div>`:'<p class="subtle">本次没有可展示的新推荐内容。</p>'}</div></details>`;
}

function radarPage() {
  const sections = ['Core Domain', 'Adjacent Fields', 'Unknown Window'];
  const profile = activeRadarProfile(); const batch = activeRadarBatch();
  const items = batch?.items || [];
  const shortageParts = sections.filter((section) => batch?.shortages?.[section] > 0).map((section) => `${section} 缺 ${batch.shortages[section]} 条`);
  const credentials = radarCredentials.getCredentials();
  const radarConfig = radarCredentials.getConfig();
  const dailyLimit = Number(radarConfig.dailyLimit || DEFAULT_DAILY_LIMIT);
  const dailyUsed = radarDailyUsage();
  const history = activeRadarHistory();
  const onlineReady = Boolean(credentials.deepseekApiKey);
  const isRemoteBatch = batch?.provider && batch.provider !== 'Demo';
  const limitation = state.radarMessage || (isRemoteBatch ? `本批次由 ${batch.provider || '联网搜索与 DeepSeek'} ${batch.modelId ? `（模型 ${batch.modelId}）` : ''}生成；密钥未写入批次数据。` : batch?.exhausted ? '没有新的匹配内容，当前批次保持不变。可调整方向后再次尝试。' : shortageParts.length ? `当前候选不足：${shortageParts.join('，')}。` : onlineReady ? `真实联网已配置；${credentials.tavilyApiKey ? '优先使用 Tavily，失败时降级到 DeepSeek Search。' : '未配置 Tavily，将使用 DeepSeek Search。'}当前展示仍是上一次保存的批次。` : '当前批次来自内置演示候选库。在 Settings 配置 DeepSeek 后可启用真实联网；Tavily 可选。');
  return shell(`<section class="page radar-page">
    <div class="radar-profile-bar card"><label>探索方向<select class="select" id="radar-profile-select">${state.radarProfiles.map((item)=>`<option value="${esc(item.id)}" ${item.id===profile?.id?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><div class="radar-profile-actions"><button class="btn small" data-open="edit-radar-profile">编辑</button>${profile?.isDefault?'':`<button class="btn small danger" data-delete-radar-profile="${esc(profile?.id)}">删除</button>`}<button class="btn small primary" data-open="new-radar-profile">＋ 新建方向</button></div></div>
    <div class="radar-profile-scope"><div><b>核心领域</b>${(profile?.coreDomains||[]).map((domain)=>`<span>${esc(domain)}</span>`).join('') || '<em>未设置</em>'}</div><div><b>相邻领域</b>${(profile?.adjacentDomains||[]).map((domain)=>`<span>${esc(domain)}</span>`).join('') || '<em>未设置</em>'}</div><p>Unknown Window 保持开放。每个探索方向独立保留当前批次和历史，切换后可随时回来继续查看。</p></div>
    <div class="page-head"><div><span class="eyebrow">DISCOVERY FEED</span><h3>本次探索</h3><p>修改方向不会清除当前批次；仅下一次探索使用新配置。</p></div><button class="btn primary" data-explore-new ${state.radarSearching?'disabled aria-busy="true"':''}>${state.radarSearching?'正在联网搜索，请稍候…':'开始新探索'}</button></div>
    <div class="radar-demo-notice ${shortageParts.length || batch?.exhausted ? 'warning' : ''}"><b>${isRemoteBatch ? 'Live Provider' : onlineReady ? 'Ready' : 'Demo Provider'}</b><span>${esc(limitation)}</span></div>
    <div class="radar-batch-meta"><span>探索批次 ${Number(batch?.sequence || 1)}</span><span>生成于 ${dateText(batch?.createdAt || now())}</span><span>共 ${items.length} 条</span><span>今日联网探索 ${dailyUsed} / ${dailyLimit}</span>${batch?.searchUsage ? `<span>Tavily ${Number(batch.searchUsage.tavilyCredits||0)} credits · 缓存 ${Number(batch.searchUsage.cacheHits||0)} 次 · DeepSeek Search ${Number(batch.searchUsage.deepseekSearchRequests||0)} 次${batch.searchUsage.accounting==='reserved'?'（Tavily 为保守预留）':''}</span>`:''}</div>
    ${sections.map((section) => { const sectionItems=items.filter((item) => item.section === section); return `<section class="radar-section"><div class="section-title"><h4>${section}</h4><span>${sectionItems.length} / ${QUOTAS[section]}</span></div>${sectionItems.length?`<div class="radar-grid">${sectionItems.map(radarCard).join('')}</div>`:`<div class="radar-empty">暂无匹配的演示内容</div>`}</section>`; }).join('')}
    <section class="radar-history"><div class="section-title"><div><h4>探索历史</h4><p>当前方向的成功、无结果、失败和限额记录都会保留。</p></div><span>${history.length} 次</span></div>${history.length?history.map(radarHistoryEntry).join(''):'<div class="radar-empty">这个方向还没有探索记录</div>'}</section>
  </section>`, '探索雷达', `${state.radarProfiles.length} 个探索方向 · 当前为 ${profile?.name || '未选择'}`);
}

function teamSettings() {
  const members = [...state.data.team].sort((a,b) => a.name.localeCompare(b.name));
  return `<article class="card setting-card"><div class="page-head" style="margin-bottom:10px"><div><h4>Team</h4><p>用于任务负责人和交接选择。</p></div><button class="btn small" data-open="new-member">＋ 添加成员</button></div>
    ${members.length ? `<table><thead><tr><th>姓名</th><th>邮箱</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="subtle">${esc(m.email)}</td><td><button class="btn small" data-edit-member="${m.id}">编辑</button> <button class="btn small danger" data-delete-member="${m.id}">删除</button></td></tr>`).join('')}</tbody></table>` : '<p class="subtle">尚未添加成员。</p>'}
  </article>`;
}

function settingsPage() {
  const config = notesCredentials.getConfig();
  const radarConfig = radarCredentials.getConfig();
  const radarKeys = radarCredentials.getCredentials();
  const radarConfigured = Boolean(radarKeys.deepseekApiKey);
  return shell(`<section class="page"><div class="page-head"><div><h3>Settings</h3><p>存储状态、团队和备份。</p></div></div>
    <div class="settings-grid"><article class="card setting-card"><h4>TaskFlow 服务状态</h4><p class="subtle">任务存储与 Notes 存储相互独立。</p><div class="setting-row"><span>Task Storage</span><span class="setting-value ready">Local</span></div><div class="setting-row"><span>Remote Adapter</span><span class="setting-value muted">Not Configured</span></div><div class="setting-row"><span>Email Notification</span><span class="setting-value muted">Not Configured</span></div></article>
      <article class="card setting-card"><h4>数据备份</h4><p class="subtle">覆盖本地 Tasks、Notes、Radar Profiles / Batches、Team 及历史记录。导入采用合并策略，相同 ID 保留已有记录；Memos 远端笔记和访问令牌不会导出。历史备份中的已退役数据仅保留结构兼容，不再显示或迁移。</p><div class="import-box"><button class="btn dark" id="export-data">导出本地 JSON</button><label class="btn" for="import-data">导入 JSON</label><input class="sr-only" id="import-data" type="file" accept="application/json,.json"></div><div class="warning" style="margin-top:18px">浏览器存储不是云端备份。file:// 数据可能按浏览器与文件路径隔离，清除站点数据仍会导致丢失。</div></article>
      <article class="card setting-card notes-storage-card"><h4>Notes Storage</h4><div class="setting-row"><span>当前模式</span><span class="setting-value ${config.mode === 'Memos' ? 'remote' : 'ready'}">${esc(config.mode || 'Local')}</span></div>
        <div class="field"><label>Memos Server URL</label><input class="input" id="memos-url" type="url" placeholder="https://memos.example.com" value="${esc(config.serverUrl || '')}"><div class="field-hint">可粘贴设置页链接；连接时会自动提取站点根地址，不会把页面路径或 #fragment 当成 API 路径。</div></div>
        <div class="field"><label>API 版本</label><select class="select" id="memos-api"><option value="auto">自动检测</option><option value="/api" ${config.apiBase === '/api' ? 'selected':''}>26.10 / Latest（/api）</option><option value="/api/v1" ${config.apiBase === '/api/v1' ? 'selected':''}>0.30–0.31（/api/v1）</option></select></div>
        <div class="field"><label>Access Token</label><input class="input" id="memos-token" type="password" autocomplete="off" placeholder="不会回显或写入备份"><div class="field-hint">Token 不进入 URL、日志、源码或 JSON 导出。</div></div>
        <label class="check-row"><input id="remember-token" type="checkbox" ${config.remember ? 'checked':''}> 记住令牌（默认关闭；同源脚本或浏览器扩展可能读取本地凭据）</label>
        <div class="import-box"><button class="btn" data-test-memos>Test Connection</button><button class="btn primary" data-connect-memos>Connect</button>${config.mode === 'Memos' ? '<button class="btn" data-disconnect-memos>切回 Local</button>' : ''}<button class="btn danger" data-clear-memos>Clear Credentials</button></div>
        <div id="memos-test-status" class="field-hint">${state.notesError ? esc(state.notesError) : config.mode === 'Memos' ? `已连接 ${esc(config.serverUrl || '')}；仅操作 TaskFlow 标记的 Memos。` : '未配置时 Local 完整可用。连接测试成功后才可启用 Memos。'}</div>
        <div class="warning">从 file:// 连接远程 Memos 可能被 CORS / Origin: null 策略拒绝。不会要求关闭浏览器安全功能，也不会使用第三方代理。</div>
      </article>
      <article class="card setting-card notes-storage-card"><div class="setting-card-head"><div><h4>Radar 联网服务</h4><p class="subtle">DeepSeek 必需；Tavily 可选且优先使用，未配置或服务异常时使用官方 DeepSeek Search。</p></div><span class="setting-value ${radarConfigured ? 'ready' : 'muted'}">${radarConfigured ? 'Configured' : 'Not Configured'}</span></div>
        <div class="field"><label>Tavily API Key（可选）</label><div class="secret-field"><input class="input" id="tavily-key" type="password" autocomplete="off" value="${esc(radarKeys.tavilyApiKey)}" placeholder="tvly-…"><button class="btn small" type="button" data-toggle-secret="tavily-key" aria-label="显示 Tavily API Key">显示</button></div><div class="field-hint">配置后优先使用 Tavily；连接测试不会调用搜索接口或消耗 credits，首次探索时才验证。</div></div>
        <div class="field"><label>DeepSeek API Key</label><div class="secret-field"><input class="input" id="deepseek-key" type="password" autocomplete="off" value="${esc(radarKeys.deepseekApiKey)}" placeholder="sk-…"><button class="btn small" type="button" data-toggle-secret="deepseek-key" aria-label="显示 DeepSeek API Key">显示</button></div></div>
        <div class="field"><label>DeepSeek Model ID</label><input class="input" id="deepseek-model" maxlength="64" value="${esc(radarConfig.modelId || DEFAULT_MODEL_ID)}" placeholder="${DEFAULT_MODEL_ID}"><div class="field-hint">模型名称会独立保存且不属于秘密；仅接受 deepseek- 开头的模型 ID。</div></div>
        <div class="field"><label>单日联网探索上限</label><input class="input" id="radar-daily-limit" type="number" min="1" max="50" step="1" value="${Number(radarConfig.dailyLimit || DEFAULT_DAILY_LIMIT)}"><div class="field-hint">默认 3 次，由当前浏览器在本地计数；可以设置为 1–50。测试连接和演示探索不计入。</div></div>
        <label class="check-row"><input id="remember-radar-keys" type="checkbox" ${radarConfig.remember ? 'checked':''}> 长期保存在此设备（默认关闭；取消后保存会清除原有持久化密钥）</label>
        <div class="import-box"><button class="btn" data-test-radar>测试连接</button><button class="btn primary" data-save-radar-config>保存配置</button><button class="btn danger" data-clear-radar-config>清除配置</button></div>
        <div id="radar-test-status" class="field-hint">${state.radarTest ? esc(state.radarTest) : radarConfigured ? `已配置 DeepSeek · ${esc(radarConfig.modelId || DEFAULT_MODEL_ID)}。${radarKeys.tavilyApiKey?'Tavily 已填写，将在首次探索时验证。':'未配置 Tavily，将使用 DeepSeek Search。'}` : '未配置 DeepSeek 时 Radar 保持 Demo 模式。'}</div>
        <div class="warning">密码框中的黑点表示当前会话或本设备已有密钥。未勾选长期保存时，密钥只保留到当前页面会话结束；长期保存会增加共享设备、同源脚本与 XSS 风险。密钥不会进入 URL、TaskFlow JSON 备份或服务端持久化数据。</div>
      </article>
      ${teamSettings()}
      <article class="card setting-card"><h4>接口边界</h4><p class="subtle">TaskFlow 继续通过既有 Storage Adapter 访问本地数据，Remote Adapter 预留未删除。Notes 使用独立的 LocalNotesAdapter / MemosNotesAdapter；Radar 未配置凭证时使用 Demo Provider，配置后由同源 FastAPI 服务调用 Tavily 与 DeepSeek。通知接口仍仅定义 TaskCreated 与 TaskHandedOff，未配置时不模拟发送。</p></article>
    </div></section>`, 'Settings', 'TaskFlow 与 Notes 存储独立配置');
}

function empty(title, text) { return `<div class="empty"><div class="empty-mark">◇</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`; }

function memberOptions(selected = '') {
  return `<option value="">未分配</option>${state.data.team.map((m) => `<option value="${m.id}" ${selected === m.id ? 'selected':''}>${esc(m.name)}</option>`).join('')}`;
}

function isCurrentOwner(task, member) {
  return member.id === task.ownerId || (!task.ownerId && task.ownerName && member.name === task.ownerName);
}

function handoffMemberOptions(task) {
  const members = state.data.team.filter((member) => !isCurrentOwner(task, member));
  return `<option value="">请选择接手人</option>${members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}`;
}

function renderDrawer() {
  if (!state.drawer) return '';
  const d = state.drawer;
  let title = '', body = '', submit = '';
  if (d.type === 'new-task') { title='新建任务'; submit='创建任务'; body=`<div class="field"><label>任务名称 <span>*</span></label><input class="input" name="title" required maxlength="120"></div><div class="field"><label>任务要求 <span>*</span></label><textarea class="textarea" name="requirement" required></textarea></div><div class="two-col"><div class="field"><label>负责人</label><select class="select" name="ownerId">${memberOptions()}</select></div><div class="field"><label>任务状态</label><select class="select" disabled><option>待办</option></select></div></div><div class="field"><label>下一步</label><textarea class="textarea" name="next"></textarea></div><div class="field"><label>备注</label><textarea class="textarea" name="remark" placeholder="背景、注意事项或补充说明"></textarea></div>`; }
  if (d.type === 'update-task') { const t=state.data.tasks.find((x)=>x.id===state.taskId); title='更新进度'; submit='保存更新'; body=`<div class="field"><label>本次完成了什么？</label><textarea class="textarea" name="progress" placeholder="填写后会追加到 Activity，不覆盖历史。" autofocus></textarea></div><div class="field"><label>下一步是什么？</label><textarea class="textarea" name="next" placeholder="接下来要做什么？">${esc(t.next||'')}</textarea></div><div class="field"><label>任务状态？</label><select class="select" name="status">${STATUS.map((s)=>`<option value="${s}" ${s===t.status?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>`; }
  if (d.type === 'handoff') { const t=state.data.tasks.find((x)=>x.id===state.taskId); const available=state.data.team.some((m)=>!isCurrentOwner(t,m)); title='交接任务'; submit='确认交接'; body=`<div class="handoff-flow"><div class="active"><b>1</b><span>当前负责人</span></div><i>↓</i><div><b>2</b><span>接手人</span></div><i>↓</i><div><b>3</b><span>确认交接</span></div></div><div class="field"><label>当前负责人</label><input class="input" value="${esc(t.ownerName||'未分配')}" disabled></div><div class="field"><label>接手人 <span>*</span></label><select class="select" name="toId" id="handoff-to" required ${available?'':'disabled'}>${handoffMemberOptions(t)}</select>${available?'':'<div class="field-hint error-text">Team 中没有其他可接手的成员，请先到 Settings 添加成员。</div>'}</div><div class="field"><label>交接说明</label><textarea class="textarea" name="note" placeholder="交接背景、注意事项或待处理内容"></textarea></div><div class="handoff-confirm" id="handoff-confirm">请选择接手人。确认时会保存当时任务状态和最新进展快照；完成状态不会改变。</div>`; }
  if (d.type === 'new-radar-profile' || d.type === 'edit-radar-profile') { const profile=d.type==='edit-radar-profile'?(state.radarProfiles.find((item)=>item.id===d.id)||activeRadarProfile()):null; const editing=Boolean(profile); title=editing?'编辑探索方向':'新建探索方向'; submit=editing?'保存配置':'创建方向'; body=`<div class="field"><label>方向名称 <span>*</span></label><input class="input" name="name" required maxlength="60" value="${esc(profile?.name||'')}" ${profile?.isDefault?'readonly':''}></div><div class="field"><label>核心领域</label><textarea class="textarea" name="coreDomains" placeholder="每行填写一个领域">${esc((profile?.coreDomains||[]).join('\n'))}</textarea><div class="field-hint">演示提供方目前支持：AI Engineering、Personal Productivity、Knowledge Management。</div></div><div class="field"><label>相邻领域</label><textarea class="textarea" name="adjacentDomains" placeholder="每行填写一个领域">${esc((profile?.adjacentDomains||[]).join('\n'))}</textarea><div class="field-hint">演示提供方目前支持：Learning Science、Behavioral Science、Product Design。</div></div><div class="warning">修改配置不会清除当前批次；下一次 Explore New 才会按新配置查找演示候选。Unknown Window 始终保持开放。</div>`; }
  if (d.type === 'new-member' || d.type === 'edit-member') { const m=state.data.team.find((x)=>x.id===d.id); title=d.type==='new-member'?'添加成员':'编辑成员'; submit='保存成员'; body=`<div class="field"><label>Name <span>*</span></label><input class="input" name="name" required value="${esc(m?.name||'')}"></div><div class="field"><label>Email <span>*</span></label><input class="input" name="email" type="email" required value="${esc(m?.email||'')}"></div>`; }
  return `<div class="drawer-backdrop"><form class="drawer" id="drawer-form"><header class="drawer-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></header><div class="drawer-body">${body}</div><footer class="drawer-foot"><button type="button" class="btn" data-close>取消</button><button class="btn primary" type="submit">${submit}</button></footer></form></div>`;
}

function render() {
  stopHomeClock();
  destroyActiveArtwork();
  if (state.route === 'home') app.innerHTML = homePage();
  if (state.route === 'radar') app.innerHTML = radarPage();
  if (state.route === 'tasks') app.innerHTML = taskList();
  if (state.route === 'task-detail') app.innerHTML = taskDetail();
  if (state.route === 'notes') app.innerHTML = notesPage();
  if (state.route === 'categories') app.innerHTML = categoriesPage();
  if (state.route === 'settings') app.innerHTML = settingsPage();
  if (state.route === 'playground') app.innerHTML = playgroundPage();
  if (state.route === 'home') startHomeClock();
  if (state.route === 'playground' && PLAYGROUND_MODULES[state.playgroundView]) mountArtwork(state.playgroundView);
}

function openDrawer(type, id = null) { state.drawer = { type, id }; render(); }
function closeDrawer() { state.drawer = null; render(); }

async function refresh(message) { await loadData(); render(); if (message) toast(message); }

async function onSubmit(form) {
  const fd = new FormData(form); const d = state.drawer; const timestamp = now();
  if (d.type === 'new-task') {
    const owner = state.data.team.find((m) => m.id === fd.get('ownerId'));
    const task = { id:uid('task'), title:fd.get('title').trim(), requirement:fd.get('requirement').trim(), ownerId:owner?.id||'', ownerName:owner?.name||'', delivery:'', next:fd.get('next').trim(), status:'Todo', remark:fd.get('remark').trim(), blockedReason:'', createdAt:timestamp, updatedAt:timestamp };
    await storage.put('tasks',task); await storage.put('activity',{ id:uid('activity'), taskId:task.id, type:'created', actor:owner?.name||'未署名', progress:'创建了任务', changes:[], createdAt:timestamp });
    await notifications.notify(NotificationEvents.TaskCreated, formatTaskNotification(NotificationEvents.TaskCreated, task));
    state.drawer=null; await refresh('任务已创建');
  }
  if (d.type === 'update-task') {
    const task=state.data.tasks.find((t)=>t.id===state.taskId); const changes=[];
    const updates={ status:fd.get('status'), next:fd.get('next').trim(), updatedAt:timestamp };
    ['status','next'].forEach((field)=>{ if ((task[field]||'') !== (updates[field]||'')) changes.push({field,from:task[field]||'',to:updates[field]||''}); });
    if (!fd.get('progress').trim() && !changes.length) { toast('没有检测到需要保存的更新','error'); return; }
    await storage.put('activity',{id:uid('activity'),taskId:task.id,type:'update',actor:task.ownerName||'未署名',progress:fd.get('progress').trim(),changes,createdAt:timestamp});
    await storage.put('tasks',{...task,...updates}); state.drawer=null; await refresh('任务已更新，历史记录已追加');
  }
  if (d.type === 'handoff') {
    const task=state.data.tasks.find((t)=>t.id===state.taskId); const to=state.data.team.find((m)=>m.id===fd.get('toId'));
    if (!to) { toast('请选择接手人','error'); return; }
    if (isCurrentOwner(task,to)) { toast('不能交接给当前负责人','error'); return; }
    if (!confirm(`确认后任务负责人将变更为 ${to.name}。`)) return;
    const latestProgress=state.data.activity.filter((item)=>item.taskId===task.id&&item.type==='update'&&item.progress?.trim()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.progress||'';
    const actor=task.ownerName||'未署名';
    const handoff={id:uid('handoff'),taskId:task.id,fromId:task.ownerId||'',fromName:task.ownerName||'未分配',toId:to.id,toName:to.name,actor,note:fd.get('note').trim(),status:task.status,progress:latestProgress,next:task.next||'',createdAt:timestamp};
    await storage.put('handoffs',handoff); await storage.put('tasks',{...task,ownerId:to.id,ownerName:to.name,updatedAt:timestamp}); await storage.put('activity',{id:uid('activity'),taskId:task.id,type:'handoff',actor,progress:`${handoff.fromName} 将任务交接给 ${to.name}${handoff.note ? `：${handoff.note}`:''}`,changes:[{field:'owner',from:handoff.fromName,to:to.name}],createdAt:timestamp});
    await notifications.notify(NotificationEvents.TaskHandedOff,formatTaskNotification(NotificationEvents.TaskHandedOff,task,handoff.note)); state.drawer=null; await refresh('任务已交接并保存快照');
  }
  if (d.type === 'new-radar-profile' || d.type === 'edit-radar-profile') {
    const old=d.type==='edit-radar-profile'?(state.radarProfiles.find((item)=>item.id===d.id)||activeRadarProfile()):null;
    const name=fd.get('name').trim();
    if (state.radarProfiles.some((item)=>item.id!==old?.id&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase())) { toast('已存在同名探索方向','error'); return; }
    const parseDomains=(value)=>[...new Set(String(value||'').split(/[\n,，]/).map((item)=>item.trim()).filter(Boolean))];
    const profile={id:old?.id||uid('profile'),name:old?.isDefault?old.name:name,coreDomains:parseDomains(fd.get('coreDomains')),adjacentDomains:parseDomains(fd.get('adjacentDomains')),isDefault:Boolean(old?.isDefault),createdAt:old?.createdAt||timestamp,updatedAt:timestamp};
    await storage.put('radarProfiles',profile);
    if (!old) { const batch=await createRadarBatch(profile); await storage.put('radarBatches',batch); state.radarProfiles.push(profile); selectRadarProfile(profile.id); }
    if (old) { const batch=state.radarBatches.find((item)=>item.profileId===profile.id); if (batch?.exhausted) await storage.put('radarBatches',{...batch,exhausted:false,updatedAt:timestamp}); }
    state.radarMessage=''; state.drawer=null; await refresh(old?'探索方向已更新；当前批次保持不变':'探索方向已创建');
  }
  if (d.type === 'new-member' || d.type === 'edit-member') { const old=state.data.team.find((x)=>x.id===d.id); const m={id:old?.id||uid('member'),name:fd.get('name').trim(),email:fd.get('email').trim(),createdAt:old?.createdAt||timestamp,updatedAt:timestamp}; await storage.put('team',m); state.drawer=null; await refresh('成员已保存；历史名称保持不变'); }
}

async function exportData() {
  const payload = await storage.exportData();
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`taskflow-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); toast('JSON 备份已导出');
}

async function importData(file) {
  try { const payload=JSON.parse(await file.text()); const report=await storage.importData(payload); const added=Object.values(report).reduce((n,x)=>n+x.added,0); const skipped=Object.values(report).reduce((n,x)=>n+x.skipped,0); await refresh(`导入完成：新增 ${added} 条，保留已有 ${skipped} 条`); }
  catch(error) { toast(`导入失败：${error.message}`,'error'); }
}

function memosDraft() {
  return { serverUrl:document.querySelector('#memos-url')?.value.trim()||'', apiBase:document.querySelector('#memos-api')?.value||'auto', token:document.querySelector('#memos-token')?.value||notesCredentials.getToken(), remember:Boolean(document.querySelector('#remember-token')?.checked) };
}

async function testMemosConnection() {
  const status=document.querySelector('#memos-test-status');
  try {
    const draft=memosDraft(); if(!draft.token) throw new Error('请输入 Access Token');
    if(status) status.textContent='正在连接…';
    const adapter=new MemosNotesAdapter(draft); const result=await adapter.testConnection();
    state.memosTest={...draft,requestedApi:draft.apiBase,serverUrl:adapter.serverUrl,apiBase:result.apiBase};
    if(status) status.textContent=`连接测试成功：${result.apiBase}。点击 Connect 后才会切换数据源。`;
    toast('Memos 连接测试成功；尚未切换数据源');
  } catch(error) { state.memosTest=null; if(status) status.textContent=error.message; toast(error.message,'error'); }
}

async function connectMemos() {
  if(!state.memosTest) { toast('请先完成 Test Connection','error'); return; }
  const draft=memosDraft(); const normalized=MemosNotesAdapter.normalizeServer(draft.serverUrl);
  if(normalized!==state.memosTest.serverUrl||draft.token!==state.memosTest.token||draft.remember!==state.memosTest.remember||draft.apiBase!==state.memosTest.requestedApi){state.memosTest=null;toast('连接参数已变化，请重新执行 Test Connection','error');return;}
  notesCredentials.saveConnection(state.memosTest); state.memosTest=null; state.search=''; await refresh('Notes 已切换到 Memos；Local 数据未改动');
}

function radarDraft() {
  const saved = radarCredentials.getCredentials();
  return {
    tavilyApiKey:document.querySelector('#tavily-key')?.value.trim() || saved.tavilyApiKey,
    deepseekApiKey:document.querySelector('#deepseek-key')?.value.trim() || saved.deepseekApiKey,
    modelId:document.querySelector('#deepseek-model')?.value.trim() || DEFAULT_MODEL_ID,
    dailyLimit:Number(document.querySelector('#radar-daily-limit')?.value || DEFAULT_DAILY_LIMIT),
    remember:Boolean(document.querySelector('#remember-radar-keys')?.checked)
  };
}

async function testRadarConnection() {
  const status = document.querySelector('#radar-test-status');
  try {
    const draft = radarDraft();
    radarCredentials.validateModel(draft.modelId);
    if (!draft.deepseekApiKey) throw new Error('请填写 DeepSeek API Key；Tavily API Key 可选');
    if (status) status.textContent = '正在验证 DeepSeek 与模型可用性；不会发起付费搜索…';
    const result = await new RemoteRadarProvider(draft).testConnection();
    state.radarTest = `连接成功：DeepSeek 模型 ${result.modelId || draft.modelId} 可用。${draft.tavilyApiKey?'Tavily 已配置，将在首次探索时验证；':'将使用 DeepSeek Search；'}本次未消耗搜索额度。`;
    if (status) status.textContent = state.radarTest;
    radarCredentials.rememberSessionDraft(draft);
    toast('Radar 联网连接测试成功；密钥已保留在当前会话，点击保存可确认长期保存选项');
  } catch (error) {
    state.radarTest = `测试失败：${error.message}`;
    if (status) status.textContent = state.radarTest;
    toast(error.message, 'error');
  }
}

async function saveRadarConfig() {
  try {
    const config = radarCredentials.save(radarDraft());
    state.radarTest = null;
    render();
    toast(`Radar 配置已保存；密钥${config.remember ? '已长期保存在此设备' : '仅保留在当前会话'}`);
  } catch (error) { toast(error.message, 'error'); }
}

async function saveNoteForm(form) {
  if (state.noteSaving) return;
  state.noteSaving = true;
  let completed = false;
  const button=form.querySelector('button[type="submit"]'); if(button){button.disabled=true;button.textContent='正在保存…';}
  const source=state.notesMode; const draftNoteId=form.dataset.noteId;
  try {
    await flushNoteDraft();
    const fd = new FormData(form);
    const content = fd.get('content').trim();
    if (!content && !fd.get('title').trim()) { toast('标题和正文不能同时为空','error'); return; }
    const old = state.notes.find((note) => note.id === draftNoteId);
    const timestamp = now();
    const note = { id:old?.id||uid('note'), source, title:fd.get('title').trim(), content, category:fd.get('category'), createdAt:old?.createdAt||timestamp, updatedAt:timestamp };
    const saved = old ? await currentNotesAdapter().update(note) : await currentNotesAdapter().create(note);
    await notesDrafts.delete(source,draftNoteId);
    state.noteId = saved?.id || note.id; state.noteDraft = null; state.noteDraftRevision=0; state.noteDraftRestored=false;
    persistNotesUi(true);
    state.noteSaving=false;
    completed=true;
    await refresh(source === 'Memos' ? 'Note 已保存到 Memos' : 'Note 已保存在本地');
  } catch(error) {
    setDraftStatus(`正式保存失败，草稿仍保留：${error.message}`,true);
    throw error;
  } finally {
    if (!completed) {
      state.noteSaving=false;
      if(button){button.textContent='保存 Note';button.disabled=!(state.noteDraft?.dirty);}
    }
  }
}

async function exploreNew() {
  if (state.radarSearching) { toast('搜索正在进行中，请等待当前探索完成'); return; }
  const profile=activeRadarProfile(); const current=activeRadarBatch();
  const config=radarCredentials.getConfig(); const keys=radarCredentials.getCredentials();
  const remote=Boolean(keys.deepseekApiKey);
  const provider=remote ? new RemoteRadarProvider({...keys,modelId:config.modelId}) : radarProvider;
  const dailyLimit=Number(config.dailyLimit||DEFAULT_DAILY_LIMIT);
  if(remote&&radarDailyUsage()>=dailyLimit) {
    const timestamp=now();
    await saveRadarHistory({id:uid('radar_attempt'),profileId:profile.id,profileName:profile.name,profileSnapshot:structuredClone(profile),remote:true,status:'limited',items:[],message:`今日已使用 ${radarDailyUsage()} / ${dailyLimit} 次联网探索。可在 Settings 调整客户端单日上限。`,createdAt:timestamp,completedAt:timestamp});
    state.radarMessage=`已达到今天的客户端联网探索上限（${radarDailyUsage()} / ${dailyLimit}）。历史内容仍可查看。`;
    render(); toast('已达到今日联网探索上限','error'); return;
  }
  const startedAt=now();
  let attempt={id:uid('radar_attempt'),profileId:profile.id,profileName:profile.name,profileSnapshot:structuredClone(profile),remote,status:'searching',items:[],message:'正在搜索并整理推荐。',createdAt:startedAt};
  await saveRadarHistory(attempt);
  state.radarSearching=true;
  state.radarMessage=`正在${remote?'联网':'演示'}搜索并整理推荐，通常需要 30 秒到 2 分钟。请保持页面打开，不要重复点击。`;
  render();
  try {
    const result=await provider.getNextBatch(profile,current?.usedItemIds||[]);
    const timestamp=now();
    if (result.exhausted) {
      const unchanged={...current,exhausted:true,lastAttemptAt:timestamp,updatedAt:timestamp};
      await storage.put('radarBatches',unchanged);
      state.radarBatches=state.radarBatches.map((batch)=>batch.profileId===profile.id?unchanged:batch);
      state.radarMessage='本次搜索结果均已在最近 180 天推荐过，当前批次保持不变。可调整探索方向后再次尝试。';
      attempt={...attempt,status:'empty',provider:result.provider,modelId:result.modelId||'',items:[],shortages:result.shortages,searchUsage:result.searchUsage||null,message:state.radarMessage,completedAt:timestamp};
      await saveRadarHistory(attempt);
      toast('本次没有尚未推荐过的新内容','error'); return;
    }
    const next={id:radarBatchId(profile.id),profileId:profile.id,sequence:Number(current?.sequence||0)+1,items:result.items,usedItemIds:[...new Set([...(current?.usedItemIds||[]),...result.items.map((item)=>item.id)])],shortages:result.shortages,provider:result.provider,modelId:result.modelId||'',searchUsage:result.searchUsage||null,exhausted:false,createdAt:timestamp,updatedAt:timestamp};
    await storage.put('radarBatches',next);
    state.radarBatches=state.radarBatches.map((batch)=>batch.profileId===profile.id?next:batch);
    state.radarMessage=result.replayed?'已恢复后端完成但浏览器此前未接收的探索结果。':'';
    attempt={...attempt,status:'success',provider:result.provider,modelId:result.modelId||'',items:structuredClone(result.items),shortages:result.shortages,searchUsage:result.searchUsage||null,message:state.radarMessage||`已生成 ${result.items.length} 条推荐。`,replayed:Boolean(result.replayed),completedAt:timestamp};
    await saveRadarHistory(attempt);
    toast(result.replayed?'已恢复上一次探索结果':'已切换到新的探索批次');
  } catch (error) {
    const blocked=error.status===409;
    state.radarMessage=blocked?`后端已有搜索正在进行：${error.message}`:`探索失败：${error.message}`;
    attempt={...attempt,status:blocked?'blocked':'error',message:state.radarMessage,completedAt:now()};
    await saveRadarHistory(attempt);
    toast(error.message,'error');
  } finally {
    state.radarSearching=false;
    render();
  }
}

async function saveRadarToNotes(id) {
  const item = activeRadarBatch()?.items.find((entry) => entry.id === id);
  if (!item) return;
  const timestamp = now();
  const note = { id:uid('note'), source:state.notesMode, title:item.title, content:`${item.explanation}${item.changeSummary ? `\n\n本次变化：${item.changeSummary}` : ''}\n\n为什么值得关注：${item.why}\n\n来源：${item.sourceName}\n${item.sourceUrl}`, category:CATEGORIES.includes(item.domain)?item.domain:'Learning', createdAt:timestamp, updatedAt:timestamp };
  await currentNotesAdapter().create(note);
  await loadNotes();
  toast(`已保存到 Notes · ${note.category}`);
}

async function deleteRadarProfile(profileId) {
  const profile=state.radarProfiles.find((item)=>item.id===profileId);
  if (!profile||profile.isDefault) return;
  const historyCount=state.radarHistory.filter((item)=>item.profileId===profile.id).length;
  if (!confirm(`确定删除探索方向“${profile.name}”吗？该方向的当前批次和 ${historyCount} 条探索历史也会删除。`)) return;
  await storage.delete('radarProfiles',profile.id);
  await storage.delete('radarBatches',radarBatchId(profile.id));
  await storage.deleteWhere('radarHistory',(item)=>item.profileId===profile.id);
  selectRadarProfile(DEFAULT_PROFILE.id);
  await refresh(`自定义探索方向、当前批次及 ${historyCount} 条历史已删除`);
}

app.addEventListener('click', async (e) => {
  try {
  const nav=e.target.closest('[data-nav]'); if(nav){if(state.route==='notes')await flushNoteDraft();persistNotesUi(nav.dataset.nav==='notes');state.route=nav.dataset.nav;if(state.route==='playground')state.playgroundView='list'; state.search=''; state.drawer=null; render(); window.scrollTo({top:0}); return;}
  const openArtwork=e.target.closest('[data-playground-open]'); if(openArtwork){state.playgroundView=openArtwork.dataset.playgroundOpen;render();window.scrollTo({top:0});return;}
  if(e.target.closest('[data-playground-back]')){state.playgroundView='list';render();window.scrollTo({top:0});return;}
  const retryArtwork=e.target.closest('[data-playground-retry]'); if(retryArtwork){mountArtwork(retryArtwork.dataset.playgroundRetry);return;}
  const open=e.target.closest('[data-open]'); if(open){openDrawer(open.dataset.open,open.dataset.open==='edit-radar-profile'?state.radarProfileId:null); return;}
  if(e.target.closest('[data-close]') || (e.target.classList.contains('drawer-backdrop'))){closeDrawer();return;}
  const newNote=e.target.closest('[data-new-note]'); if(newNote){await startNewNote();return;}
  const selectNote=e.target.closest('[data-select-note]'); if(selectNote){await openNoteEditor(selectNote.dataset.selectNote);return;}
  const openNote=e.target.closest('[data-open-note]'); if(openNote){await openNoteEditor(openNote.dataset.openNote);return;}
  const category=e.target.closest('[data-category]'); if(category){state.selectedCategory=category.dataset.category;render();return;}
  const deleteRadar=e.target.closest('[data-delete-radar-profile]'); if(deleteRadar){await deleteRadarProfile(deleteRadar.dataset.deleteRadarProfile);return;}
  if(e.target.closest('[data-explore-new]')){await exploreNew();return;}
  const saveRadar=e.target.closest('[data-save-radar]'); if(saveRadar){await saveRadarToNotes(saveRadar.dataset.saveRadar);return;}
  const task=e.target.closest('[data-task]'); if(task){state.taskId=task.dataset.task;state.taskHistoryTab='activity';state.route='task-detail';render();window.scrollTo({top:0});return;}
  const historyTab=e.target.closest('[data-history-tab]'); if(historyTab){state.taskHistoryTab=historyTab.dataset.historyTab;render();return;}
  const editMember=e.target.closest('[data-edit-member]'); if(editMember){openDrawer('edit-member',editMember.dataset.editMember);return;}
  if(e.target.id==='export-data'){await exportData();return;}
  if(e.target.closest('[data-test-memos]')){await testMemosConnection();return;}
  if(e.target.closest('[data-connect-memos]')){await connectMemos();return;}
  if(e.target.closest('[data-disconnect-memos]')){notesCredentials.useLocal();state.search='';await refresh('Notes 已切换回 Local；Memos 数据未改动');return;}
  if(e.target.closest('[data-clear-memos]') && confirm('确定清除已保存的 Memos 配置和令牌吗？远端数据不会被删除。')){notesCredentials.clear();state.memosTest=null;await refresh('Memos 凭据已清除，Notes 使用 Local');return;}
  const toggleSecret=e.target.closest('[data-toggle-secret]'); if(toggleSecret){const input=document.querySelector(`#${toggleSecret.dataset.toggleSecret}`);if(input){const showing=input.type==='text';input.type=showing?'password':'text';toggleSecret.textContent=showing?'显示':'隐藏';toggleSecret.setAttribute('aria-label',`${showing?'显示':'隐藏'} ${input.id==='tavily-key'?'Tavily':'DeepSeek'} API Key`);}return;}
  if(e.target.closest('[data-test-radar]')){await testRadarConnection();return;}
  if(e.target.closest('[data-save-radar-config]')){await saveRadarConfig();return;}
  if(e.target.closest('[data-clear-radar-config]') && confirm('确定清除 Radar 配置吗？会话与长期保存的两组 API Key 都会删除。')){radarCredentials.clear();state.radarTest=null;render();toast('Radar 配置及所有本地密钥已清除，已恢复 Demo 模式');return;}
  const deleteNote=e.target.closest('[data-delete-note]'); if(deleteNote && confirm(`确定从 ${state.notesMode} 删除这条 Note 吗？此操作不会影响另一数据源。`)){await currentNotesAdapter().delete(deleteNote.dataset.deleteNote);await notesDrafts.delete(state.notesMode,deleteNote.dataset.deleteNote);state.noteId=null;state.noteDraft=null;state.drawer=null;persistNotesUi(true);await refresh(`Note 已从 ${state.notesMode} 删除`);return;}
  const deleteMember=e.target.closest('[data-delete-member]'); if(deleteMember && confirm('确定删除该成员吗？历史任务与记录中的姓名会保留。')){await storage.delete('team',deleteMember.dataset.deleteMember);await refresh('成员已删除；历史名称已保留');return;}
  const deleteTask=e.target.closest('[data-delete-task]'); if(deleteTask){const ac=state.data.activity.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;const hc=state.data.handoffs.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;if(confirm(`确定删除该任务吗？将同时删除 ${ac} 条活动和 ${hc} 条交接记录。`)){await storage.delete('tasks',deleteTask.dataset.deleteTask);await storage.deleteWhere('activity',(x)=>x.taskId===deleteTask.dataset.deleteTask);await storage.deleteWhere('handoffs',(x)=>x.taskId===deleteTask.dataset.deleteTask);state.route='tasks';await refresh(`任务及关联的 ${ac} 条活动、${hc} 条交接记录已删除`);}return;}
  } catch(error) { toast(error.message || '操作失败','error'); }
});

app.addEventListener('submit', async (e) => { if(e.target.id==='drawer-form'||e.target.id==='note-editor-form'){e.preventDefault();try{if(e.target.id==='drawer-form')await onSubmit(e.target);else await saveNoteForm(e.target);}catch(error){toast(error.message || '保存失败','error');}} });
app.addEventListener('input', (e) => {
  const editor=e.target.closest('#note-editor-form'); if(editor){scheduleNoteDraft(editor);return;}
  if(['task-search','note-search'].includes(e.target.id)){state.search=e.target.value;render();const input=document.querySelector(`#${e.target.id}`);input.focus();input.setSelectionRange(input.value.length,input.value.length);}
  if(['tavily-key','deepseek-key'].includes(e.target.id)) {
    radarCredentials.rememberSessionDraft({
      tavilyApiKey:document.querySelector('#tavily-key')?.value,
      deepseekApiKey:document.querySelector('#deepseek-key')?.value
    });
    state.radarTest=null;
  }
});
app.addEventListener('change', async (e) => {
  const editor=e.target.closest('#note-editor-form'); if(editor){scheduleNoteDraft(editor);return;}
  if(e.target.id==='status-filter'){state.status=e.target.value;render();}
  if(e.target.id==='note-category-filter'){await flushNoteDraft();state.selectedCategory=e.target.value;state.noteId=null;state.noteDraft=null;persistNotesUi(true);render();}
  if(e.target.id==='radar-profile-select'){selectRadarProfile(e.target.value);render();}
  if(e.target.id==='remember-radar-keys'&&!e.target.checked){radarCredentials.useSessionOnly();toast('已清除长期保存的 Radar 密钥；当前会话仍可继续使用');}
  if(e.target.id==='handoff-to'){const member=state.data.team.find((m)=>m.id===e.target.value);const hint=document.querySelector('#handoff-confirm');if(hint)hint.textContent=member?`确认后负责人将更新为 ${member.name}；任务状态保持不变，并保存当前快照。`:'请选择接手人。确认时会保存当时任务状态和最新进展快照；完成状态不会改变。';}
  if(e.target.id==='import-data' && e.target.files[0]) await importData(e.target.files[0]);
});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&state.drawer)closeDrawer();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.route==='notes')flushNoteDraft().catch(()=>{});});
window.addEventListener('beforeunload',()=>{persistNotesUi(state.route==='notes');destroyActiveArtwork();});

loadData()
  .then(() => { appLoaded=true; render(); })
  .catch((error) => {
    app.innerHTML = `<div class="empty"><h2>无法打开本地数据库</h2><p>${esc(error.message)}</p></div>`;
  });
