const { LocalStorageAdapter, STORES, ACTIVE_STORES } = window.TaskFlowStorage;
const { NoopNotificationAdapter, NotificationEvents, formatTaskNotification } = window.TaskFlowNotifications;
const { LocalNotesAdapter, MemosNotesAdapter, NotesCredentialStore, NotesDraftStore } = window.TaskFlowNotes;
const { DemoRadarProvider, RemoteRadarProvider, RadarCredentialStore, DEFAULT_MODEL_ID, DEFAULT_DAILY_LIMIT, DEFAULT_PROFILE, QUOTAS, normalizeLegacyItems, usedIdsThroughLegacyIndex } = window.TaskFlowRadar;
const { normalizeNote, tokenize, searchNotes, highlightHtml, contentTypeLabel, contentSummary, safeSourceUrl } = window.TaskFlowContentLibrary;
const { ClassificationStore, DEFAULT_CONTENT_TYPES, DEFAULT_CATEGORIES } = window.TaskFlowClassifications;
const { TEMPLATE_DEFAULT_CATEGORIES, localDateKey, isExpiredCapture, todoMatchesView, shiftDate, reminderId, dueReminders, extractTemplateVariables, fillTemplate, monthGrid } = window.TaskFlowPersonalWorkspace;
const { createPointerActivationGuard } = window.TaskFlowInteractionGuards;
const { OperationLockRegistry } = window.TaskFlowOperationLocks;
const { calculateSalary, analyzeOvertime, calculateLiving, forecastSavings, salaryTargets, compareJobs, decisionSignals } = window.TaskFlowLaborLife;

const storage = new LocalStorageAdapter();
const notifications = new NoopNotificationAdapter();
const notesCredentials = new NotesCredentialStore();
const notesDrafts = new NotesDraftStore(storage);
const radarProvider = new DemoRadarProvider();
const radarCredentials = new RadarCredentialStore();
const classificationStore = new ClassificationStore();
const operationLocks = new OperationLockRegistry();
const app = document.querySelector('#app');
const STATUS = ['Todo', 'Doing', 'Blocked', 'Done'];
const STATUS_LABELS = { Todo: '待办', Doing: '进行中', Blocked: '已阻塞', Done: '已完成' };
const FIELD_LABELS = { status: '任务状态', currentSummary: '当前整体进度', remark: '备注', next: '下一步行动', blockedReason: '阻塞说明', owner: '负责人' };
const RADAR_ACTIVE_KEY = 'taskflow-radar-active-profile-v1';
const NOTES_UI_KEY = 'taskflow-notes-ui-v1';
const CATEGORY_TAGS_KEY = 'taskflow-content-quick-tags-v1';
const DEFAULT_CATEGORY_TAGS = ['总结', '翻译', '代码', '写作'];
function loadCategoryQuickTags() { try { const value=JSON.parse(localStorage.getItem(CATEGORY_TAGS_KEY)); return Array.isArray(value) ? value.map((item)=>String(item).trim()).filter(Boolean).slice(0,20) : [...DEFAULT_CATEGORY_TAGS]; } catch { return [...DEFAULT_CATEGORY_TAGS]; } }
const state = { route: 'home', openNavGroup:null, mainNavCollapsed:false, contentSidebarCollapsed:{notes:false,templates:false,radar:false,settings:false}, settingsSection:'service', templateEditing:false, playgroundView: 'list', taskId: null, noteId: null, noteDraft: null, noteDraftRevision: 0, noteDraftRestored: false, noteSaving: false, selectedCategory: 'All', search: '', categorySearch:'', categoryType:'All', categoryExpandedId:null, categoryQuickTags:loadCategoryQuickTags(), categoryTagEditor:false, classifications:classificationStore.read(), localClassificationNotes:[], todoView:'today', calendarMonth:localDateKey().slice(0,7), calendarDate:localDateKey(), templateSearch:'', templateCategory:'All', templateFavorites:false, templateId:null, templateValues:{}, laborTab:'salary', laborRange:'all', laborTrendMetric:'averageHourlyRate', laborOvertimeMetric:'comprehensiveValue', laborEditingOvertimeId:null, laborEditingOvertimeStatusId:null, overtimeViewHours:null, overtimeHiddenSeries:[], laborEditingJobId:null, status: 'All', taskHistoryTab: 'activity', drawer: null, data: {}, notes: [], notesMode: 'Local', notesError: '', memosTest: null, radarProfiles: [], radarBatches: [], radarHistory: [], radarProfileId: '', radarMessage: '', radarTest: null, radarSearching: false };
let noteDraftTimer = null;
let noteDraftWrite = Promise.resolve();
let appLoaded = false;
let homeClockTimer = null;
let captureCleanupTimer = null;
let activeArtwork = null;
let artworkLoadToken = 0;
let overtimeRuntime = { analysis:null, facts:null, statusRecords:[], signature:'', ai:null, aiPending:false, aiError:'', aiRequestId:0, analysisRuns:0, viewUpdates:0 };
let overtimeViewFrame = null;
const composingSearches = new Set();
const transientDirtyForms = new Set();
const pointerActivationGuard = createPointerActivationGuard();
const saveTimingEnabled = new URLSearchParams(location.search).get('saveTiming') === '1';
const PERSONAL_ROUTES = new Set(['capture','todos','calendar','templates']);
const PLAYGROUND_MODULES = {
  music: './playground/music-geometry.js?v=20261022-art-v4',
  keyboard: './playground/keyboard-art.js?v=20261022-watch-v2',
  life: './playground/life-geometry.js?v=20261022-life-v4',
};
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const dateText = (iso) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const badge = (status) => `<span class="badge ${String(status || 'Todo').toLowerCase()}">${esc(STATUS_LABELS[status] || status || '待办')}</span>`;
const dateTimeLocalValue = (value) => { if (!value) return ''; const date=new Date(value); if(Number.isNaN(date.getTime())) return ''; const offset=date.getTimezoneOffset()*60000; return new Date(date.getTime()-offset).toISOString().slice(0,16); };
const shortDateText = (value) => value ? new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',weekday:'short'}).format(new Date(`${value}T12:00:00`)) : '未安排日期';
const captureText = (item) => esc(item.content || '').replace(/\n/g,'<br>');

function operationButton(trigger) {
  if (!trigger?.matches) return null;
  if (trigger.matches('form')) return trigger.querySelector('button[type="submit"]');
  return trigger.closest('button,input[type="file"]') || trigger.querySelector?.('button[type="submit"]') || null;
}

async function runOperationLocked(key, trigger, operation, label = '保存中…') {
  const attempt=operationLocks.start(key,operation);
  if(!attempt.started)return false;
  const control=operationButton(trigger);const original=control?{disabled:Boolean(control.disabled),text:control.tagName==='BUTTON'?control.textContent:'',busy:control.getAttribute('aria-busy')}:null;
  if(control){control.disabled=true;control.setAttribute('aria-busy','true');if(control.tagName==='BUTTON')control.textContent=label;}
  trigger?.setAttribute?.('aria-busy','true');
  const started=performance.now();
  try{await attempt.promise;return true;}
  finally{
    if(saveTimingEnabled)console.info(`[save-timing] ${key}: ${(performance.now()-started).toFixed(1)}ms total`);
    if(trigger?.isConnected)trigger.removeAttribute('aria-busy');
    if(control?.isConnected&&original){control.disabled=original.disabled;if(control.tagName==='BUTTON')control.textContent=original.text;if(original.busy===null)control.removeAttribute('aria-busy');else control.setAttribute('aria-busy',original.busy);}
  }
}

const WRITE_ACTION_SELECTOR = [
  '[data-new-note]','[data-new-prompt]','[data-complete-capture]','[data-undo-capture]','[data-convert-capture]','[data-delete-capture]',
  '[data-toggle-todo]','[data-postpone-todo]','[data-delete-todo]','[data-delete-event]','[data-read-reminder]','[data-ignore-reminder]',
  '[data-favorite-template]','[data-delete-template]','[data-save-quick-tag]','[data-remove-quick-tag]','[data-delete-radar-profile]',
  '[data-explore-new]','[data-save-radar]','[data-test-memos]','[data-connect-memos]','[data-disconnect-memos]','[data-clear-memos]',
  '[data-test-radar]','[data-save-radar-config]','[data-clear-radar-config]','[data-delete-note]','[data-delete-member]',
  '[data-delete-task]','[data-delete-labor]','[data-delete-overtime-status]'
].join(',');
const WRITE_ACTION_KEYS=['newNote','newPrompt','completeCapture','undoCapture','convertCapture','deleteCapture','toggleTodo','postponeTodo','deleteTodo','deleteEvent','readReminder','ignoreReminder','favoriteTemplate','deleteTemplate','saveQuickTag','removeQuickTag','deleteRadarProfile','exploreNew','saveRadar','testMemos','connectMemos','disconnectMemos','clearMemos','testRadar','saveRadarConfig','clearRadarConfig','deleteNote','deleteMember','deleteTask','deleteLabor','deleteOvertimeStatus'];

function actionOperationKey(trigger) {
  const name=WRITE_ACTION_KEYS.find((key)=>Object.prototype.hasOwnProperty.call(trigger.dataset,key))||'write';
  return `action:${name}:${trigger.dataset[name]||'default'}`;
}

function submitOperationKey(form) {
  if(form.id==='drawer-form')return `submit:drawer:${state.drawer?.type||'unknown'}:${state.drawer?.id||'new'}`;
  if(form.id==='note-editor-form')return `submit:note:${state.notesMode}:${form.dataset.noteId||'new'}`;
  if(form.id==='template-inline-form')return `submit:template:${form.dataset.templateId||'new'}`;
  if(form.id==='labor-overtime-form')return `submit:overtime:${state.laborEditingOvertimeId||'new'}`;
  if(form.id==='overtime-status-form')return `submit:overtime-status:${state.laborEditingOvertimeStatusId||'new'}`;
  if(form.id==='labor-job-form')return `submit:job:${state.laborEditingJobId||'new'}`;
  return `submit:${form.id}`;
}

function upcomingEvents(limit = 4) {
  const start=localDateKey();
  return [...state.data.calendarEvents].filter((item)=>localDateKey(new Date(item.startAt))>=start).sort((a,b)=>String(a.startAt).localeCompare(String(b.startAt))).slice(0,limit);
}

function todayTodos() {
  const today=localDateKey();
  return state.data.todos.filter((item)=>item.status!=='completed'&&(item.plannedDate===today||item.dueDate===today));
}

function reminderTitle(item) {
  const source=item.sourceType==='todo'?state.data.todos.find((entry)=>entry.id===item.sourceId):state.data.calendarEvents.find((entry)=>entry.id===item.sourceId);
  return source?.title || item.title || '已删除的事项';
}

async function syncReminder(sourceType, source, remindAt) {
  const id=reminderId(sourceType,source.id);
  if(!remindAt){await storage.delete('reminders',id);return;}
  const existing=await storage.get('reminders',id);
  const sameMoment=existing?.remindAt===remindAt;
  await storage.put('reminders',{id,sourceType,sourceId:source.id,title:source.title,remindAt,status:sameMoment?(existing.status||'pending'):'pending',createdAt:existing?.createdAt||source.createdAt||now(),updatedAt:now()});
}

async function loadData() {
  await storage.init();
  await storage.deleteWhere('captures',(item)=>isExpiredCapture(item));
  const appStores = ACTIVE_STORES || STORES.filter((name) => !['companies', 'comments'].includes(name));
  const entries = await Promise.all(appStores.map(async (name) => [name, await storage.all(name)]));
  state.data = Object.fromEntries(entries);
  // A cached pre-V5 storage adapter does not know about radarHistory. Keep the
  // page usable while the versioned assets below force the matching adapter on
  // the next load; existing IndexedDB records are never replaced here.
  state.data.radarHistory = Array.isArray(state.data.radarHistory) ? state.data.radarHistory : [];
  state.data.overtimeStatusRecords = Array.isArray(state.data.overtimeStatusRecords) ? state.data.overtimeStatusRecords : [];
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

function persistCategoryQuickTags() {
  try { localStorage.setItem(CATEGORY_TAGS_KEY, JSON.stringify(state.categoryQuickTags)); } catch {}
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
  state.localClassificationNotes = nextMode === 'Local' ? state.notes : await new LocalNotesAdapter(storage).list();
  state.classifications = classificationStore.resolve([...state.notes,...state.localClassificationNotes]);
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

function toast(message, type = '', action = null) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.append(document.createTextNode(message));
  if(action){const button=document.createElement('button');button.type='button';button.textContent=action.label;Object.entries(action.dataset||{}).forEach(([key,value])=>button.dataset[key]=value);el.append(button);}
  document.querySelector('#toast-region').append(el);
  setTimeout(() => el.remove(), action?6000:3200);
}

function shell(content, title, subtitle) {
  const homeClass = state.route === 'home' ? ' home-shell' : '';
  const playgroundClass = state.route === 'playground' ? ' playground-shell' : '';
  const workShell = !['home','playground'].includes(state.route);
  const navClass = workShell&&state.mainNavCollapsed ? ' nav-collapsed' : '';
  const personalOpen=state.openNavGroup==='personal';
  const personalActive=PERSONAL_ROUTES.has(state.route);
  return `<div class="app-shell route-${esc(state.route)}${homeClass}${playgroundClass}${navClass}">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></div><div class="brand-copy"><h1>Toward the Sea</h1><small>个人工作台</small></div>${workShell?`<button class="nav-collapse-toggle" type="button" data-toggle-main-nav aria-label="${state.mainNavCollapsed?'展开主导航':'折叠主导航'}" title="${state.mainNavCollapsed?'展开主导航':'折叠主导航'}">${state.mainNavCollapsed?'›':'‹'}</button>`:''}</div>
      <div class="sidebar-navigation">
        <div class="nav-kicker">工作空间</div>
        <nav class="nav-list" aria-label="主导航">
          ${navButton('home','⌂','首页')}
          <div class="nav-accordion ${personalOpen?'open':''}">
            <button class="nav-btn nav-group-toggle ${personalActive?'group-active':''}" type="button" data-nav-group="personal" aria-expanded="${personalOpen}" aria-controls="personal-nav-submenu"><span class="nav-icon">◫</span><span>个人管理</span><i class="nav-caret" aria-hidden="true">⌄</i></button>
            <div class="nav-submenu-shell" id="personal-nav-submenu" aria-hidden="${!personalOpen}"><div class="nav-submenu">
              ${navButton('capture','＋','临时暂存',{child:true,disabled:!personalOpen})}
              ${navButton('todos','✓','个人待办',{child:true,disabled:!personalOpen})}
              ${navButton('calendar','□','日历提醒',{child:true,disabled:!personalOpen})}
              ${navButton('templates','▤','模板中心',{child:true,disabled:!personalOpen})}
            </div></div>
          </div>
          <span class="nav-divider">知识与工作</span>
          ${navButton('radar','⌁','探索雷达')}
          ${navButton('notes','✎','随手笔记')}
          ${navButton('categories','◇','内容分类')}
          ${navButton('tasks','▣','任务管理')}
          ${navButton('labor-life','◒','边际价值')}
          ${navButton('playground','✦','数字艺术')}
        </nav>
      </div>
      <div class="sidebar-footer">
        <button class="global-capture" type="button" data-open="new-capture">＋ 快速暂存</button>
        <div class="local-note"><span class="storage-dot"></span><div><b>本地优先</b><small>Notes 数据源：${esc(state.notesMode)}</small></div><button class="sidebar-settings" data-nav="settings" aria-label="打开设置">⚙</button></div>
      </div>
    </aside>
    <main class="main"><header class="topbar"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="topbar-state"><span class="status-pulse"></span><span>${['notes','categories'].includes(state.route) ? esc(state.notesMode) : '本地存储'}</span></div></header>${content}</main>
  </div>${renderDrawer()}`;
}

async function copyText(value) {
  const text = String(value || '');
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly',''); area.style.position='fixed'; area.style.opacity='0';
  document.body.appendChild(area); area.select();
  const copied = document.execCommand?.('copy'); area.remove();
  if (!copied) throw new Error('浏览器未允许复制，请展开正文后手动选择复制');
}

function navButton(route, icon, label, options = {}) {
  const active = (state.route === route || (route === 'tasks' && state.route === 'task-detail')) ? 'active' : '';
  return `<button class="nav-btn ${options.child?'nav-child':''} ${active}" data-nav="${route}" title="${esc(label)}" aria-label="${esc(label)}"${options.disabled?' tabindex="-1"':''}><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></button>`;
}

function contentSidebarToggle(kind, label) {
  const collapsed=Boolean(state.contentSidebarCollapsed[kind]);
  return `<button class="content-sidebar-toggle" type="button" data-toggle-content-sidebar="${kind}" aria-expanded="${!collapsed}" aria-label="${collapsed?`展开${label}`:`折叠${label}`}" title="${collapsed?`展开${label}`:`折叠${label}`}">${collapsed?'›':'‹'}</button>`;
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
  const allCaptures=[...state.data.captures].filter((item)=>item.status!=='completed').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const captures=allCaptures.slice(0,3);
  const dayTodos=todayTodos().slice(0,4);
  const events=upcomingEvents(3);
  const reminders=dueReminders(state.data.reminders).slice(0,3);
  const today = homeDateParts();
  const focusContent = focusTask ? `<span class="home-card-kicker">当前焦点</span><div class="home-focus-title"><h3>${esc(focusTask.title)}</h3>${badge(focusTask.status)}</div><p class="prose">${esc(focusTask.next || focusTask.requirement || '暂未设置下一步')}</p><button class="btn dark" data-task="${esc(focusTask.id)}">打开任务 →</button>` : `<span class="home-card-kicker">当前焦点</span><h3>从一件具体的事开始</h3><p>还没有待推进的任务。创建任务后，这里会显示真实的下一步。</p><button class="btn dark" data-open="new-task">＋ 新建任务</button>`;
  return shell(`<section class="page home-page">
    <header class="home-heading"><div><span class="eyebrow">PERSONAL WORKSPACE</span><h3>今天，把重要的事放在眼前</h3><p>任务、记录与探索都来自现有本地数据，不额外请求服务。</p></div><time class="home-clock" id="home-clock" datetime="${today.iso}" aria-label="当前本地时间">00:00:00</time></header>
    <div class="home-bento">
      <article class="home-card home-card-interactive home-focus home-focus-capture"><div class="home-card-head"><div><span class="home-card-kicker">快速暂存</span><h4>先记下来</h4></div><button class="home-link" data-nav="capture">暂存箱 ${allCaptures.length} →</button></div><form id="home-capture-form" class="home-capture-form"><textarea name="content" required placeholder="一句话、一个链接或突然想到的事……"></textarea><button type="submit">保存</button></form>${captures.length?`<div class="home-compact-list">${captures.map((item)=>`<button data-nav="capture"><b>${esc(item.content.split(/\n/)[0].slice(0,52))}</b><span>${dateText(item.createdAt)}</span></button>`).join('')}</div>`:'<p class="home-empty">暂无待处理暂存。</p>'}</article>
      <article class="home-card home-date" aria-label="今日日期"><span class="home-card-kicker">今日日期</span><time data-home-date datetime="${today.date}"><strong data-home-date-day>${today.day}</strong><span><b data-home-date-weekday>${today.weekday}</b><small><i data-home-date-month>${today.month}</i> · <i data-home-date-year>${today.year}</i></small></span></time></article>
      <article class="home-card home-card-interactive home-capture home-capture-focus">${focusContent}</article>
      <article class="home-card home-card-interactive home-todos home-calendar-card" data-home-card="calendar"><div class="home-card-head"><div><span class="home-card-kicker">接下来</span><h4>日历事件</h4></div><button class="home-link" data-nav="calendar">打开日历 →</button></div>${events.length?`<div class="home-compact-list">${events.map((item)=>`<button data-nav="calendar"><b>${esc(item.title)}</b><span>${dateText(item.startAt)}</span></button>`).join('')}</div>`:'<p class="home-empty">暂无即将开始的事件。</p>'}</article>
      <article class="home-card home-card-interactive home-agenda home-actions-card" data-home-card="actions"><div><span class="home-card-kicker">快捷操作</span><h4>知识与工作</h4></div><div class="home-action-list"><button data-open="new-task"><span>＋</span>新建任务</button><button data-new-note><span>✎</span>写笔记</button><button data-nav="radar"><span>⌁</span>${radarItems.length?'查看 Radar':'打开 Radar'}</button></div></article>
      <article class="home-card home-card-interactive home-reminders"><div class="home-card-head"><div><span class="home-card-kicker">提醒中心</span><h4>${reminders.length} 条到期</h4></div><button class="home-link" data-nav="calendar">处理提醒 →</button></div>${reminders.length?`<div class="home-compact-list">${reminders.map((item)=>`<button data-nav="calendar"><b>${esc(reminderTitle(item))}</b><span>${dateText(item.remindAt)}</span></button>`).join('')}</div>`:'<p class="home-empty">没有到期提醒。</p>'}</article>
      <article class="home-card home-card-interactive home-tasks"><div class="home-card-head"><div><span class="home-card-kicker">任务节奏</span><h4>${tasks.length} 个任务</h4></div><button class="home-link" data-nav="tasks">查看全部 →</button></div><div class="home-task-counts">${STATUS.map((status)=>`<div><b>${taskCounts[status]}</b><span>${STATUS_LABELS[status]}</span></div>`).join('')}</div></article>
      <article class="home-card home-card-interactive home-notes"><div class="home-card-head"><div><span class="home-card-kicker">最近记录</span><h4>${state.notesMode} Notes</h4></div><button class="home-link" data-nav="notes">打开笔记 →</button></div>${recentNotes.length?`<div class="home-note-list">${recentNotes.map((note)=>`<button data-open-note="${esc(note.id)}"><b>${esc(note.title || note.content?.split(/\n/)[0]?.slice(0,40) || '未命名记录')}</b><span>${esc(noteCategory(note))} · ${dateText(note.updatedAt)}</span></button>`).join('')}</div>`:'<p class="home-empty">还没有记录，随手写下第一条想法。</p>'}</article>
      <article class="home-card home-card-interactive home-actions home-todos-card" data-home-card="todos"><div class="home-card-head"><div><span class="home-card-kicker">今天</span><h4>${dayTodos.length} 件个人待办</h4></div><button class="home-link" data-nav="todos">查看待办 →</button></div>${dayTodos.length?`<div class="home-compact-list">${dayTodos.map((item)=>`<button data-nav="todos"><b>${esc(item.title)}</b><span>${item.dueDate===today.date?'今天截止':'今天计划'}</span></button>`).join('')}</div>`:'<p class="home-empty">今天没有已安排的个人待办。</p>'}</article>
    </div>
  </section>`, '首页', '本地工作台 · 不主动联网');
}

function capturePage() {
  const pending=[...state.data.captures].filter((item)=>item.status!=='completed').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const completed=[...state.data.captures].filter((item)=>item.status==='completed').sort((a,b)=>String(b.completedAt||'').localeCompare(String(a.completedAt||'')));
  const row=(item,done=false)=>`<article class="capture-row ${done?'is-complete':''}"><button class="capture-check" type="button" data-${done?'undo':'complete'}-capture="${esc(item.id)}" aria-label="${done?'撤销完成':'标记完成'}">${done?'↶':'✓'}</button><div class="capture-content"><p>${captureText(item)}</p><small>${dateText(item.createdAt)}${item.convertedTodoId?' · 已转为待办':''}</small></div><div class="row-actions">${done?'':`<button class="btn small" data-convert-capture="${esc(item.id)}">转为待办</button><button class="btn small" data-edit-capture="${esc(item.id)}">编辑</button>`}<button class="icon-btn danger" data-delete-capture="${esc(item.id)}" aria-label="删除">×</button></div></article>`;
  return shell(`<section class="page work-page personal-page"><div class="page-head compact"><div><span class="eyebrow">QUICK CAPTURE</span><h3>先接住，再整理</h3><p>临时内容不要求标题和分类；完成后隐藏，并在 24 小时后自动清理。</p></div></div>
    <form class="quick-entry card" id="capture-form"><label class="sr-only" for="capture-content">临时暂存内容</label><textarea id="capture-content" class="textarea" name="content" required placeholder="粘贴链接、写下一句话，按保存即可……"></textarea><button class="btn primary" type="submit">保存暂存</button></form>
    <div class="section-head"><div><h4>待处理</h4><span>${pending.length}</span></div></div><div class="capture-list">${pending.length?pending.map((item)=>row(item)).join(''):empty('暂存箱是空的','从左侧或本页快速记下一条内容。')}</div>
    <details class="completed-captures"><summary>最近完成（${completed.length}）</summary><div class="capture-list">${completed.length?completed.map((item)=>row(item,true)).join(''):'<p class="subtle">暂无最近完成内容。</p>'}</div></details>
  </section>`,'临时暂存',`${pending.length} 条待处理 · 完成内容保留 24 小时`);
}

function todosPage() {
  const views={today:'今天',upcoming:'未来',all:'全部',completed:'已完成'};
  const items=[...state.data.todos].filter((item)=>todoMatchesView(item,state.todoView)).sort((a,b)=>String(a.plannedDate||a.dueDate||'9999').localeCompare(String(b.plannedDate||b.dueDate||'9999'))||String(b.createdAt).localeCompare(String(a.createdAt)));
  return shell(`<section class="page work-page personal-page"><div class="page-head compact"><div><span class="eyebrow">PERSONAL TO-DO</span><h3>个人待办</h3><p>轻量安排生活事项，与需要跟踪和交接的 Task 相互独立。</p></div><button class="btn primary" data-open="new-todo">＋ 新建待办</button></div>
    <form class="quick-entry inline card" id="todo-quick-form"><label class="sr-only" for="todo-quick-title">快速新增待办</label><input class="input" id="todo-quick-title" name="title" required maxlength="160" placeholder="快速新增一件待办"><button class="btn primary" type="submit">添加</button></form>
    <div class="segment-control" role="tablist">${Object.entries(views).map(([key,label])=>`<button type="button" class="${state.todoView===key?'active':''}" data-todo-view="${key}">${label}</button>`).join('')}</div>
    <div class="todo-list">${items.length?items.map((item)=>`<article class="todo-row ${item.status==='completed'?'is-complete':''}"><button class="capture-check" data-toggle-todo="${esc(item.id)}" aria-label="切换完成状态">${item.status==='completed'?'✓':'○'}</button><div><h4>${esc(item.title)}</h4>${item.notes?`<p>${esc(item.notes)}</p>`:''}<div class="item-meta">${item.plannedDate?`<span>计划 ${shortDateText(item.plannedDate)}</span>`:''}${item.dueDate?`<span>截止 ${shortDateText(item.dueDate)}</span>`:''}${item.remindAt?`<span>提醒 ${dateText(item.remindAt)}</span>`:''}</div></div><div class="row-actions">${item.status!=='completed'&&item.plannedDate?`<button class="btn small" data-postpone-todo="${esc(item.id)}">顺延一天</button>`:''}<button class="btn small" data-edit-todo="${esc(item.id)}">编辑</button><button class="icon-btn danger" data-delete-todo="${esc(item.id)}" aria-label="删除">×</button></div></article>`).join(''):empty('这个视图没有待办','快速添加一件事，或切换到其他视图。')}</div>
  </section>`,'个人待办',`${state.data.todos.filter((item)=>item.status!=='completed').length} 条未完成`);
}

function calendarPage() {
  const cells=monthGrid(state.calendarMonth); const selected=state.calendarDate;
  const events=[...state.data.calendarEvents].filter((item)=>localDateKey(new Date(item.startAt))===selected).sort((a,b)=>String(a.startAt).localeCompare(String(b.startAt)));
  const todos=state.data.todos.filter((item)=>item.status!=='completed'&&(item.plannedDate===selected||item.dueDate===selected));
  const due=dueReminders(state.data.reminders).map((item)=>({...item,displayTitle:reminderTitle(item)}));
  const monthLabel=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long'}).format(new Date(`${state.calendarMonth}-01T12:00:00`));
  return shell(`<section class="page work-page personal-page"><div class="page-head compact"><div><span class="eyebrow">CALENDAR</span><h3>日历与提醒</h3><p>日历负责查看时间，事项仍分别保存在待办与独立事件中。</p></div><button class="btn primary" data-open="new-event">＋ 新建事件</button></div>
    ${due.length?`<section class="reminder-center card"><div class="section-head"><div><h4>到期提醒</h4><span>${due.length}</span></div></div>${due.map((item)=>`<div class="reminder-row"><div><b>${esc(item.displayTitle)}</b><small>${dateText(item.remindAt)}</small></div><div class="row-actions"><button class="btn small" data-read-reminder="${esc(item.id)}">知道了</button><button class="btn small" data-ignore-reminder="${esc(item.id)}">忽略</button></div></div>`).join('')}</section>`:''}
    <div class="calendar-layout"><section class="calendar-card card"><header><button class="icon-btn" data-calendar-shift="-1">←</button><h4>${esc(monthLabel)}</h4><button class="icon-btn" data-calendar-shift="1">→</button></header><div class="calendar-weekdays">${['一','二','三','四','五','六','日'].map((day)=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells.map((cell)=>{const eventCount=state.data.calendarEvents.filter((item)=>localDateKey(new Date(item.startAt))===cell.date).length;const todoCount=state.data.todos.filter((item)=>item.status!=='completed'&&(item.plannedDate===cell.date||item.dueDate===cell.date)).length;return `<button class="calendar-day ${cell.inMonth?'':'muted'} ${cell.date===selected?'active':''} ${cell.date===localDateKey()?'today':''}" data-calendar-date="${cell.date}"><b>${Number(cell.date.slice(-2))}</b>${eventCount+todoCount?`<span>${eventCount+todoCount}</span>`:''}</button>`;}).join('')}</div></section>
      <section class="agenda-panel card"><div class="section-head"><div><h4>${shortDateText(selected)}</h4><span>${events.length+todos.length}</span></div><button class="btn small" data-open="new-event">＋ 事件</button></div>${events.map((item)=>`<article class="agenda-item"><i></i><div><b>${esc(item.title)}</b><p>${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit'}).format(new Date(item.startAt))}${item.notes?` · ${esc(item.notes)}`:''}</p></div><button class="btn small" data-edit-event="${esc(item.id)}">编辑</button></article>`).join('')}${todos.map((item)=>`<article class="agenda-item todo"><i></i><div><b>${esc(item.title)}</b><p>个人待办${item.dueDate===selected?' · 今天截止':''}</p></div><button class="btn small" data-nav="todos">查看</button></article>`).join('')}${events.length+todos.length?'':empty('这一天没有安排','选择其他日期或新建日历事件。')}</section></div>
  </section>`,'日历提醒',`${due.length} 条到期提醒`);
}

function templatePage() {
  const categories=[...new Set([...TEMPLATE_DEFAULT_CATEGORIES,...state.data.templates.map((item)=>item.category).filter(Boolean)])];
  const query=state.templateSearch.trim().toLowerCase();
  const templates=[...state.data.templates].filter((item)=>(!query||`${item.title} ${item.content} ${item.category}`.toLowerCase().includes(query))&&(state.templateCategory==='All'||item.category===state.templateCategory)&&(!state.templateFavorites||item.favorite)).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const current=state.data.templates.find((item)=>item.id===state.templateId)||templates[0];
  if(current&&state.templateId!==current.id){state.templateId=current.id;state.templateValues={};}
  const variables=current?extractTemplateVariables(current.content):[];
  const preview=current?fillTemplate(current.content,state.templateValues):'';
  const sidebarCollapsed=state.contentSidebarCollapsed.templates;
  return shell(`<section class="page work-page personal-page template-page"><div class="page-head compact"><div><span class="eyebrow">TEMPLATE LIBRARY</span><h3>模板中心</h3><p>模板仅保存在当前浏览器，可通过 Toward the Sea JSON 备份迁移。</p></div><button class="btn primary" data-open="new-template">＋ 新建模板</button></div>
    <div class="template-toolbar card"><div class="search"><span>⌕</span><input id="template-search" class="input" type="search" value="${esc(state.templateSearch)}" placeholder="搜索标题、正文或分类"></div><select class="select" id="template-category"><option value="All">全部分类</option>${categories.map((item)=>`<option ${state.templateCategory===item?'selected':''}>${esc(item)}</option>`).join('')}</select><label class="check-line"><input id="template-favorites" type="checkbox" ${state.templateFavorites?'checked':''}> 只看收藏</label></div>
    <div class="template-workspace content-sidebar-layout ${sidebarCollapsed?'content-sidebar-collapsed':''}"><aside class="template-list card module-content-sidebar"><header class="content-sidebar-head"><b>模板列表</b>${contentSidebarToggle('templates','模板列表')}</header>${templates.length?templates.map((item)=>`<button class="template-list-item ${current?.id===item.id?'active':''}" data-select-template="${esc(item.id)}"><span>${item.favorite?'★':'☆'}</span><div><b>${esc(item.title)}</b><small>${esc(item.category||'未分类')} · ${dateText(item.updatedAt)}</small></div></button>`).join(''):empty('没有匹配的模板','新建模板或调整筛选条件。')}</aside>${sidebarCollapsed?contentSidebarToggle('templates','模板列表'):''}
      <section class="template-detail card">${current?(state.templateEditing?`<form id="template-inline-form" class="template-inline-form" data-template-id="${esc(current.id)}"><header><div><span class="eyebrow">EDIT TEMPLATE</span><h4>编辑模板</h4></div><button class="btn small" type="button" data-cancel-template-edit>取消</button></header><label>标题<input class="input" name="title" maxlength="120" required value="${esc(current.title)}"></label><label>分类<input class="input" name="category" list="template-inline-categories" value="${esc(current.category||TEMPLATE_DEFAULT_CATEGORIES[0])}"><datalist id="template-inline-categories">${categories.map((value)=>`<option value="${esc(value)}"></option>`).join('')}</datalist></label><label>模板正文<textarea class="textarea tall" name="content" required>${esc(current.content)}</textarea></label><label class="check-line"><input type="checkbox" name="favorite" ${current.favorite?'checked':''}> 收藏模板</label><footer><span class="subtle">保存后仍使用原记录 ID，变量内容不会被自动填充。</span><button class="btn primary" type="submit">保存修改</button></footer></form>`:`<header><div><span class="home-card-kicker">${esc(current.category||'未分类')}</span><h4>${esc(current.title)}</h4></div><div class="row-actions"><button class="icon-btn" data-favorite-template="${esc(current.id)}" aria-label="收藏">${current.favorite?'★':'☆'}</button><button class="btn small" data-edit-template="${esc(current.id)}">编辑</button><button class="icon-btn danger" data-delete-template="${esc(current.id)}" aria-label="删除">×</button></div></header>${variables.length?`<div class="template-variables">${variables.map((name)=>`<label>${esc(name)}<input class="input" data-template-variable="${esc(name)}" value="${esc(state.templateValues[name]||'')}" placeholder="留空则保留 {{${esc(name)}}}"></label>`).join('')}</div>`:''}<pre id="template-preview">${esc(preview)}</pre><button class="btn primary" data-copy-template="${esc(current.id)}">复制${variables.length?'填充后':''}模板</button>`):empty('选择一个模板','从左侧选择或新建模板。')}</section></div>
  </section>`,'模板中心',`${state.data.templates.length} 个本地模板`);
}

function playgroundPage() {
  const works = {
    music:{title:'Music Geometry',subtitle:'让一首音乐化为自然展开与收束的有机丝带'},
    keyboard:{title:'Keyboard Art',subtitle:'用 A–K 键生成光线、粒子与数学花纹'},
    life:{title:'Life Geometry · 万千人生',subtitle:'旁观生命在不同世界与时代中相遇、转折和远去'},
  };
  if (works[state.playgroundView]) {
    const { title, subtitle } = works[state.playgroundView];
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
    <div class="page-head playground-intro"><div><span class="eyebrow">DIGITAL ART LAB</span><h3>让代码暂时离开效率</h3><p>三个独立的实时作品，只在你选择后加载和运行。</p></div><span class="playground-cold-badge">按需唤醒</span></div>
    <div class="playground-grid">
      <article class="playground-card playground-card-music">
        <div class="playground-card-art" aria-hidden="true"><i></i><i></i><i></i><span>∿</span></div>
        <div class="playground-card-copy"><span class="home-card-kicker">AUDIO × MATHEMATICS</span><h4>Music Geometry</h4><p>主动选择正在播放音乐的浏览器标签页，看一首音乐化为从诞生、生长到消散的连续生命轨迹。</p><ul><li>标签页音频捕获</li><li>多线连续轨迹</li><li>本地文件备用</li></ul><button class="btn primary" type="button" data-playground-open="music">进入作品 →</button></div>
      </article>
      <article class="playground-card playground-card-keyboard">
        <div class="playground-card-art keyboard-preview" aria-hidden="true"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><span>✦</span></div>
        <div class="playground-card-copy"><span class="home-card-kicker">KEYS × GENERATIVE ART</span><h4>Keyboard Art</h4><p>敲击 A–K，让不同规则生成光点、花纹与丝线，并以柔和的合成音效回应每次创作。</p><ul><li>8 种视听效果</li><li>静音与音量控制</li><li>粒子和声部保护</li></ul><button class="btn primary" type="button" data-playground-open="keyboard">进入作品 →</button></div>
      </article>
      <article class="playground-card playground-card-life">
        <div class="playground-card-art life-preview" aria-hidden="true"><i></i><i></i><i></i><span>∞</span></div>
        <div class="playground-card-copy"><span class="home-card-kicker">LIFE × TIME × WORLD</span><h4>Life Geometry · 万千人生</h4><p>以共同世界时间观看一群人相遇、同行、分离、重逢，并继续各自的人生。</p><ul><li>独立人物生命线</li><li>关系驱动的靠近与淡出</li><li>AI、JSON 与离线生成</li></ul><button class="btn primary" type="button" data-playground-open="life">进入作品 →</button></div>
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

const laborMoney = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(Number(value)) : '—';
const laborNumber = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0$/,'') : '—';
const laborPercent = (value) => Number.isFinite(Number(value)) ? `${(Number(value)*100).toFixed(1)}%` : '—';
const laborDateLabel = (facts = {}) => facts.month || [facts.periodStart,facts.periodEnd].filter(Boolean).join(' ～ ') || facts.date || '未注明日期';
const laborSort = (items, field = 'periodStart') => [...(items||[])].sort((a,b)=>String(a.facts?.[field]||a.facts?.month||a.facts?.date||a.createdAt||'').localeCompare(String(b.facts?.[field]||b.facts?.month||b.facts?.date||b.createdAt||'')));
const laborLatest = (store, field) => laborSort(state.data[store],field).at(-1) || null;
const laborRangeRecords = (items) => state.laborRange === 'all' ? items : items.slice(-Math.max(1,Number(state.laborRange)||12));

function laborParams() {
  const saved=state.data.laborParameters?.find((item)=>item.id==='default')?.facts||{};
  return {safetyMonths:3,targetMonthlySavings:2000,bufferRatio:0.15,forecastMonths:12,annualIncomeGrowth:0,annualSpendingGrowth:0,currentCommuteDaily:0,...saved};
}

function laborChart(series, {height=250, valueFormatter=(value)=>laborNumber(value,1)} = {}) {
  const clean=series.map((item)=>({...item,points:(item.points||[]).filter((point)=>Number.isFinite(Number(point.value)))})).filter((item)=>item.points.length);
  if(!clean.length)return '<div class="labor-chart-empty">数据不足，保存记录后显示真实趋势。</div>';
  const labels=[...new Set(clean.flatMap((item)=>item.points.map((point)=>String(point.label))))];
  const values=clean.flatMap((item)=>item.points.map((point)=>Number(point.value)));
  let min=Math.min(...values),max=Math.max(...values);if(Math.abs(max-min)<1e-9){const pad=Math.max(1,Math.abs(max)*.1);min-=pad;max+=pad;}else{const pad=(max-min)*.12;min-=pad;max+=pad;}
  const width=760,pad={left:58,right:24,top:28,bottom:45},innerW=width-pad.left-pad.right,innerH=height-pad.top-pad.bottom;
  const x=(label)=>pad.left+(labels.length===1?innerW/2:labels.indexOf(String(label))*innerW/(labels.length-1));
  const y=(value)=>pad.top+(max-Number(value))*innerH/(max-min);
  const grid=Array.from({length:5},(_,index)=>{const value=max-(max-min)*index/4;const py=pad.top+innerH*index/4;return `<line x1="${pad.left}" y1="${py}" x2="${width-pad.right}" y2="${py}"/><text x="${pad.left-8}" y="${py+4}" text-anchor="end">${esc(valueFormatter(value))}</text>`;}).join('');
  const lines=clean.map((item)=>{const points=item.points.map((point)=>`${x(point.label)},${y(point.value)}`).join(' ');const dots=item.points.map((point)=>`<circle cx="${x(point.label)}" cy="${y(point.value)}" r="${point.id?5:3.5}" fill="${item.color}" ${point.id?`data-labor-record="${esc(point.id)}" data-labor-store="${esc(point.store||'')}" tabindex="0" role="button"`:''}><title>${esc(point.label)} · ${esc(item.label)} ${esc(valueFormatter(point.value))}</title></circle>`).join('');return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${dots}`;}).join('');
  const labelStep=Math.max(1,Math.ceil(labels.length/6));const xLabels=labels.map((label,index)=>index%labelStep===0||index===labels.length-1?`<text x="${x(label)}" y="${height-14}" text-anchor="middle">${esc(label)}</text>`:'').join('');
  return `<div class="labor-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="趋势图"><g class="labor-grid">${grid}${xLabels}</g>${lines}</svg><div class="labor-chart-legend">${clean.map((item)=>`<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('')}</div></div>`;
}

function laborSalarySection() {
  const records=laborSort(state.data.salaryRecords,'periodStart');
  const chartRecords=laborRangeRecords(records);
  const metrics={totalSalary:['实际工资',(v)=>laborMoney(v)],averageHourlyRate:['平均实际时薪',(v)=>laborMoney(v)],estimatedBaseHourlyRate:['反推基础时薪',(v)=>laborMoney(v)],totalWorkHours:['总工作时长',(v)=>`${laborNumber(v)}h`],overtimeTotalHours:['加班时长',(v)=>`${laborNumber(v)}h`],overtimeShare:['加班占比',(v)=>laborPercent(v)]};
  const [metricLabel,formatter]=metrics[state.laborTrendMetric]||metrics.averageHourlyRate;
  const points=chartRecords.map((item)=>({label:laborDateLabel(item.facts),value:item.snapshot?.[state.laborTrendMetric],id:item.id,store:'salaryRecords'}));
  return `<section class="labor-section"><div class="labor-section-head"><div><h4>工资与劳动记录</h4><p>总工资是税后到手且已包含调整项；奖金、补贴和扣款仅用于拆分工时工资。</p></div><button class="btn primary" data-open="new-salary">＋ 新增记录</button></div>
    <div class="card labor-chart-card"><div class="labor-chart-toolbar"><b>${esc(metricLabel)}变化</b><select class="select compact" id="labor-trend-metric">${Object.entries(metrics).map(([key,[label]])=>`<option value="${key}" ${key===state.laborTrendMetric?'selected':''}>${label}</option>`).join('')}</select></div>${laborChart([{label:metricLabel,color:'#e7654f',store:'salaryRecords',points}],{valueFormatter:formatter})}</div>
    <div class="card labor-table">${records.length?`<table><thead><tr><th>月份 / 周期</th><th>到手工资</th><th>总工时</th><th>加班分类工时</th><th>实际时薪</th><th>基础时薪估算</th><th>理论加班估算</th><th></th></tr></thead><tbody>${records.slice().reverse().map((item)=>`<tr><td><button class="labor-record-link" data-edit-salary="${esc(item.id)}">${esc(laborDateLabel(item.facts))}</button>${item.snapshot?.formulaVersion===1?'<small class="legacy-mark">旧口径</small>':''}</td><td>${laborMoney(item.snapshot?.totalSalary)}</td><td>${laborNumber(item.snapshot?.totalWorkHours)}h</td><td>${laborNumber(item.snapshot?.overtimeTotalHours)}h · ${laborPercent(item.snapshot?.overtimeShare)}</td><td>${laborMoney(item.snapshot?.averageHourlyRate)}</td><td>${laborMoney(item.snapshot?.estimatedBaseHourlyRate)}</td><td>${item.snapshot?.formulaVersion===2?laborMoney(item.snapshot?.theoreticalOvertimePay):'—'}</td><td class="row-actions"><button class="btn small" data-edit-salary="${esc(item.id)}">编辑</button><button class="btn small danger" data-delete-labor="salaryRecords:${esc(item.id)}">删除</button></td></tr>`).join('')}</tbody></table>`:empty('还没有工资记录','保存第一条真实工资和工时后开始形成趋势。')}</div>
    <details class="labor-formula"><summary>查看计算口径</summary><p>新口径总实际工时 = 实际上班总天数 × 每日正常工时 + 工作日额外加班小时；实际上班总天数已包含周末和法定节假日，不能再次叠加。平均实际时薪使用真实到手工资；基础时薪与理论加班报酬由倍率加权反推，只是估算，不代表合同约定或已经实际收到的工资。旧记录继续按保存时的旧公式显示。</p></details></section>`;
}

function overtimeFormFacts() {
  const editing=state.data.overtimeDecisions?.find((item)=>item.id===state.laborEditingOvertimeId);
  const latestSalary=laborLatest('salaryRecords','periodStart');
  const defaultRate=latestSalary?.snapshot?.estimatedBaseHourlyRate||0;
  const defaults={overtimeVersion:3,date:localDateKey(),scenario:'after-work',baseHourlyRate:defaultRate,normalWage:0,normalPaidHours:0,multiplier:1.5,overtimeHourlyRate:defaultRate*1.5,overtimeRateMode:'multiplier',durationValue:0,taxiCost:0,mealCost:0,fixedExtraCost:0,variableExtraCostPerHour:0,extraOccupiedHours:0,minimumAcceptableHourly:0,customExpenses:[],nightSubsidyMode:'fixed',nightSubsidyAmount:0,wageSettlementMode:'actual',settlementUnit:.5,partialUnitRule:'discard',bonusMode:'none',bonusThresholdHours:4,bonusThresholdAmount:0,bonusTiers:[],legacyFixedCost:0,legacyVariableCostPerHour:0,legacyCommuteHours:0,restValuePerHour:0,fatigueCoefficient:0,maxHours:12,note:''};
  if(!editing)return defaults;
  const facts=editing.facts||{};
  if(Number(facts.overtimeVersion||0)>=2){const merged={...defaults,...facts,customExpenses:Array.isArray(facts.customExpenses)?facts.customExpenses:[],bonusTiers:Array.isArray(facts.bonusTiers)?facts.bonusTiers:[]};if(!Object.prototype.hasOwnProperty.call(facts,'overtimeHourlyRate'))merged.overtimeHourlyRate=Number(merged.baseHourlyRate||0)*Number(merged.multiplier||1.5);return merged;}
  const durationValue=facts.durationUnit==='days'?Number(facts.durationValue||0)*Number(facts.dailyHours||8):Number(facts.durationValue||0);
  return {...defaults,date:facts.date||localDateKey(),scenario:facts.scenario||'after-work',baseHourlyRate:Number(facts.baseHourlyRate||0),multiplier:Number(facts.multiplier||1.5),durationValue,legacyFixedCost:Number(facts.fixedCost||0),legacyVariableCostPerHour:Number(facts.variableCostPerHour||0),legacyCommuteHours:Number(facts.commuteHours||0),restValuePerHour:Number(facts.restValuePerHour||0),fatigueCoefficient:Number(facts.fatigueCoefficient||0),maxHours:Number(facts.maxHours||12),note:facts.note||'',legacySource:true};
}

function overtimeExpenseRow(item = {}, index = 0) {
  return `<div class="overtime-expense-row"><input type="hidden" name="customId" value="${esc(item.id||`custom-${index}`)}"><label>名称<input class="input" name="customName" maxlength="80" value="${esc(item.name||'')}" placeholder="例如：节省娱乐消费"></label><label>金额<input class="input" type="number" name="customAmount" step="0.01" value="${Number(item.amount||0)}" aria-label="自定义消费金额"></label><button class="btn small danger" type="button" data-remove-overtime-expense aria-label="删除自定义消费">删除</button></div>`;
}

function overtimeBonusTierRow(item = {}, index = 0) {
  return `<div class="overtime-expense-row overtime-tier-row"><input type="hidden" name="bonusTierId" value="${esc(item.id||`tier-${index}`)}"><label>达到小时<input class="input" type="number" name="bonusTierHours" min="0.5" step="0.5" value="${Number(item.hours||.5)}"></label><label>补贴金额<input class="input" type="number" name="bonusTierAmount" min="0" step="0.01" value="${Number(item.amount||0)}"></label><button class="btn small danger" type="button" data-remove-overtime-tier>删除</button></div>`;
}

function pairedRangeNumber({name,label,value,min=0,max=100,step=1,optional=false}) {
  const shown=value==null||value===''?'':Number(value);const rangeValue=shown===''?Math.min(max,Math.max(min,(min+max)/2)):Math.min(max,Math.max(min,shown));const rangeMax=Math.max(max,Number(shown)||0);
  return `<label class="paired-number-field"><span>${esc(label)}</span><div><input type="range" min="${min}" max="${rangeMax}" step="${step}" value="${rangeValue}" data-paired-range="${esc(name)}" aria-label="${esc(label)}滑块"><input class="input" type="number" name="${esc(name)}" min="${min}" max="${rangeMax}" step="${step}" value="${shown}" data-paired-number="${esc(name)}" ${optional?'placeholder="未记录"':''}></div></label>`;
}

function normalRateExplanation(values = {}) {
  const wage=Number(values.normalWage||0),hours=Number(values.normalPaidHours||0),direct=Number(values.baseHourlyRate||0);
  if(wage>0&&hours>0)return {incomplete:false,text:`已按 ${laborMoney(wage)} ÷ ${laborNumber(hours,2)} 小时，反推正常时薪为 ${laborMoney(wage/hours)} / 小时。`};
  if(wage>0||hours>0)return {incomplete:true,text:'目前只填写了一项，因此不会参与计算。请同时填写正常工资总额和对应计薪工时，或把两项都留空并直接填写正常时薪。'};
  return {incomplete:false,text:`当前直接使用正常时薪 ${laborMoney(direct)} / 小时。前两项可以保持为空。`};
}

function overtimeSvgChart(series, analysis, {rate=false,height=rate?190:300} = {}) {
  const clean=series.map((item)=>({...item,points:item.points.filter((point)=>Number.isFinite(Number(point.value)))})).filter((item)=>item.points.length);
  const width=760,pad={left:62,right:24,top:rate?22:30,bottom:42},innerW=width-pad.left-pad.right,innerH=height-pad.top-pad.bottom,maxHours=Math.max(.5,Number(analysis.input.maxHours)||12);
  const values=[0,...clean.flatMap((item)=>item.points.map((point)=>Number(point.value)))];let min=Math.min(...values),max=Math.max(...values);if(Math.abs(max-min)<1e-9){min-=1;max+=1;}else{const extra=(max-min)*.12;min-=extra;max+=extra;}
  const x=(hours)=>pad.left+Math.max(0,Math.min(maxHours,Number(hours)||0))*innerW/maxHours;const y=(value)=>pad.top+(max-Number(value))*innerH/(max-min);
  const grid=Array.from({length:5},(_,index)=>{const value=max-(max-min)*index/4,py=pad.top+innerH*index/4;return `<line x1="${pad.left}" y1="${py}" x2="${width-pad.right}" y2="${py}"/><text x="${pad.left-8}" y="${py+4}" text-anchor="end">${esc(laborMoney(value))}</text>`;}).join('');
  const xTicks=Array.from({length:5},(_,index)=>{const hours=maxHours*index/4;return `<text x="${x(hours)}" y="${height-13}" text-anchor="middle">${laborNumber(hours,2)}h</text>`;}).join('');
  const lines=clean.map((item)=>{const first=item.points[0],activation=!rate&&analysis.activation?.[item.key];let path=`M ${x(first.hours)} ${y(first.value)}`;if(first.hours===0&&Number.isFinite(Number(activation))&&Math.abs(Number(activation)-Number(first.value))>.001)path+=` L ${x(0)} ${y(activation)}`;for(const point of item.points.slice(1))path+=` L ${x(point.hours)} ${y(point.value)}`;return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="${item.width||2.5}" ${item.dash?'stroke-dasharray="5 5"':''} vector-effect="non-scaling-stroke"/>`;}).join('');
  const hitPoints=!rate&&clean[0]?clean[0].points.map((point)=>`<circle cx="${x(point.hours)}" cy="${y(point.value)}" r="7" class="overtime-hit-point" data-view-overtime-hours="${point.hours}" tabindex="0"><title>${laborNumber(point.hours,2)}h：点击查看该节点</title></circle>`).join(''):'';
  const currentX=x(analysis.selected.hours);const viewed=analysis.viewPoint||analysis.selected,viewX=x(viewed.hours);const optimal=!rate?`<circle cx="${x(analysis.nodes.optimal.hours)}" cy="${y(analysis.nodes.optimal.comprehensiveValue)}" r="5" class="overtime-optimal"><title>综合净价值最高点：${laborNumber(analysis.nodes.optimal.hours,2)}h，${laborMoney(analysis.nodes.optimal.comprehensiveValue)}</title></circle>`:'';
  const crossingBands=!rate?(analysis.nodes.zeroCrossings||[]).map((item)=>`<rect x="${x(item.fromHours)}" y="${pad.top}" width="${Math.max(2,x(item.toHours)-x(item.fromHours))}" height="${innerH}" class="overtime-crossing"><title>综合净价值跨越零线：${laborNumber(item.fromHours,2)}–${laborNumber(item.toHours,2)}h</title></rect>`).join(''):'';
  const jump=!rate&&analysis.jumps?.length?`<line x1="${x(0)+1}" y1="${pad.top}" x2="${x(0)+1}" y2="${pad.top+innerH}" class="overtime-jump"><title>0 小时后包含一次性支出或固定补贴跳变</title></line>`:'';
  const settlements=!rate?(analysis.settlementPoints||[]).map((item)=>`<line x1="${x(item.hours)}" y1="${pad.top}" x2="${x(item.hours)}" y2="${pad.top+innerH}" class="overtime-settlement-line"><title>${esc(item.label)}</title></line>`).join(''):'';
  const viewLine=`<line x1="${viewX}" y1="${pad.top}" x2="${viewX}" y2="${pad.top+innerH}" class="overtime-view-line" data-overtime-view-line/><text x="${Math.min(width-pad.right-4,viewX+5)}" y="${pad.top+26}" class="overtime-view-label" data-overtime-view-label>查看 ${laborNumber(viewed.hours,2)}h</text>`;
  return `<div class="labor-chart overtime-chart ${rate?'rate-chart':''}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${rate?'收益变化率图':'加班累计收益图'}"><g class="labor-grid">${grid}${xTicks}</g>${crossingBands}${jump}${settlements}<line x1="${pad.left}" y1="${y(0)}" x2="${width-pad.right}" y2="${y(0)}" class="overtime-zero-line"/>${lines}${hitPoints}<line x1="${currentX}" y1="${pad.top}" x2="${currentX}" y2="${pad.top+innerH}" class="overtime-current-line"/><text x="${Math.min(width-pad.right-4,currentX+5)}" y="${pad.top+12}" class="overtime-current-label">计划 ${laborNumber(analysis.selected.hours,2)}h</text>${viewLine}${optimal}</svg><div class="labor-chart-legend">${clean.map((item)=>`<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('')}<span><i class="zero"></i>${rate?'零变化率':'零收益'}</span></div></div>`;
}

function overtimeSubjectiveChart(records, analysis) {
  const ordered=[...(records||[])].sort((a,b)=>String(a.observedAt||a.createdAt).localeCompare(String(b.observedAt||b.createdAt)));const maxHours=Math.max(.5,analysis.input.maxHours);const width=760,height=210,pad={left:54,right:24,top:24,bottom:38},innerW=width-pad.left-pad.right,innerH=height-pad.top-pad.bottom;const x=(hours)=>pad.left+Math.max(0,Math.min(maxHours,Number(hours)||0))*innerW/maxHours,y=(score)=>pad.top+(100-Number(score))*innerH/100;
  const series=[['fatigue','疲劳程度','#e7654f'],['willingness','继续加班意愿','#245fa8']];const paths=series.map(([key,label,color])=>{const points=ordered.filter((item)=>item[key]!=null&&item[key]!==''&&Number.isFinite(Number(item[key]))).map((item)=>({...item,value:Number(item[key])}));if(!points.length)return '';const path=points.map((item,index)=>`${index?'L':'M'} ${x(item.hours)} ${y(item.value)}`).join(' ');const dots=points.map((item)=>`<circle cx="${x(item.hours)}" cy="${y(item.value)}" r="5" fill="${color}" data-view-overtime-hours="${item.hours}" tabindex="0"><title>${laborNumber(item.hours,2)}h · ${label} ${item.value} · ${esc(dateText(item.observedAt||item.createdAt))}</title></circle>`).join('');return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${dots}`;}).join('');
  const grid=[0,25,50,75,100].map((score)=>`<line x1="${pad.left}" y1="${y(score)}" x2="${width-pad.right}" y2="${y(score)}"/><text x="${pad.left-8}" y="${y(score)+4}" text-anchor="end">${score}</text>`).join('');const planX=x(analysis.selected.hours);
  return `<div class="labor-chart overtime-chart overtime-subjective-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="疲劳与继续加班意愿真实记录"><g class="labor-grid">${grid}</g>${paths}<line x1="${planX}" y1="${pad.top}" x2="${planX}" y2="${pad.top+innerH}" class="overtime-current-line"/></svg><div class="labor-chart-legend"><span><i style="background:#e7654f"></i>疲劳程度（真实记录）</span><span><i style="background:#245fa8"></i>继续加班意愿（真实记录）</span></div>${ordered.length?'':'<p class="subtle">尚未记录主观状态；这里不会自动生成或预测分数。</p>'}</div>`;
}

function overtimeSuggestions(analysis, records) {
  const ordered=[...(records||[])].sort((a,b)=>String(a.observedAt||a.createdAt).localeCompare(String(b.observedAt||b.createdAt)));const latest=ordered.at(-1),previous=ordered.at(-2);const items=[];
  const currentHours=analysis.viewPoint?.hours??latest?.hours??analysis.selected.hours;const next=(analysis.settlementPoints||[]).find((item)=>item.hours>currentHours+1e-9);if(next){const current=overtimeAnalysisPoint(analysis,currentHours),future=overtimeAnalysisPoint(analysis,next.hours);if(current&&future)items.push(`从当前查看的 ${laborNumber(currentHours,2)} 小时，再工作 ${laborNumber(next.hours-currentHours,2)} 小时可到达下一结算节点：收入增加 ${laborMoney(future.totalOvertimeIncome-current.totalOvertimeIncome)}，溢价增加 ${laborMoney(future.overtimePremium-current.overtimePremium)}，未来新增成本 ${laborMoney(future.extraCosts-current.extraCosts)}，净现金增加 ${laborMoney(future.cashNetValue-current.cashNetValue)}，额外占用 ${laborNumber(future.actualOccupiedHours-current.actualOccupiedHours,2)} 小时。`);}
  if(latest){items.push(`最近记录：已加班 ${laborNumber(latest.hours,2)} 小时，疲劳 ${latest.fatigue==null?'未记录':`${latest.fatigue} 分`}，意愿 ${latest.willingness==null?'未记录':`${latest.willingness} 分`}。`);if(previous&&latest.willingness!=null&&previous.willingness!=null){const delta=latest.willingness-previous.willingness;if(delta)items.push(`继续加班意愿相比上次${delta>0?'上升':'下降'} ${Math.abs(delta)} 分。`);}}
  if(analysis.noAcceptableOvertime)items.push('当前条件下没有符合最低接受净时薪要求的正时长方案；不加班是合理候选。');else if(analysis.acceptableRanges?.length)items.push(`符合最低接受回报的时长范围：${analysis.acceptableRanges.map((item)=>item.fromHours===item.toHours?`${laborNumber(item.fromHours,2)}h`:`${laborNumber(item.fromHours,2)}–${laborNumber(item.toHours,2)}h`).join('、')}。`);
  items.push(`综合净价值在当前估算中于 ${laborNumber(analysis.nodes.optimal.hours,2)} 小时最高；经济最优点不代表身体承受极限。`);return items;
}

function overtimeAnalysisPoint(analysis, hours) {
  const target=Math.round(Math.max(0,Math.min(Number(analysis.input.maxHours)||0,Number(hours)||0))*2)/2;
  return analysis.points.find((point)=>Math.abs(point.hours-target)<1e-9)||analysis.points.reduce((best,point)=>Math.abs(point.hours-target)<Math.abs(best.hours-target)?point:best,analysis.points[0]);
}

function overtimeResultTopHtml(analysis) {
  const viewed=analysis.viewPoint||analysis.selected,interval=analysis.rates.find((item)=>Math.abs(item.toHours-viewed.hours)<1e-9);
  const recommendation=analysis.allPositiveHoursNegative?'<div class="warning overtime-decision"><b>当前假设下，不加班可能更有利。</b><span>所有正加班时长的综合净价值均低于 0；这是基于你的时间价值和疲劳系数的计算，不是健康或劳动法结论。</span></div>':'';
  const acceptanceWarning=analysis.noAcceptableOvertime?'<div class="warning overtime-decision"><b>当前条件下没有符合要求的加班方案。</b><span>所有正时长节点的净现金收益都低于个人最低接受回报；系统不会强行推荐加班。</span></div>':'';
  const card=(key,label,value)=>`<button class="overtime-result-card" type="button" data-overtime-detail="${key}"><span>${label}</span><b>${value}</b><small>查看计算明细</small></button>`;
  return `<div class="labor-live-summary overtime-summary">${card('actualIncrementalIncome','实际增量收入',laborMoney(viewed.actualIncrementalIncome))}${card('overtimePremium','加班溢价',laborMoney(viewed.overtimePremium))}${card('cashNetValue','净现金收益',laborMoney(viewed.cashNetValue))}<div><span>实际占用时间</span><b>${laborNumber(viewed.actualOccupiedHours,2)}h</b></div>${card('actualNetHourly','实际额外净时薪',viewed.actualNetHourly==null?'—':laborMoney(viewed.actualNetHourly))}</div><p class="overtime-view-caption">${analysis.viewPoint?`正在查看 ${laborNumber(viewed.hours,2)} 小时节点；原计划仍是 ${laborNumber(analysis.selected.hours,2)} 小时。`:`当前显示计划时长 ${laborNumber(analysis.selected.hours,2)} 小时。`} 正常工资基准 ${laborMoney(viewed.normalPayBaseline)} 仅用于计算溢价，不重复计入收入。</p><div class="overtime-point-detail"><span>额外费用 <b>${laborMoney(viewed.extraCosts)}</b></span><span>最低接受回报 <b>${laborMoney(viewed.minimumAcceptableReturn)}</b></span><span>与门槛差额 <b>${laborMoney(viewed.acceptanceGap)}</b></span><span>本区间边际净收益 <b>${interval?`${laborMoney(interval.cashRate)} / 小时`:'—'}</b></span><button type="button" data-overtime-detail="comprehensiveValue"><span>综合净价值</span><b>${laborMoney(viewed.comprehensiveValue)}</b></button></div>${acceptanceWarning}${recommendation}`;
}

function overtimeResultBottomHtml(analysis, statusRecords = []) {
  const point=(value)=>value?`${laborNumber(value.hours??value.toHours,2)}h`:'不存在';
  const crossing=(analysis.nodes.zeroCrossings||[])[0];const rateTurn=analysis.nodes.rateTurnsNegative;
  return `<div class="labor-node-grid overtime-nodes"><span>现金回本点 <b>${point(analysis.nodes.cashBreakEven)}</b></span><span>个人接受临界点 <b>${point(analysis.nodes.acceptancePoint)}</b></span><span>综合最高点 <b>${point(analysis.nodes.optimal)} · ${laborMoney(analysis.nodes.optimal?.comprehensiveValue)}</b></span><span>零线跨越 <b>${crossing?`${laborNumber(crossing.fromHours,2)}–${laborNumber(crossing.toHours,2)}h`:'不存在'}</b></span><span>变化率转负 <b>${rateTurn?`${laborNumber(rateTurn.fromHours,2)}–${laborNumber(rateTurn.toHours,2)}h`:'不存在'}</b></span><span>下一结算点 <b>${analysis.nextSettlement?`${laborNumber(analysis.nextSettlement.hours,2)}h · +${laborMoney(analysis.nextSettlement.extraIncome)}`:'不存在'}</b></span></div><div class="overtime-suggestions"><b>基于当前数据的提示</b><ul>${overtimeSuggestions(analysis,statusRecords).map((item)=>`<li>${esc(item)}</li>`).join('')}</ul></div>`;
}

function overtimeAiSignature(facts, analysis, statusRecords = []) {
  return JSON.stringify({facts:{...facts,note:undefined},viewHours:(analysis.viewPoint||analysis.selected).hours,nodes:analysis.nodes,statusRecords:statusRecords.map(({hours,fatigue,willingness,reasons,decision,observedAt})=>({hours,fatigue,willingness,reasons,decision,observedAt}))});
}

function overtimeAiHtml() {
  const ai=overtimeRuntime.ai,stale=Boolean(ai&&ai.signature!==overtimeRuntime.signature),pending=Boolean(overtimeRuntime.aiPending);
  const status=pending?'<p class="overtime-ai-status" role="status">正在生成分析……</p>':overtimeRuntime.aiError?`<p class="overtime-ai-status error-text" role="alert">AI 分析失败：${esc(overtimeRuntime.aiError)}</p>`:ai?'':'<p class="subtle">尚未生成 AI 分析。</p>';
  return `<section class="overtime-ai-card ${pending?'is-loading':''}"><div><b>AI 总结与建议</b><p>仅解释程序已经算出的金额、门槛与真实状态记录，不参与计算。未配置 AI 时，本地分析仍完整可用。</p></div><button class="btn" type="button" data-generate-overtime-ai ${pending?'disabled aria-busy="true"':''}>${pending?'正在生成分析……':ai?'重新生成':'生成分析'}</button>${status}${ai?`<div class="overtime-ai-result ${stale?'stale':''}">${stale?'<strong>参数已经变化，这份分析已过期。</strong>':''}<p>${esc(ai.text).replace(/\n/g,'<br>')}</p></div>`:''}</section>`;
}

function overtimeAnalysisHtml(analysis, statusRecords = [], {printMode=false} = {}) {
  const allMainSeries=[{key:'totalOvertimeIncome',label:'加班实际增量收入',color:'#245fa8',points:analysis.points.map((item)=>({hours:item.hours,value:item.totalOvertimeIncome}))},{key:'overtimePremium',label:'加班溢价',color:'#7b61a8',points:analysis.points.map((item)=>({hours:item.hours,value:item.overtimePremium}))},{key:'cashNetValue',label:'净现金收益',color:'#237a5a',points:analysis.points.map((item)=>({hours:item.hours,value:item.cashNetValue}))},{key:'minimumAcceptableReturn',label:'最低接受回报',color:'#a86100',dash:true,points:analysis.points.map((item)=>({hours:item.hours,value:item.minimumAcceptableReturn}))},{key:'comprehensiveValue',label:'综合净价值',color:'#e7654f',points:analysis.points.map((item)=>({hours:item.hours,value:item.comprehensiveValue}))}];
  const hidden=new Set(printMode?[]:state.overtimeHiddenSeries);const mainSeries=allMainSeries.filter((item)=>!hidden.has(item.key));
  const rateSeries=[{key:'comprehensiveRate',label:'综合价值变化率',color:'#a86100',points:analysis.rates.map((item)=>({hours:item.toHours,value:item.comprehensiveRate}))},{key:'cashRate',label:'净现金变化率',color:'#237a5a',points:analysis.rates.map((item)=>({hours:item.toHours,value:item.cashRate}))}];
  const legend=allMainSeries.map((item)=>`<button type="button" class="overtime-legend-toggle ${hidden.has(item.key)?'muted':''}" data-toggle-overtime-series="${item.key}" aria-pressed="${!hidden.has(item.key)}"><i style="background:${item.color}"></i>${item.label}</button>`).join('');
  return `<div data-overtime-result-top>${overtimeResultTopHtml(analysis)}</div>
    <section class="overtime-chart-block"><div class="labor-chart-toolbar"><div><b>累计收益</b><p>实线为程序计算；竖虚线标记工资或补贴结算节点。</p></div>${printMode?'':`<div class="overtime-interactive-only overtime-legend-buttons">${legend}</div>`}</div>${overtimeSvgChart(mainSeries,analysis)}</section>
    <section class="overtime-chart-block compact"><div class="labor-chart-toolbar"><div><b>每 0.5 小时变化率</b><p>使用相邻离散点差分，单位为元/小时，不是连续导数。</p></div></div>${overtimeSvgChart(rateSeries,analysis,{rate:true})}</section>
    <section class="overtime-chart-block compact"><div class="labor-chart-toolbar"><div><b>疲劳与继续加班意愿</b><p>仅显示用户真实记录，0～100 分不换算为人民币。</p></div></div>${overtimeSubjectiveChart(statusRecords,analysis)}</section>
    <div data-overtime-result-bottom>${overtimeResultBottomHtml(analysis,statusRecords)}</div>${printMode?'':`<div data-overtime-ai-host>${overtimeAiHtml()}</div>`}`;
}

function overtimePrintReportHtml(facts, analysis, statusRecords = [], ai = null) {
  const selected=analysis.selected;const custom=(facts.customExpenses||[]).map((item)=>`<tr><th>${esc(item.name||'自定义消费')}</th><td>${laborMoney(item.amount)}</td></tr>`).join('');
  const subsidyLabel=facts.nightSubsidyMode==='hourly'?'按小时补贴':'固定补贴';
  return `<section class="overtime-print-report" id="overtime-print-report" aria-label="加班价值分析报告"><header><span>TOWARD THE SEA · WORK & LIFE</span><h1>加班价值分析报告</h1><p>决策日期：${esc(facts.date||localDateKey())} · 当前试算，不要求预先保存</p></header>
    <div class="overtime-print-facts"><section><h2>试算条件</h2><dl><div><dt>正常时薪</dt><dd>${laborMoney(analysis.input.normalHourlyRate)} / 小时</dd></div><div><dt>加班总倍率</dt><dd>${laborNumber(selected.totalMultiplier,2)} 倍</dd></div><div><dt>加班时长</dt><dd>${laborNumber(selected.hours,2)} 小时</dd></div><div><dt>夜班补贴</dt><dd>${subsidyLabel} · ${laborMoney(facts.nightSubsidyAmount)}</dd></div></dl></section><section><h2>收入与价值</h2><dl><div><dt>实际增量收入</dt><dd>${laborMoney(selected.actualIncrementalIncome)}</dd></div><div><dt>加班溢价</dt><dd>${laborMoney(selected.overtimePremium)}</dd></div><div><dt>净现金收益</dt><dd>${laborMoney(selected.cashNetValue)}</dd></div><div><dt>综合净价值</dt><dd>${laborMoney(selected.comprehensiveValue)}</dd></div></dl></section></div>
    <section class="overtime-print-costs"><h2>成本明细</h2><table><tbody><tr><th>打车费用</th><td>${laborMoney(selected.taxiCost)}</td></tr><tr><th>外卖费用</th><td>${laborMoney(selected.mealCost)}</td></tr>${custom}<tr><th>额外现金支出合计</th><td>${laborMoney(selected.extraCosts)}</td></tr><tr><th>实际额外占用时间</th><td>${laborNumber(selected.actualOccupiedHours,2)} 小时</td></tr><tr><th>最低接受回报</th><td>${laborMoney(selected.minimumAcceptableReturn)}</td></tr><tr><th>自由时间机会成本</th><td>${laborMoney(selected.restOpportunityCost)}</td></tr><tr><th>旧疲劳成本估算</th><td>${laborMoney(selected.fatigueCost)}</td></tr></tbody></table></section>
    <section class="overtime-print-analysis"><h2>收益曲线与关键节点</h2>${overtimeAnalysisHtml(analysis,statusRecords,{printMode:true})}</section>
    ${ai?`<section class="overtime-print-note"><h2>AI 总结与建议</h2><p>${esc(ai.text).replace(/\n/g,'<br>')}</p></section>`:''}${facts.note?`<section class="overtime-print-note"><h2>备注</h2><p>${esc(facts.note).replace(/\n/g,'<br>')}</p></section>`:''}<footer>综合净价值中的自由时间价值与疲劳系数是个人决策参数；变化率为每 0.5 小时离散差分，不是连续导数。本报告仅用于辅助判断。</footer></section>`;
}

const OVERTIME_STATUS_REASONS=['身体疲惫','想休息','加班费吸引力','接近补贴门槛','临时有事','工作要求'];
function overtimeStatusSection(facts, analysis, records) {
  const editing=(records||[]).find((item)=>item.id===state.laborEditingOvertimeStatusId);const value=editing||{hours:analysis.selected.hours,fatigue:null,willingness:null,reasons:[],decision:'',note:'',observedAt:now()};
  const score=(key)=>value[key]==null?'':Number(value[key]);const cards=[...(records||[])].sort((a,b)=>String(b.observedAt||b.createdAt).localeCompare(String(a.observedAt||a.createdAt))).map((item)=>`<article class="overtime-status-card"><div><b>${laborNumber(item.hours,2)}h · ${esc(dateText(item.observedAt||item.createdAt))}</b><span>疲劳 ${item.fatigue==null?'未记录':`${item.fatigue} 分`} · 意愿 ${item.willingness==null?'未记录':`${item.willingness} 分`}</span></div><p>${esc(item.decisionLabel||({continue:'继续',leave:'下班',cannot:'想走但不能离开'}[item.decision])||'未记录决定')}${item.reasons?.length?` · ${item.reasons.map(esc).join('、')}`:''}${item.note?` · ${esc(item.note)}`:''}</p><div class="row-actions"><button class="btn small" type="button" data-edit-overtime-status="${esc(item.id)}">编辑</button><button class="btn small danger" type="button" data-delete-overtime-status="${esc(item.id)}">删除</button></div></article>`).join('');
  return `<section class="card overtime-status-section"><div class="labor-section-head"><div><h4>记录此刻状态</h4><p>主观评分只作为真实记录，不参与工资计算，也不会自动换算为金额。</p></div></div><form id="overtime-status-form"><input type="hidden" name="decisionDate" value="${esc(facts.date)}"><div class="labor-form-grid overtime-status-grid">${pairedRangeNumber({name:'hours',label:'当前已加班时长',value:value.hours,min:0,max:Number(facts.maxHours||12),step:.5})}<label>记录时间<input class="input" type="datetime-local" name="observedAt" required value="${dateTimeLocalValue(value.observedAt)}"></label>${pairedRangeNumber({name:'fatigue',label:'疲劳程度（可空）',value:score('fatigue'),min:0,max:100,step:1,optional:true})}${pairedRangeNumber({name:'willingness',label:'继续加班意愿（可空）',value:score('willingness'),min:0,max:100,step:1,optional:true})}</div><p class="field-hint">时长按 0.5 小时记录。0 / 25 / 50 / 75 / 100 分别可理解为从无到强；这不是医学测量或统一心理量表。未填写的数值保持“未记录”。</p><fieldset class="overtime-reasons"><legend>变化原因（可多选）</legend>${OVERTIME_STATUS_REASONS.map((reason)=>`<label><input type="checkbox" name="reason" value="${esc(reason)}" ${value.reasons?.includes(reason)?'checked':''}>${esc(reason)}</label>`).join('')}</fieldset><div class="labor-form-grid compact overtime-status-meta"><label>实际决定<select class="select" name="decision"><option value="">未记录</option><option value="continue" ${value.decision==='continue'?'selected':''}>继续</option><option value="leave" ${value.decision==='leave'?'selected':''}>下班</option><option value="cannot" ${value.decision==='cannot'?'selected':''}>想走但不能离开</option></select></label><label>备注<input class="input" name="note" maxlength="300" value="${esc(value.note||'')}"></label></div><div class="row-actions"><button class="btn primary" type="submit">${editing?'更新状态记录':'保存状态记录'}</button>${editing?'<button class="btn" type="button" data-cancel-overtime-status>取消编辑</button>':''}</div></form><div class="overtime-status-history">${cards||'<p class="subtle">还没有状态记录。可从 0 小时开始记录正常下班时的初始状态。</p>'}</div></section>`;
}

function printOvertimeReport(form) {
  const facts=readOvertimeForm(form),analysis=analyzeOvertime(facts),records=(state.data.overtimeStatusRecords||[]).filter((item)=>item.decisionDate===facts.date);if(state.overtimeViewHours!=null)analysis.viewPoint=overtimeAnalysisPoint(analysis,state.overtimeViewHours);const signature=overtimeAiSignature(facts,analysis,records),ai=overtimeRuntime.ai?.signature===signature?overtimeRuntime.ai:null;
  document.querySelector('#overtime-print-portal')?.remove();
  const template=document.createElement('template');template.innerHTML=overtimePrintReportHtml(facts,analysis,records,ai).trim();const portal=template.content.firstElementChild;if(!portal)throw new Error('未能生成加班价值报告');portal.id='overtime-print-portal';
  document.body.append(portal);document.body.classList.add('printing-overtime');
  let fallbackTimer=null;
  const cleanup=()=>{window.removeEventListener('afterprint',cleanup);if(fallbackTimer)clearTimeout(fallbackTimer);portal.remove();document.body.classList.remove('printing-overtime');};
  window.addEventListener('afterprint',cleanup,{once:true});
  try{window.print();fallbackTimer=setTimeout(cleanup,60000);}catch(error){cleanup();throw error;}
}

function laborOvertimeSection() {
  const facts=overtimeFormFacts();let analysis;try{analysis=analyzeOvertime(facts);}catch{analysis=analyzeOvertime({...facts,baseHourlyRate:0});}
  const normalRateHelp=normalRateExplanation(facts);
  const decisions=laborSort(state.data.overtimeDecisions,'date').reverse();
  const statusRecords=(state.data.overtimeStatusRecords||[]).filter((item)=>item.decisionDate===facts.date);
  if(state.overtimeViewHours!=null&&state.overtimeViewHours<=analysis.input.maxHours)analysis.viewPoint=overtimeAnalysisPoint(analysis,state.overtimeViewHours);
  const inspectionHours=analysis.viewPoint?.hours??analysis.selected.hours;
  const rates=[1.5,2,3].map((rate)=>`<div class="overtime-rate ${Number(analysis.input.multiplier)===rate?'active':''}" data-overtime-rate="${rate}"><span>${rate} 倍每小时</span><b>${laborMoney(Number(analysis.input.normalHourlyRate||0)*rate)}</b></div>`).join('');
  const legacyNotice=facts.legacySource?`<div class="warning"><b>旧版参数兼容</b><br>旧固定支出 ${laborMoney(facts.legacyFixedCost)}、旧每小时支出 ${laborMoney(facts.legacyVariableCostPerHour)}、旧额外通勤 ${laborNumber(facts.legacyCommuteHours)}h 会继续参与本次编辑，避免历史判断被静默改变。</div>`:'';
  const fixedCosts=Number(facts.taxiCost||0)+Number(facts.mealCost||0)+Number(facts.fixedExtraCost||0),costSummary=fixedCosts||facts.variableExtraCostPerHour||facts.extraOccupiedHours?`一次性 ${laborMoney(fixedCosts)} · 每小时 ${laborMoney(facts.variableExtraCostPerHour)} · 额外 ${laborNumber(facts.extraOccupiedHours,2)}h`:'未配置额外成本';
  const customTotal=(facts.customExpenses||[]).reduce((sum,item)=>sum+Number(item.amount||0),0),customSummary=facts.customExpenses?.length?`${facts.customExpenses.length} 项 · 净变化 ${laborMoney(customTotal)}`:'未添加自定义消费';
  const subsidySummary=Number(facts.nightSubsidyAmount||0)>0?`${facts.nightSubsidyMode==='hourly'?'按小时':'固定'} ${laborMoney(facts.nightSubsidyAmount)}`:'未配置夜班补贴';
  const settlementSummary=facts.wageSettlementMode==='complete-unit'?`每 ${laborNumber(facts.settlementUnit,2)}h 完整结算${facts.bonusMode==='none'?' · 无额外补贴':' · 已配置补贴门槛'}`:facts.bonusMode==='none'?'按实际时长 · 无额外补贴':'按实际时长 · 已配置补贴门槛';
  overtimeRuntime={...overtimeRuntime,analysis,facts,statusRecords,signature:overtimeAiSignature(facts,analysis,statusRecords)};
  return `<section class="labor-section"><div class="labor-section-head"><div><h4>今天加班多久更合适？</h4><p>所有金额均以不加班为 0 基准；预览不会自动覆盖已保存历史。</p></div><div class="row-actions"><button class="btn" type="button" data-overtime-help="all">字段说明</button>${state.laborEditingOvertimeId?'<button class="btn" data-cancel-overtime-edit>取消编辑</button>':''}</div></div>
    <form class="card labor-analysis-form overtime-v1" id="labor-overtime-form"><input type="hidden" name="overtimeVersion" value="3"><input type="hidden" name="scenario" value="${esc(facts.scenario||'after-work')}"><input type="hidden" name="overtimeRateMode" value="${esc(facts.overtimeRateMode||'multiplier')}"><input type="hidden" name="legacyFixedCost" value="${Number(facts.legacyFixedCost||0)}"><input type="hidden" name="legacyVariableCostPerHour" value="${Number(facts.legacyVariableCostPerHour||0)}"><input type="hidden" name="legacyCommuteHours" value="${Number(facts.legacyCommuteHours||0)}">${legacyNotice}
      <section class="overtime-control-section"><div class="overtime-section-head"><span>1</span><div><b>正常工资、时薪与加班报酬 ${overtimeHelpButton('normalWage')}</b><small>可以留空前两项，直接填写正常时薪；金额、时薪和倍率均支持两位小数。</small></div></div><div class="labor-form-grid overtime-rate-controls">${pairedRangeNumber({name:'normalWage',label:'正常工资总额（可选）',value:facts.normalWage,min:0,max:Math.max(50000,Number(facts.normalWage||0)),step:.01})}${pairedRangeNumber({name:'normalPaidHours',label:'正常计薪工时（可选）',value:facts.normalPaidHours,min:0,max:744,step:.01})}${pairedRangeNumber({name:'baseHourlyRate',label:'正常时薪',value:facts.baseHourlyRate,min:0,max:Math.max(500,Number(facts.baseHourlyRate||0)),step:.01})}${pairedRangeNumber({name:'multiplier',label:'加班总倍率',value:facts.multiplier,min:0,max:5,step:.01})}${pairedRangeNumber({name:'overtimeHourlyRate',label:'加班时薪',value:facts.overtimeHourlyRate,min:0,max:Math.max(1000,Number(facts.overtimeHourlyRate||0)),step:.01})}</div><p class="normal-rate-help ${normalRateHelp.incomplete?'incomplete':''}" data-normal-rate-help>${esc(normalRateHelp.text)}</p><div class="overtime-rate-grid">${rates}</div></section>
      <section class="overtime-control-section"><div class="overtime-section-head"><span>2</span><div><b>加班时长</b><small>滑块与数字输入以 0.5 小时同步。</small></div></div><div class="overtime-duration"><input type="range" min="0" max="${facts.maxHours}" step="0.5" value="${Math.min(Number(facts.durationValue||0),Number(facts.maxHours))}" data-overtime-range aria-label="加班时长滑块"><label><input class="input" type="number" name="durationValue" min="0" max="${facts.maxHours}" step="0.5" value="${facts.durationValue}"><span>小时</span></label></div></section>
      <details class="overtime-config-group"><summary><span><b>额外支出、通勤与最低回报</b><small>${esc(costSummary)}</small></span><i>展开配置</i></summary><div class="overtime-config-body"><p>一次性费用只在加班大于 0 小时时触发；最低接受净时薪不等于正常工资时薪。</p><div class="labor-form-grid">${pairedRangeNumber({name:'taxiCost',label:'打车费用（一次性）',value:facts.taxiCost,min:0,max:Math.max(500,Number(facts.taxiCost||0)),step:1})}${pairedRangeNumber({name:'mealCost',label:'外卖费用（一次性）',value:facts.mealCost,min:0,max:Math.max(500,Number(facts.mealCost||0)),step:1})}${pairedRangeNumber({name:'fixedExtraCost',label:'其他一次性费用',value:facts.fixedExtraCost,min:0,max:Math.max(1000,Number(facts.fixedExtraCost||0)),step:1})}${pairedRangeNumber({name:'variableExtraCostPerHour',label:'每小时额外费用',value:facts.variableExtraCostPerHour,min:0,max:Math.max(200,Number(facts.variableExtraCostPerHour||0)),step:.5})}${pairedRangeNumber({name:'extraOccupiedHours',label:'额外通勤及等待（小时）',value:facts.extraOccupiedHours,min:0,max:24,step:.5})}${pairedRangeNumber({name:'minimumAcceptableHourly',label:'最低接受净时薪',value:facts.minimumAcceptableHourly,min:0,max:Math.max(500,Number(facts.minimumAcceptableHourly||0)),step:1})}</div></div></details>
      <details class="overtime-config-group"><summary><span><b>自定义消费</b><small>${esc(customSummary)}</small></span><i>展开配置</i></summary><div class="overtime-config-body"><div class="overtime-section-head"><p>正数是新增支出，负数是节省支出；均按本次一次性变化计算。</p><button class="btn small" type="button" data-add-overtime-expense>＋ 添加自定义</button></div><div class="overtime-expense-list" data-overtime-expenses>${(facts.customExpenses||[]).map(overtimeExpenseRow).join('')||'<p class="subtle overtime-expense-empty">暂无自定义消费。</p>'}</div></div></details>
      <details class="overtime-config-group"><summary><span><b>夜班补贴</b><small>${esc(subsidySummary)}</small></span><i>展开配置</i></summary><div class="overtime-config-body"><p>夜班补贴与加班倍率独立计算，最后计入总加班收入。</p><div class="labor-form-grid compact"><label>补贴模式<select class="select" name="nightSubsidyMode"><option value="fixed" ${facts.nightSubsidyMode!=='hourly'?'selected':''}>固定补贴</option><option value="hourly" ${facts.nightSubsidyMode==='hourly'?'selected':''}>按小时补贴</option></select></label><label>补贴金额<input class="input" type="number" name="nightSubsidyAmount" min="0" step="0.01" value="${facts.nightSubsidyAmount}"></label></div></div></details>
      <details class="overtime-config-group"><summary><span><b>工资与补贴结算规则</b><small>${esc(settlementSummary)}</small></span><i>展开配置</i></summary><div class="overtime-config-body"><div class="overtime-section-head"><p>门槛造成的跳变会按真实规则保留；多档补贴取已达到的最高档。</p><button class="btn small" type="button" data-add-overtime-tier>＋ 补贴档位</button></div><div class="labor-form-grid"><label>工资结算<select class="select" name="wageSettlementMode"><option value="actual" ${facts.wageSettlementMode!=='complete-unit'?'selected':''}>按实际时长</option><option value="complete-unit" ${facts.wageSettlementMode==='complete-unit'?'selected':''}>按完整结算单位</option></select></label><label>结算单位（小时）<input class="input" type="number" name="settlementUnit" min="0.5" max="24" step="0.5" value="${facts.settlementUnit}"></label><label>不足单位处理<select class="select" name="partialUnitRule"><option value="discard" ${facts.partialUnitRule!=='proportional'?'selected':''}>不足不计</option><option value="proportional" ${facts.partialUnitRule==='proportional'?'selected':''}>按实际时长折算</option></select></label><label>额外补贴规则<select class="select" name="bonusMode"><option value="none" ${facts.bonusMode==='none'?'selected':''}>无</option><option value="threshold" ${facts.bonusMode==='threshold'?'selected':''}>达标一次性补贴</option><option value="tiers" ${facts.bonusMode==='tiers'?'selected':''}>多档补贴</option></select></label><label>一次性门槛（小时）<input class="input" type="number" name="bonusThresholdHours" min="0" step="0.5" value="${facts.bonusThresholdHours}"></label><label>一次性补贴金额<input class="input" type="number" name="bonusThresholdAmount" min="0" step="0.01" value="${facts.bonusThresholdAmount}"></label></div><div class="overtime-expense-list" data-overtime-tiers>${(facts.bonusTiers||[]).map(overtimeBonusTierRow).join('')||'<p class="subtle overtime-tier-empty">多档补贴尚未添加。</p>'}</div></div></details>
      <details class="overtime-advanced-settings" open><summary><span>高级经济估算与计算范围 ${overtimeHelpButton('restValuePerHour')}</span><small>重要 · 当前 ${laborMoney(facts.restValuePerHour)}/h · 范围 ${laborNumber(facts.maxHours,2)}h</small></summary><p class="overtime-advanced-intro">这里不是工资规则，而是你的个人决策假设。自由时间价值越高，继续加班的综合净价值越低；最大分析时长决定图表分析到哪里。</p><div class="labor-form-grid"><label>自由时间价值（元/小时）<input class="input" type="number" name="restValuePerHour" min="0" step="0.01" value="${facts.restValuePerHour}"></label><label>疲劳成本估算系数 k<input class="input" type="number" name="fatigueCoefficient" min="0" step="0.01" value="${facts.fatigueCoefficient}"></label><label>最大分析时长（小时）<input class="input" type="number" name="maxHours" min="0.5" max="744" step="0.5" value="${facts.maxHours}"></label></div><p class="field-hint">疲劳成本系数仅为旧版综合净价值的经济估算假设；0～100 的疲劳自评不会换算为人民币。结果不代表医学或劳动法结论。</p></details>
      <section class="overtime-inspection-control"><div><b>查看曲线节点</b><p>拖动或输入时长即可逐点查看；仍可直接点击图线节点。这里只改变查看点，不会修改计划加班时长。</p></div>${pairedRangeNumber({name:'inspectionHours',label:'查看时长',value:inspectionHours,min:0,max:Number(analysis.input.maxHours||12),step:.5})}</section>
      <div id="labor-overtime-preview">${overtimeAnalysisHtml(analysis,statusRecords)}</div><div class="overtime-save-row"><label>决策日期<input class="input" type="date" name="date" required value="${esc(facts.date)}"></label><label>备注<textarea class="textarea" name="note">${esc(facts.note||'')}</textarea></label><div class="overtime-save-actions"><button class="btn" type="button" data-print-overtime>打印 / 保存 PDF</button><button class="btn primary" type="submit">${state.laborEditingOvertimeId?'更新决策记录':'保存本次决策'}</button></div></div></form>${overtimeStatusSection(facts,analysis,statusRecords)}
    <div class="labor-history-heading"><div><span class="eyebrow">SAVED HISTORY</span><h5>已保存的加班价值记录</h5></div><p>上方为未保存试算；只有点击保存后才会进入这里。</p></div><div class="labor-history-grid">${decisions.length?decisions.map((item)=>`<article class="card labor-history-card"><span>${esc(item.facts.date)}</span><h5>${item.facts.scenario==='rest-day'?'休息日加班':'工作日加班'} · ${laborNumber(item.snapshot?.selected?.hours)}h</h5><p>现金 ${laborMoney(item.snapshot?.selected?.cashNetValue)}${item.snapshot?.selected?.overtimePremium!=null?` · 溢价 ${laborMoney(item.snapshot.selected.overtimePremium)}`:''} · 综合 ${laborMoney(item.snapshot?.selected?.comprehensiveValue)}</p><div class="row-actions"><button class="btn small" data-view-overtime="${esc(item.id)}">查看详情</button><button class="btn small" data-edit-overtime="${esc(item.id)}">编辑试算</button><button class="btn small danger" data-delete-labor="overtimeDecisions:${esc(item.id)}">删除</button></div></article>`).join(''):empty('还没有加班决策','调整参数查看曲线，确认后保存当时的判断。')}</div></section>`;
}

function laborForecastInput() {
  const latest=laborLatest('livingRecords','month')?.snapshot||{};const params=laborParams();
  return {startSavings:params.forecastStartSavings??latest.availableSavings??0,monthlyIncome:params.forecastMonthlyIncome??latest.actualIncome??laborLatest('salaryRecords','periodStart')?.snapshot?.totalSalary??0,monthlySpending:params.forecastMonthlySpending??latest.totalSpending??0,necessaryLiving:params.forecastNecessaryLiving??latest.necessaryLiving??0,safetyMonths:params.safetyMonths,months:params.forecastMonths,annualIncomeGrowth:params.annualIncomeGrowth,annualSpendingGrowth:params.annualSpendingGrowth};
}

function forecastHtml(value) {
  const result=forecastSavings(value);return `${laborChart([{label:'储蓄预测',color:'#245fa8',points:result.points.map((point)=>({label:`${point.month}月`,value:point.savings}))},{label:'安全线',color:'#e7654f',points:result.points.map((point)=>({label:`${point.month}月`,value:point.safetyLine}))}],{valueFormatter:laborMoney})}<p class="labor-forecast-note">${result.belowSafetyMonth==null?'预测期内未跌破安全线。':`预计第 ${result.belowSafetyMonth} 个月跌破安全线。`} ${result.exhaustedMonth==null?'预测期内未耗尽。':`预计第 ${result.exhaustedMonth} 个月储蓄耗尽。`} 这是基于可调假设的预测，不是确定事实。</p>`;
}

function laborLivingSection() {
  const records=laborSort(state.data.livingRecords,'month');const chartRecords=laborRangeRecords(records);const forecastInput=laborForecastInput();
  return `<section class="labor-section"><div class="labor-section-head"><div><h4>生活成本与财务可持续性</h4><p>普通生活与工作增量支出分列，避免同一笔费用重复计算。</p></div><button class="btn primary" data-open="new-living">＋ 新增月度记录</button></div>
    <div class="card labor-chart-card"><b>收入、支出、结余与储蓄余额</b>${laborChart([{label:'收入',color:'#245fa8',store:'livingRecords',points:chartRecords.map((item)=>({label:item.facts.month,value:item.snapshot?.actualIncome,id:item.id,store:'livingRecords'}))},{label:'总支出',color:'#e7654f',points:chartRecords.map((item)=>({label:item.facts.month,value:item.snapshot?.totalSpending}))},{label:'结余',color:'#237a5a',points:chartRecords.map((item)=>({label:item.facts.month,value:item.snapshot?.monthlyBalance}))},{label:'储蓄余额',color:'#7b61a8',points:chartRecords.map((item)=>({label:item.facts.month,value:item.snapshot?.availableSavings}))}],{valueFormatter:laborMoney})}</div>
    <form class="card labor-forecast-form" id="labor-forecast-form"><div class="labor-chart-toolbar"><div><b>未来储蓄预测</b><p>实际历史不会被预测数据覆盖。</p></div><button class="btn" type="submit">保存预测参数</button></div><div class="labor-form-grid">${[['startSavings','当前储蓄'],['monthlyIncome','预测月收入'],['monthlySpending','预测月支出'],['necessaryLiving','必要生活费'],['safetyMonths','安全线（月）'],['months','预测月数'],['annualIncomeGrowth','收入年增长率 %'],['annualSpendingGrowth','支出年增长率 %']].map(([name,label])=>`<label>${label}<input class="input" type="number" name="${name}" ${['annualIncomeGrowth','annualSpendingGrowth'].includes(name)?'min="-99.99"':'min="0"'} step="0.01" value="${forecastInput[name]}"></label>`).join('')}</div><div id="labor-forecast-preview">${forecastHtml(forecastInput)}</div></form>
    <div class="card labor-table">${records.length?`<table><thead><tr><th>月份</th><th>收入</th><th>必要生活</th><th>工作增量</th><th>总支出</th><th>结余</th><th>储蓄覆盖</th><th></th></tr></thead><tbody>${records.slice().reverse().map((item)=>`<tr><td>${esc(item.facts.month)}</td><td>${laborMoney(item.snapshot?.actualIncome)}</td><td>${laborMoney(item.snapshot?.necessaryLiving)}</td><td>${laborMoney(item.snapshot?.workRelated)}</td><td>${laborMoney(item.snapshot?.totalSpending)}</td><td>${laborMoney(item.snapshot?.monthlyBalance)}</td><td>${laborNumber(item.snapshot?.savingsCoverageMonths)} 月</td><td class="row-actions"><button class="btn small" data-edit-living="${esc(item.id)}">编辑</button><button class="btn small danger" data-delete-labor="livingRecords:${esc(item.id)}">删除</button></td></tr>`).join('')}</tbody></table>`:empty('还没有生活记录','保存月度生活成本后显示收支和储蓄趋势。')}</div></section>`;
}

function jobFormFacts() {
  const editing=state.data.jobComparisons?.find((item)=>item.id===state.laborEditingJobId);return {date:localDateKey(),name:'候选工作',candidateBasis:'after-tax',candidateSalary:0,candidateAfterTaxEstimate:0,candidateDays:21.75,candidateDailyHours:8,candidateOvertimeHours:0,candidateCommuteDaily:0,candidateTransport:0,candidateLivingDelta:0,candidateOtherCost:0,note:'',...(editing?.facts||{})};
}

function laborCurrentJobInput(candidateFacts = {}) {
  const salary=laborLatest('salaryRecords','periodStart');const living=laborLatest('livingRecords','month');const params=laborParams();
  return {...candidateFacts,currentIncome:salary?.snapshot?.totalSalary||0,currentWorkHours:salary?.snapshot?.totalWorkHours||0,currentDays:Number(salary?.facts?.normalDays||0),currentCommuteDaily:Number(params.currentCommuteDaily||0),currentSpending:living?.snapshot?.totalSpending||0,currentWorkRelated:living?.snapshot?.workRelated||0};
}

function jobComparisonHtml(result, hasCandidate = true) {
  if(!hasCandidate)return '<div class="labor-chart-empty">填写候选工资后显示工作对比结果。</div>';
  if(!result.comparable)return `<div class="warning"><b>暂不能直接比较：</b>${esc(result.reason)}</div>`;
  return `<div class="labor-live-summary"><div><span>到手收入差额</span><b>${laborMoney(result.incomeDifference)}</b></div><div><span>月结余差额</span><b>${laborMoney(result.balanceDifference)}</b></div><div><span>占用时间差额</span><b>${laborNumber(result.occupiedHoursDifference)}h</b></div><div><span>每小时可支配差额</span><b>${laborMoney(result.disposableHourlyDifference)}</b></div></div><p class="field-hint">每小时可支配收入 = 扣除月度支出后的结余 ÷ 工作与通勤占用时间。结果依赖输入假设。</p>`;
}

function laborCareerSection() {
  const params=laborParams(),latestLiving=laborLatest('livingRecords','month')?.snapshot||{},latestSalary=laborLatest('salaryRecords','periodStart')?.snapshot||{};
  const targets=salaryTargets({necessaryLiving:latestLiving.necessaryLiving||0,targetSavings:params.targetMonthlySavings,bufferRatio:params.bufferRatio});const facts=jobFormFacts();const comparison=compareJobs(laborCurrentJobInput(facts));const records=laborSort(state.data.jobComparisons,'date').reverse();const signals=decisionSignals({salaryRecords:state.data.salaryRecords,livingRecords:state.data.livingRecords,targets,comparison:records[0]?.snapshot||null});
  const salaryRecords=laborRangeRecords(laborSort(state.data.salaryRecords,'periodStart'));
  const livingRecords=laborRangeRecords(laborSort(state.data.livingRecords,'month'));
  const hasCandidate=Boolean(Number(facts.candidateSalary)||Number(facts.candidateAfterTaxEstimate));
  return `<section class="labor-section"><div class="labor-section-head"><div><h4>职业选择与目标薪资</h4><p>三条薪资线均为税后到手口径，不直接等同于招聘岗位税前工资。</p></div></div>
    <div class="labor-target-grid"><article><span>生存线</span><b>${laborMoney(targets.survival)}</b><small>必要生活支出</small></article><article><span>稳定线</span><b>${laborMoney(targets.stable)}</b><small>生活 + 目标储蓄</small></article><article><span>目标线</span><b>${laborMoney(targets.target)}</b><small>稳定线 + 缓冲</small></article></div>
    <form class="card labor-parameter-form" id="labor-parameters-form"><div class="labor-chart-toolbar"><b>个人计算参数</b><button class="btn" type="submit">保存参数</button></div><div class="labor-form-grid"><label>安全储蓄线（月）<input class="input" name="safetyMonths" type="number" min="0" step="0.5" value="${params.safetyMonths}"></label><label>目标月储蓄<input class="input" name="targetMonthlySavings" type="number" min="0" step="0.01" value="${params.targetMonthlySavings}"></label><label>目标缓冲比例<input class="input" name="bufferRatio" type="number" min="0" max="10" step="0.01" value="${params.bufferRatio}"></label><label>当前日均通勤（小时）<input class="input" name="currentCommuteDaily" type="number" min="0" max="24" step="0.25" value="${params.currentCommuteDaily}"></label></div></form>
    <div class="card labor-chart-card"><b>当前收入与目标区间</b>${laborChart([{label:'当前到手收入',color:'#245fa8',store:'salaryRecords',points:salaryRecords.map((item)=>({label:laborDateLabel(item.facts),value:item.snapshot?.totalSalary,id:item.id}))},{label:'生存线',color:'#a86100',points:salaryRecords.map((item)=>({label:laborDateLabel(item.facts),value:targets.survival}))},{label:'稳定线',color:'#237a5a',points:salaryRecords.map((item)=>({label:laborDateLabel(item.facts),value:targets.stable}))},{label:'目标线',color:'#e7654f',points:salaryRecords.map((item)=>({label:laborDateLabel(item.facts),value:targets.target}))}],{valueFormatter:laborMoney})}</div>
    <div class="labor-split-charts"><div class="card labor-chart-card"><b>历史实际时薪</b>${laborChart([{label:'平均实际时薪',color:'#245fa8',store:'salaryRecords',points:salaryRecords.map((item)=>({label:laborDateLabel(item.facts),value:item.snapshot?.averageHourlyRate,id:item.id}))}],{height:220,valueFormatter:laborMoney})}</div><div class="card labor-chart-card"><b>必要生活成本</b>${laborChart([{label:'必要生活费',color:'#e7654f',store:'livingRecords',points:livingRecords.map((item)=>({label:item.facts.month,value:item.snapshot?.necessaryLiving,id:item.id}))}],{height:220,valueFormatter:laborMoney})}</div></div>
    <div class="labor-signal-list">${signals.length?signals.map((item)=>`<div class="labor-signal ${item.level}">${esc(item.text)}</div>`):'<div class="labor-signal ready">当前数据尚未触发趋势提示；记录更多月份后判断会更可靠。</div>'}</div>
    <form class="card labor-job-form" id="labor-job-form"><div class="labor-chart-toolbar"><div><b>${state.laborEditingJobId?'编辑候选工作':'比较候选工作'}</b><p>当前工作自动取最近工资与生活记录。</p></div>${state.laborEditingJobId?'<button class="btn" type="button" data-cancel-job-edit>取消编辑</button>':''}</div><div class="labor-form-grid">
      <label>比较日期<input class="input" type="date" name="date" required value="${esc(facts.date)}"></label><label>候选工作名称<input class="input" name="name" maxlength="100" required value="${esc(facts.name)}"></label><label>工资口径<select class="select" name="candidateBasis"><option value="after-tax" ${facts.candidateBasis==='after-tax'?'selected':''}>税后到手</option><option value="before-tax" ${facts.candidateBasis==='before-tax'?'selected':''}>税前</option></select></label><label>标示月薪<input class="input" type="number" name="candidateSalary" min="0" step="0.01" value="${facts.candidateSalary}"></label><label>税后估算（税前时必填）<input class="input" type="number" name="candidateAfterTaxEstimate" min="0" step="0.01" value="${facts.candidateAfterTaxEstimate}"></label><label>月工作天数<input class="input" type="number" name="candidateDays" min="0" max="366" step="0.25" value="${facts.candidateDays}"></label><label>每天工作小时<input class="input" type="number" name="candidateDailyHours" min="0" max="24" step="0.25" value="${facts.candidateDailyHours}"></label><label>月预计加班小时<input class="input" type="number" name="candidateOvertimeHours" min="0" step="0.25" value="${facts.candidateOvertimeHours}"></label><label>日均通勤小时<input class="input" type="number" name="candidateCommuteDaily" min="0" max="24" step="0.25" value="${facts.candidateCommuteDaily}"></label><label>月交通费<input class="input" type="number" name="candidateTransport" min="0" step="0.01" value="${facts.candidateTransport}"></label><label>生活成本变化<input class="input" type="number" name="candidateLivingDelta" step="0.01" value="${facts.candidateLivingDelta}"></label><label>其他必要支出变化<input class="input" type="number" name="candidateOtherCost" step="0.01" value="${facts.candidateOtherCost}"></label></div><div id="labor-job-preview">${jobComparisonHtml(comparison,hasCandidate)}</div><label>备注<textarea class="textarea" name="note">${esc(facts.note||'')}</textarea></label><button class="btn primary" type="submit">${state.laborEditingJobId?'更新比较记录':'保存比较记录'}</button></form>
    <div class="labor-history-grid">${records.length?records.map((item)=>`<article class="card labor-history-card"><span>${esc(item.facts.date)} · ${item.facts.candidateBasis==='before-tax'?'税前输入':'税后输入'}</span><h5>${esc(item.facts.name)}</h5><p>${item.snapshot?.comparable?`结余差额 ${laborMoney(item.snapshot.balanceDifference)} · 时间差 ${laborNumber(item.snapshot.occupiedHoursDifference)}h`:`无法直接比较：${esc(item.snapshot?.reason||'口径不一致')}`}</p><div class="row-actions"><button class="btn small" data-edit-job="${esc(item.id)}">编辑</button><button class="btn small danger" data-delete-labor="jobComparisons:${esc(item.id)}">删除</button></div></article>`).join(''):empty('还没有工作比较','填写候选条件并保存，之后可以回看当时的假设与结果。')}</div></section>`;
}

function laborLifePage() {
  const latestSalary=laborLatest('salaryRecords','periodStart')?.snapshot||{};const latestLiving=laborLatest('livingRecords','month')?.snapshot||{};
  const tabs=[['salary','工资与工时'],['overtime','加班价值'],['living','生活与储蓄'],['career','职业与目标']];
  const content=state.laborTab==='overtime'?laborOvertimeSection():state.laborTab==='living'?laborLivingSection():state.laborTab==='career'?laborCareerSection():laborSalarySection();
  return shell(`<section class="page work-page labor-page"><div class="page-head"><div><span class="eyebrow">MARGINAL VALUE</span><h3>边际价值</h3><p>每一份额外付出，究竟值得多少？记录事实、解释计算、观察长期变化。</p></div></div>
    <div class="labor-kpis"><article><span>最近到手收入</span><b>${laborMoney(latestSalary.totalSalary)}</b><small>${laborLatest('salaryRecords','periodStart')?esc(laborDateLabel(laborLatest('salaryRecords','periodStart').facts)):'暂无记录'}</small></article><article><span>平均实际时薪</span><b>${laborMoney(latestSalary.averageHourlyRate)}</b><small>${Number.isFinite(latestSalary.totalWorkHours)?`${laborNumber(latestSalary.totalWorkHours)} 小时劳动`:'等待工资记录'}</small></article><article><span>最近月度结余</span><b>${laborMoney(latestLiving.monthlyBalance)}</b><small>${Number.isFinite(latestLiving.savingsRate)?`结余率 ${laborPercent(latestLiving.savingsRate)}`:'等待生活记录'}</small></article><article><span>储蓄覆盖</span><b>${Number.isFinite(latestLiving.savingsCoverageMonths)?`${laborNumber(latestLiving.savingsCoverageMonths)} 月`:'—'}</b><small>按必要生活费估算</small></article></div>
    <div class="labor-tabs-row"><div class="segment-control labor-tabs">${tabs.map(([key,label])=>`<button class="${state.laborTab===key?'active':''}" data-labor-tab="${key}">${label}</button>`).join('')}</div><label class="labor-history-range">图表范围<select class="select compact" id="labor-history-range"><option value="all" ${state.laborRange==='all'?'selected':''}>全部记录</option><option value="6" ${state.laborRange==='6'?'selected':''}>最近 6 期</option><option value="12" ${state.laborRange==='12'?'selected':''}>最近 12 期</option></select></label></div>${content}</section>`,'边际价值','每一份额外付出，究竟值得多少？');
}

function taskList() {
  const tasks = [...state.data.tasks]
    .filter((t) => !state.search || `${t.title} ${t.requirement} ${t.ownerName || ''}`.toLowerCase().includes(state.search.toLowerCase()))
    .filter((t) => state.status === 'All' || t.status === state.status)
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = Object.fromEntries(STATUS.map((s) => [s, state.data.tasks.filter((t) => t.status === s).length]));
  const total = Math.max(state.data.tasks.length, 1);
  return shell(`<section class="page work-page tasks-page">
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
  return shell(`<section class="page work-page task-detail-page">
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

function classificationItems(kind) { return state.classifications?.[kind] || (kind === 'contentTypes' ? DEFAULT_CONTENT_TYPES : DEFAULT_CATEGORIES); }
function classificationLabel(kind, id, fallback = '') { return classificationItems(kind).find((item) => item.id === id)?.label || fallback || id; }
function noteCategoryId(note) { return normalizeNote(note).categoryId || 'personal'; }
function noteCategory(note) { const normalized=normalizeNote(note); return classificationLabel('categories', normalized.categoryId, normalized.categoryLabel || normalized.category || 'Personal'); }
function noteTypeLabel(note) { const normalized=normalizeNote(note); return classificationLabel('contentTypes', normalized.contentType, normalized.contentTypeLabel || contentTypeLabel(normalized.contentType)); }

function categoryOptions(selected = 'personal', omit = '') {
  return classificationItems('categories').filter((category) => category.id !== omit).map((category) => `<option value="${esc(category.id)}" ${category.id === selected ? 'selected' : ''}>${esc(category.label)}</option>`).join('');
}

function contentTypeOptions(selected = 'note', omit = '') {
  return classificationItems('contentTypes').filter((type) => type.id !== omit).map((type) => `<option value="${esc(type.id)}" ${type.id === selected ? 'selected' : ''}>${esc(type.label)}</option>`).join('');
}

function noteListItem(note) {
  note = normalizeNote(note);
  const title = note.title?.trim() || note.content?.trim().split(/\n/)[0]?.slice(0, 42) || '未命名记录';
  return `<button class="note-list-item ${state.noteId === note.id ? 'active' : ''}" data-select-note="${esc(note.id)}"><span class="note-list-title">${note.pinned?'📌 ':''}${esc(title)}</span><span class="note-list-meta"><b>${esc(noteTypeLabel(note))}</b>${esc(noteCategory(note))} · ${dateText(note.updatedAt)}</span><span class="note-list-preview">${esc(note.purpose || note.content || '暂无正文')}</span></button>`;
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
    categoryId:String(data.get('category') || 'personal'),
    category:classificationLabel('categories', String(data.get('category') || 'personal'), 'Personal'),
    categoryLabel:classificationLabel('categories', String(data.get('category') || 'personal'), 'Personal'),
    contentType:String(data.get('contentType') || 'note'),
    contentTypeId:String(data.get('contentType') || 'note'),
    contentTypeLabel:classificationLabel('contentTypes', String(data.get('contentType') || 'note'), '笔记'),
    purpose:String(data.get('purpose') || ''),
    sourceUrl:String(data.get('sourceUrl') || ''),
    pinned:data.get('pinned') === 'on',
    createdAt:state.noteDraft?.createdAt || now(),
    updatedAt:now(),
    revision:Math.max(Number(state.noteDraftRevision || 0), Number(state.noteDraft?.revision || 0)) + 1,
    dirty:!original || String(data.get('title')||'') !== String(original.title||'') || String(data.get('content')||'') !== String(original.content||'') || String(data.get('category')||'') !== String(noteCategoryId(original)) || String(data.get('contentType')||'note') !== String(normalizeNote(original||{}).contentType) || String(data.get('purpose')||'') !== String(original?.purpose||'') || String(data.get('sourceUrl')||'') !== String(original?.sourceUrl||'') || (data.get('pinned')==='on') !== Boolean(original?.pinned)
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

async function startNewNote(initial = {}) {
  if (state.route === 'notes') await flushNoteDraft();
  const noteId = `new:${crypto.randomUUID()}`;
  const timestamp = now();
  const categoryId=state.selectedCategory==='All'?'personal':state.selectedCategory;
  const draft = {source:state.notesMode,noteId,title:'',content:'',categoryId,category:classificationLabel('categories',categoryId,'Personal'),categoryLabel:classificationLabel('categories',categoryId,'Personal'),contentType:initial.contentType||'note',contentTypeId:initial.contentType||'note',contentTypeLabel:classificationLabel('contentTypes',initial.contentType||'note','笔记'),purpose:'',sourceUrl:'',pinned:false,createdAt:timestamp,updatedAt:timestamp,revision:1,dirty:false};
  state.noteId=noteId; state.noteDraft=draft; state.noteDraftRevision=1;
  state.noteDraftRestored=false;
  await notesDrafts.save(draft);
  state.route='notes';
  persistNotesUi(true);
  render();
}

function noteEditor(note) {
  const isNew = !note || String(note.id).startsWith('new:');
  const draft = normalizeNote(draftFor(note.id) || note || {});
  const dirty = Boolean(draft.dirty);
  return `<form class="note-workspace-editor" id="note-editor-form" data-note-id="${esc(note.id)}" data-dirty="${dirty}">
    <div class="note-editor-toolbar"><span>${isNew ? '新记录' : `更新于 ${dateText(note.updatedAt)}`}</span>${isNew ? '' : `<button type="button" class="btn small danger" data-delete-note="${esc(note.id)}">删除</button>`}</div>
    <input class="note-title-input" name="title" maxlength="160" placeholder="标题（可空）" value="${esc(draft.title || '')}">
    <textarea class="note-body-input" name="content" placeholder="${draft.contentType==='prompt'?'输入完整提示词…':'记下此刻的想法…'}" autofocus>${esc(draft.content || '')}</textarea>
    <input type="hidden" name="purpose" value="${esc(draft.purpose)}"><input type="hidden" name="sourceUrl" value="${esc(draft.sourceUrl)}"><input type="hidden" name="pinned" value="${draft.pinned?'on':''}">
    <footer class="note-editor-footer"><div class="note-footer-properties"><label><span>类型</span><select class="select" name="contentType">${contentTypeOptions(draft.contentType)}</select></label><label><span>主题</span><select class="select" name="category">${categoryOptions(draft.categoryId || 'personal')}</select></label></div><span class="save-status subtle" id="note-draft-status">${state.noteDraftRestored ? '已恢复本地草稿' : '没有未保存的修改'}</span><div class="note-save-actions"><button class="btn primary" type="submit" ${dirty && !state.noteSaving ? '' : 'disabled'}>${state.noteSaving?'正在保存…':'保存 Note'}</button></div></footer>
  </form>`;
}

function notesPage() {
  const q = state.search.toLowerCase();
  const notes = [...state.notes]
    .filter((n) => state.selectedCategory === 'All' || noteCategoryId(n) === state.selectedCategory)
    .filter((n) => !q || `${n.title || ''} ${n.content || ''} ${noteCategory(n)}`.toLowerCase().includes(q))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  // IndexedDB draft records have their own storage key in `id`; the editor
  // must keep using the logical noteId or a restored new draft is mistaken for
  // an existing note and its draft cannot be cleared after a formal save.
  let selected = String(state.noteId||'').startsWith('new:') ? { ...state.noteDraft, id:state.noteId } : state.notes.find((n) => n.id === state.noteId) || (state.noteDraft ? {...state.noteDraft,id:state.noteId} : null);
  if (!selected && notes.length) { selected = notes[0]; state.noteId = selected.id; }
  const unavailable = state.notesError ? `<div class="warning"><b>${esc(state.notesMode)} 当前不可用：</b>${esc(state.notesError)}</div>` : '';
  const sidebarCollapsed=state.contentSidebarCollapsed.notes;
  return shell(`<section class="page work-page notes-page"><div class="page-head"><div><span class="eyebrow">QUICK CAPTURE</span><h3>随手记下，再慢慢整理</h3><p>快速记录，按分类查看；标题可以留空。</p></div><button class="btn primary" data-new-note ${state.notesError ? 'disabled' : ''}>＋ 新建笔记</button></div>${unavailable}
    <div class="notes-workspace card content-sidebar-layout ${sidebarCollapsed?'content-sidebar-collapsed':''}"><aside class="notes-list-pane module-content-sidebar"><header class="content-sidebar-head"><b>笔记列表</b>${contentSidebarToggle('notes','笔记列表')}</header><div class="notes-list-tools"><div class="search"><span>⌕</span><label class="sr-only" for="note-search">搜索记录</label><input id="note-search" class="input" type="search" placeholder="搜索记录" value="${esc(state.search)}"></div><select id="note-category-filter" class="select" aria-label="分类筛选"><option value="All">全部分类</option>${categoryOptions(state.selectedCategory)}</select></div><div class="notes-list">${notes.length ? notes.map(noteListItem).join('') : `<div class="empty compact"><b>暂无记录</b><p>新建一条简单记录。</p></div>`}</div></aside>${sidebarCollapsed?contentSidebarToggle('notes','笔记列表'):''}<section class="note-editor-pane">${selected ? noteEditor(selected) : empty('选择或新建 Note','编辑区会在这里打开。')}</section></div>
  </section>`, '随手笔记', `${state.notes.length} 条记录 · ${state.notesMode}`);
}

function categoriesPage() {
  const keywords = tokenize(state.categorySearch);
  const results = searchNotes(state.notes, { query:state.categorySearch, contentType:state.categoryType, category:state.selectedCategory });
  const expanded = results.find((note) => note.id === state.categoryExpandedId);
  const unavailable = state.notesError ? `<div class="warning"><b>${esc(state.notesMode)} 当前不可用：</b>${esc(state.notesError)}</div>` : '';
  const resultList = results.length ? results.map((rawNote) => {
    const note = normalizeNote(rawNote);
    const open = note.id === expanded?.id;
    const title = note.title?.trim() || note.content?.trim().split(/\n/)[0]?.slice(0, 64) || '未命名记录';
    const summary = contentSummary(note);
    return `<article class="library-result ${open?'expanded':''}">
      <button class="library-result-summary" data-expand-content="${esc(note.id)}" aria-expanded="${open}">
        <span class="library-result-main"><b>${note.pinned?'<span class="pin-mark" aria-label="已置顶">●</span> ':''}${highlightHtml(title, keywords)}</b><span>${highlightHtml(summary, keywords)}</span></span>
        <span class="library-result-meta"><em>${esc(noteTypeLabel(note))}</em><span>${esc(noteCategory(note))}</span><time>${dateText(note.updatedAt)}</time><i aria-hidden="true">${open?'−':'＋'}</i></span>
      </button>
      ${open ? `<div class="library-detail"><div class="library-detail-head"><div><span class="category-chip">${esc(noteTypeLabel(note))}</span><span class="category-chip quiet">${esc(noteCategory(note))}</span></div><div class="library-actions"><button class="btn small" data-copy-content="${esc(note.id)}">复制正文</button><button class="btn small primary" data-edit-content="${esc(note.id)}">编辑内容</button>${note.sourceUrl?`<a class="btn small" href="${esc(note.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a>`:''}</div></div>${note.purpose?`<div class="library-purpose"><b>用途说明</b><p>${highlightHtml(note.purpose, keywords)}</p></div>`:''}<div class="library-full-text">${highlightHtml(note.content || '暂无正文', keywords)}</div></div>` : ''}
    </article>`;
  }).join('') : empty('没有匹配内容','尝试减少关键词，或切换内容类型与主题分类。');
  return shell(`<section class="page work-page library-page"><div class="page-head"><div><span class="eyebrow">CONTENT LIBRARY</span><h3>整理、检索和调用已保存内容</h3><p>提示词与笔记共用同一份数据；内容类型和主题分类可以组合筛选。</p></div><button class="btn primary" data-new-prompt ${state.notesError?'disabled':''}>＋ 新建提示词</button></div>${unavailable}
    <section class="card library-controls" aria-label="内容检索">
      <div class="library-search-row"><div class="search library-search"><span>⌕</span><label class="sr-only" for="category-search">搜索内容</label><input id="category-search" class="input" type="search" placeholder="输入多个关键词，空格分隔（任一命中）" value="${esc(state.categorySearch)}"></div>${state.categorySearch?'<button class="btn small" data-clear-category-search>清空</button>':''}</div>
      <div class="library-filter-row"><b>快捷搜索</b><div class="quick-tags">${state.categoryQuickTags.map((tag)=>`<span class="quick-tag"><button data-quick-tag="${esc(tag)}">${esc(tag)}</button><button data-remove-quick-tag="${esc(tag)}" aria-label="删除快捷标签 ${esc(tag)}">×</button></span>`).join('')}${state.categoryTagEditor?'<span class="quick-tag-editor"><input class="input" id="quick-tag-input" maxlength="40" placeholder="搜索词"><button class="btn small primary" data-save-quick-tag>保存</button><button class="btn small" data-cancel-quick-tag>取消</button></span>':'<button class="quick-tag-add" data-add-quick-tag>＋ 自定义</button>'}</div></div>
      <div class="library-filter-row"><b>内容类型</b><div class="filter-chips"><button class="filter-chip ${state.categoryType==='All'?'active':''}" data-content-type="All">全部</button>${classificationItems('contentTypes').map((type)=>`<button class="filter-chip ${state.categoryType===type.id?'active':''}" data-content-type="${esc(type.id)}">${esc(type.label)}</button>`).join('')}</div></div>
      <div class="library-filter-row"><b>主题分类</b><div class="filter-chips"><button class="filter-chip ${state.selectedCategory==='All'?'active':''}" data-category="All">全部</button>${classificationItems('categories').map((category)=>`<button class="filter-chip ${state.selectedCategory===category.id?'active':''}" data-category="${esc(category.id)}">${esc(category.label)}</button>`).join('')}</div></div>
    </section>
    <section class="library-results"><div class="section-title"><div><h4>搜索结果</h4><p>${results.length} 条 · ${esc(state.notesMode)} 数据源${keywords.length?` · ${keywords.length} 个关键词`:''}</p></div></div><div class="library-result-list">${resultList}</div></section>
  </section>`, '内容分类', `${results.length} 条匹配 · ${state.notesMode}`);
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
  const sidebarCollapsed=state.contentSidebarCollapsed.radar;
  return shell(`<section class="page work-page radar-page"><div class="radar-workspace content-sidebar-layout ${sidebarCollapsed?'content-sidebar-collapsed':''}">
    <aside class="radar-direction-sidebar card module-content-sidebar"><header class="content-sidebar-head"><b>探索方向</b>${contentSidebarToggle('radar','探索方向')}</header><div class="radar-direction-list">${state.radarProfiles.map((item)=>`<button class="${item.id===profile?.id?'active':''}" data-select-radar-profile="${esc(item.id)}"><b>${esc(item.name)}</b><small>${item.coreDomains?.length||0} 核心 · ${item.adjacentDomains?.length||0} 相邻</small></button>`).join('')}</div><div class="radar-sidebar-actions"><button class="btn small" data-open="new-radar-profile">＋ 新建方向</button><button class="btn small" data-open="edit-radar-profile">编辑当前</button>${profile?.isDefault?'':`<button class="btn small danger" data-delete-radar-profile="${esc(profile?.id)}">删除当前</button>`}</div></aside>${sidebarCollapsed?contentSidebarToggle('radar','探索方向'):''}<div class="radar-main-workspace">
    <div class="radar-profile-bar card"><div><span class="eyebrow">CURRENT DIRECTION</span><h4>${esc(profile?.name||'未选择')}</h4></div><div class="radar-profile-actions"><button class="btn small" data-open-radar-history>历史 ${history.length}</button><button class="btn small primary" data-explore-new ${state.radarSearching?'disabled aria-busy="true"':''}>${state.radarSearching?'正在搜索…':'开始新探索'}</button></div></div>
    <div class="radar-profile-scope"><div><b>核心领域</b>${(profile?.coreDomains||[]).map((domain)=>`<span>${esc(domain)}</span>`).join('') || '<em>未设置</em>'}</div><div><b>相邻领域</b>${(profile?.adjacentDomains||[]).map((domain)=>`<span>${esc(domain)}</span>`).join('') || '<em>未设置</em>'}</div><details class="radar-scope-details"><summary>查看方向说明</summary><p>Unknown Window 保持开放。每个探索方向独立保留当前批次和历史，切换后可随时回来继续查看。修改方向不会清除当前批次；仅下一次探索使用新配置。</p></details></div>
    <div class="page-head radar-feed-head"><div><span class="eyebrow">DISCOVERY FEED</span><h3>本次探索</h3></div></div>
    <div class="radar-demo-notice ${shortageParts.length || batch?.exhausted ? 'warning' : ''}"><b>${isRemoteBatch ? 'Live Provider' : onlineReady ? 'Ready' : 'Demo Provider'}</b><span>${esc(limitation)}</span></div>
    <div class="radar-batch-meta"><span>探索批次 ${Number(batch?.sequence || 1)}</span><span>生成于 ${dateText(batch?.createdAt || now())}</span><span>共 ${items.length} 条</span><span>今日联网探索 ${dailyUsed} / ${dailyLimit}</span>${batch?.searchUsage ? `<span>Tavily ${Number(batch.searchUsage.tavilyCredits||0)} credits · 缓存 ${Number(batch.searchUsage.cacheHits||0)} 次 · DeepSeek Search ${Number(batch.searchUsage.deepseekSearchRequests||0)} 次${batch.searchUsage.accounting==='reserved'?'（Tavily 为保守预留）':''}</span>`:''}</div>
    ${sections.map((section) => { const sectionItems=items.filter((item) => item.section === section); return `<section class="radar-section"><div class="section-title"><h4>${section}</h4><span>${sectionItems.length} / ${QUOTAS[section]}</span></div>${sectionItems.length?`<div class="radar-grid">${sectionItems.map(radarCard).join('')}</div>`:`<div class="radar-empty">暂无匹配的演示内容</div>`}</section>`; }).join('')}
  </div></div></section>`, '探索雷达', `${state.radarProfiles.length} 个探索方向 · 当前为 ${profile?.name || '未选择'}`);
}

function teamSettings() {
  const members = [...state.data.team].sort((a,b) => a.name.localeCompare(b.name));
  return `<article class="card setting-card"><div class="page-head" style="margin-bottom:10px"><div><h4>Team</h4><p>用于任务负责人和交接选择。</p></div><button class="btn small" data-open="new-member">＋ 添加成员</button></div>
    ${members.length ? `<table><thead><tr><th>姓名</th><th>邮箱</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="subtle">${esc(m.email)}</td><td><button class="btn small" data-edit-member="${m.id}">编辑</button> <button class="btn small danger" data-delete-member="${m.id}">删除</button></td></tr>`).join('')}</tbody></table>` : '<p class="subtle">尚未添加成员。</p>'}
  </article>`;
}

function classificationReferenceCount(kind, id) {
  const sources=state.notesMode==='Local'?[state.notes]:[state.notes,state.localClassificationNotes];
  return sources.flat().filter((note) => kind === 'contentTypes' ? normalizeNote(note).contentType === id : noteCategoryId(note) === id).length;
}

function classificationSettings() {
  const section = (kind, title) => `<section class="classification-section"><div class="classification-head"><div><h5>${title}</h5><p>稳定 ID 与显示名称分离，重命名不会断开已有笔记关联。</p></div><button class="btn small" type="button" data-classification-add="${kind}">＋ 新增</button></div><div class="classification-list">${classificationItems(kind).map((item) => {
    const count=classificationReferenceCount(kind,item.id);
    return `<div class="classification-row"><div><b>${esc(item.label)}</b><small>${esc(item.id)} · 可访问数据源 ${count} 条引用</small></div><div><button class="btn small" type="button" data-classification-edit="${kind}:${esc(item.id)}">重命名</button><button class="btn small danger" type="button" data-classification-delete="${kind}:${esc(item.id)}">删除</button></div></div>`;
  }).join('')}</div></section>`;
  return `<article class="card setting-card classification-card"><div class="setting-card-head"><div><h4>内容分类</h4><p class="subtle">统一管理随手笔记和内容分类页面使用的选项。</p></div><span class="setting-value ${state.notesMode==='Memos'?'remote':'ready'}">${esc(state.notesMode)}</span></div>${section('contentTypes','内容类型')}${section('categories','主题分类')}<div class="warning">分类配置保存在当前浏览器。尚未被任何 Memos 笔记引用的新分类不会跨设备同步；被引用后，其稳定 ID 和名称会随笔记末尾元数据保存。删除有引用的分类时必须先迁移笔记。</div></article>`;
}

function settingsPage() {
  const config = notesCredentials.getConfig();
  const radarConfig = radarCredentials.getConfig();
  const radarKeys = radarCredentials.getCredentials();
  const radarConfigured = Boolean(radarKeys.deepseekApiKey);
  const settingsSections=[['service','服务状态'],['backup','数据备份'],['notes','Notes Storage / Memos'],['classifications','内容分类管理'],['radar','Radar 在线服务'],['team','团队成员'],['boundary','界面边界说明']];
  const sidebarCollapsed=state.contentSidebarCollapsed.settings;
  return shell(`<section class="page work-page settings-page settings-section-${esc(state.settingsSection)}"><div class="page-head"><div><h3>Settings</h3><p>存储状态、团队和备份。</p></div></div><div class="settings-workspace content-sidebar-layout ${sidebarCollapsed?'content-sidebar-collapsed':''}"><aside class="settings-sidebar card module-content-sidebar"><header class="content-sidebar-head"><b>设置分类</b>${contentSidebarToggle('settings','设置分类')}</header><nav>${settingsSections.map(([key,label])=>`<button class="${state.settingsSection===key?'active':''}" data-settings-section="${key}">${esc(label)}</button>`).join('')}</nav></aside>${sidebarCollapsed?contentSidebarToggle('settings','设置分类'):''}
    <div class="settings-grid"><article class="card setting-card"><h4>Toward the Sea 服务状态</h4><p class="subtle">任务存储与 Notes 存储相互独立。</p><div class="setting-row"><span>Task Storage</span><span class="setting-value ready">Local</span></div><div class="setting-row"><span>Remote Adapter</span><span class="setting-value muted">Not Configured</span></div><div class="setting-row"><span>Email Notification</span><span class="setting-value muted">Not Configured</span></div></article>
      <article class="card setting-card"><h4>数据备份</h4><p class="subtle">覆盖本地 Tasks、Notes、Radar、临时暂存、个人待办、日历事件、模板、提醒、Team 及历史记录。导入采用按 ID 合并策略，相同 ID 保留已有记录；过期的已完成暂存不会恢复。Memos 远端笔记和访问令牌不会导出。</p><div class="import-box"><button class="btn dark" id="export-data">导出本地 JSON</button><label class="btn" for="import-data">导入 JSON</label><input class="sr-only" id="import-data" type="file" accept="application/json,.json"></div><div class="warning" style="margin-top:18px">浏览器存储不是云端备份。模板只保存在本地；file:// 数据可能按浏览器与文件路径隔离，清除站点数据仍会导致丢失。</div></article>
      <article class="card setting-card notes-storage-card"><h4>Notes Storage</h4><div class="setting-row"><span>当前模式</span><span class="setting-value ${config.mode === 'Memos' ? 'remote' : 'ready'}">${esc(config.mode || 'Local')}</span></div>
        <div class="field"><label>Memos Server URL</label><input class="input" id="memos-url" type="url" placeholder="https://memos.example.com" value="${esc(config.serverUrl || '')}"><div class="field-hint">可粘贴设置页链接；连接时会自动提取站点根地址，不会把页面路径或 #fragment 当成 API 路径。</div></div>
        <div class="field"><label>API 版本</label><select class="select" id="memos-api"><option value="auto">自动检测</option><option value="/api" ${config.apiBase === '/api' ? 'selected':''}>26.10 / Latest（/api）</option><option value="/api/v1" ${config.apiBase === '/api/v1' ? 'selected':''}>0.30–0.31（/api/v1）</option></select></div>
        <div class="field"><label>Access Token</label><input class="input" id="memos-token" type="password" autocomplete="off" placeholder="不会回显或写入备份"><div class="field-hint">Token 不进入 URL、日志、源码或 JSON 导出。</div></div>
        <label class="check-row"><input id="remember-token" type="checkbox" ${config.remember ? 'checked':''}> 记住令牌（默认关闭；同源脚本或浏览器扩展可能读取本地凭据）</label>
        <div class="import-box"><button class="btn" data-test-memos>Test Connection</button><button class="btn primary" data-connect-memos>Connect</button>${config.mode === 'Memos' ? '<button class="btn" data-disconnect-memos>切回 Local</button>' : ''}<button class="btn danger" data-clear-memos>Clear Credentials</button></div>
        <div id="memos-test-status" class="field-hint">${state.notesError ? esc(state.notesError) : config.mode === 'Memos' ? `已连接 ${esc(config.serverUrl || '')}；仅操作 Toward the Sea 创建的 Memos。` : '未配置时 Local 完整可用。连接测试成功后才可启用 Memos。'}</div>
        <div class="warning">从 file:// 连接远程 Memos 可能被 CORS / Origin: null 策略拒绝。不会要求关闭浏览器安全功能，也不会使用第三方代理。</div>
      </article>
      ${classificationSettings()}
      <article class="card setting-card notes-storage-card"><div class="setting-card-head"><div><h4>Radar 联网服务</h4><p class="subtle">DeepSeek 必需；Tavily 可选且优先使用，未配置或服务异常时使用官方 DeepSeek Search。</p></div><span class="setting-value ${radarConfigured ? 'ready' : 'muted'}">${radarConfigured ? 'Configured' : 'Not Configured'}</span></div>
        <div class="field"><label>Tavily API Key（可选）</label><div class="secret-field"><input class="input" id="tavily-key" type="password" autocomplete="off" value="${esc(radarKeys.tavilyApiKey)}" placeholder="tvly-…"><button class="btn small" type="button" data-toggle-secret="tavily-key" aria-label="显示 Tavily API Key">显示</button></div><div class="field-hint">配置后优先使用 Tavily；连接测试不会调用搜索接口或消耗 credits，首次探索时才验证。</div></div>
        <div class="field"><label>DeepSeek API Key</label><div class="secret-field"><input class="input" id="deepseek-key" type="password" autocomplete="off" value="${esc(radarKeys.deepseekApiKey)}" placeholder="sk-…"><button class="btn small" type="button" data-toggle-secret="deepseek-key" aria-label="显示 DeepSeek API Key">显示</button></div></div>
        <div class="field"><label>DeepSeek Model ID</label><input class="input" id="deepseek-model" maxlength="64" value="${esc(radarConfig.modelId || DEFAULT_MODEL_ID)}" placeholder="${DEFAULT_MODEL_ID}"><div class="field-hint">模型名称会独立保存且不属于秘密；仅接受 deepseek- 开头的模型 ID。</div></div>
        <div class="field"><label>单日联网探索上限</label><input class="input" id="radar-daily-limit" type="number" min="1" max="50" step="1" value="${Number(radarConfig.dailyLimit || DEFAULT_DAILY_LIMIT)}"><div class="field-hint">默认 3 次，由当前浏览器在本地计数；可以设置为 1–50。测试连接和演示探索不计入。</div></div>
        <label class="check-row"><input id="remember-radar-keys" type="checkbox" ${radarConfig.remember ? 'checked':''}> 长期保存在此设备（默认关闭；取消后保存会清除原有持久化密钥）</label>
        <div class="import-box"><button class="btn" data-test-radar>测试连接</button><button class="btn primary" data-save-radar-config>保存配置</button><button class="btn danger" data-clear-radar-config>清除配置</button></div>
        <div id="radar-test-status" class="field-hint">${state.radarTest ? esc(state.radarTest) : radarConfigured ? `已配置 DeepSeek · ${esc(radarConfig.modelId || DEFAULT_MODEL_ID)}。${radarKeys.tavilyApiKey?'Tavily 已填写，将在首次探索时验证。':'未配置 Tavily，将使用 DeepSeek Search。'}` : '未配置 DeepSeek 时 Radar 保持 Demo 模式。'}</div>
        <div class="warning">密码框中的黑点表示当前会话或本设备已有密钥。未勾选长期保存时，密钥只保留到当前页面会话结束；长期保存会增加共享设备、同源脚本与 XSS 风险。密钥不会进入 URL、Toward the Sea JSON 备份或服务端持久化数据。</div>
      </article>
      ${teamSettings()}
      <article class="card setting-card"><h4>接口边界</h4><p class="subtle">Toward the Sea 继续通过既有 Storage Adapter 访问本地数据，Remote Adapter 预留未删除。临时暂存、个人待办、日历、提醒和模板均为独立本地集合；Notes 使用独立的 LocalNotesAdapter / MemosNotesAdapter；Radar 可使用同源 FastAPI。邮件模块与可靠后台提醒本次均未实现，页面关闭时不会声称已发送通知。</p></article>
    </div></div></section>`, 'Settings', 'Toward the Sea 与 Notes 存储独立配置');
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
  if (d.type === 'new-capture' || d.type === 'edit-capture') { const item=state.data.captures.find((entry)=>entry.id===d.id); title=d.type==='new-capture'?'快速暂存':'编辑暂存'; submit='保存'; body=`<div class="field"><label>内容 <span>*</span></label><textarea class="textarea tall" name="content" required autofocus placeholder="文本或链接均可">${esc(item?.content||'')}</textarea></div><p class="field-hint">这里不要求标题和分类。需要安排时间时，可稍后将它转为个人待办。</p>`; }
  if (d.type === 'new-todo' || d.type === 'edit-todo') { const item=state.data.todos.find((entry)=>entry.id===d.id); title=d.type==='new-todo'?'新建个人待办':'编辑个人待办'; submit='保存待办'; body=`<div class="field"><label>事项 <span>*</span></label><input class="input" name="title" maxlength="160" required value="${esc(item?.title||'')}"></div><div class="field"><label>备注</label><textarea class="textarea" name="notes">${esc(item?.notes||'')}</textarea></div><div class="two-col"><div class="field"><label>计划日期</label><input class="input" type="date" name="plannedDate" value="${esc(item?.plannedDate||'')}"></div><div class="field"><label>截止日期</label><input class="input" type="date" name="dueDate" value="${esc(item?.dueDate||'')}"></div></div><div class="field"><label>提醒时间</label><input class="input" type="datetime-local" name="remindAt" value="${esc(dateTimeLocalValue(item?.remindAt))}"><div class="field-hint">网页关闭时不会后台运行；重新打开后，已到期提醒会出现在提醒中心。</div></div>`; }
  if (d.type === 'new-event' || d.type === 'edit-event') { const item=state.data.calendarEvents.find((entry)=>entry.id===d.id); const start=item?.startAt||`${state.calendarDate}T09:00`; const end=item?.endAt||`${state.calendarDate}T10:00`; title=d.type==='new-event'?'新建日历事件':'编辑日历事件'; submit='保存事件'; body=`<div class="field"><label>标题 <span>*</span></label><input class="input" name="title" maxlength="160" required value="${esc(item?.title||'')}"></div><div class="two-col"><div class="field"><label>开始 <span>*</span></label><input class="input" type="datetime-local" name="startAt" required value="${esc(dateTimeLocalValue(start)||start)}"></div><div class="field"><label>结束 <span>*</span></label><input class="input" type="datetime-local" name="endAt" required value="${esc(dateTimeLocalValue(end)||end)}"></div></div><div class="field"><label>提醒时间</label><input class="input" type="datetime-local" name="remindAt" value="${esc(dateTimeLocalValue(item?.remindAt))}"></div><div class="field"><label>备注</label><textarea class="textarea" name="notes">${esc(item?.notes||'')}</textarea></div>${item?`<button class="btn danger" type="button" data-delete-event="${esc(item.id)}">删除事件</button>`:''}`; }
  if (d.type === 'new-template' || d.type === 'edit-template') { const item=state.data.templates.find((entry)=>entry.id===d.id); const categories=[...new Set([...TEMPLATE_DEFAULT_CATEGORIES,...state.data.templates.map((entry)=>entry.category).filter(Boolean)])]; title=d.type==='new-template'?'新建模板':'编辑模板'; submit='保存模板'; body=`<div class="field"><label>标题 <span>*</span></label><input class="input" name="title" maxlength="120" required value="${esc(item?.title||'')}"></div><div class="field"><label>分类</label><input class="input" name="category" list="template-category-options" value="${esc(item?.category||TEMPLATE_DEFAULT_CATEGORIES[0])}"><datalist id="template-category-options">${categories.map((value)=>`<option value="${esc(value)}"></option>`).join('')}</datalist></div><div class="field"><label>模板正文 <span>*</span></label><textarea class="textarea tall" name="content" required placeholder="可使用 {{name}} 形式的变量">${esc(item?.content||'')}</textarea></div><label class="check-line"><input type="checkbox" name="favorite" ${item?.favorite?'checked':''}> 收藏模板</label>`; }
  if (d.type === 'new-task') { title='新建任务'; submit='创建任务'; body=`<div class="field"><label>任务名称 <span>*</span></label><input class="input" name="title" required maxlength="120"></div><div class="field"><label>任务要求 <span>*</span></label><textarea class="textarea" name="requirement" required></textarea></div><div class="two-col"><div class="field"><label>负责人</label><select class="select" name="ownerId">${memberOptions()}</select></div><div class="field"><label>任务状态</label><select class="select" disabled><option>待办</option></select></div></div><div class="field"><label>下一步</label><textarea class="textarea" name="next"></textarea></div><div class="field"><label>备注</label><textarea class="textarea" name="remark" placeholder="背景、注意事项或补充说明"></textarea></div>`; }
  if (d.type === 'update-task') { const t=state.data.tasks.find((x)=>x.id===state.taskId); title='更新进度'; submit='保存更新'; body=`<div class="field"><label>本次完成了什么？</label><textarea class="textarea" name="progress" placeholder="填写后会追加到 Activity，不覆盖历史。" autofocus></textarea></div><div class="field"><label>下一步是什么？</label><textarea class="textarea" name="next" placeholder="接下来要做什么？">${esc(t.next||'')}</textarea></div><div class="field"><label>任务状态？</label><select class="select" name="status">${STATUS.map((s)=>`<option value="${s}" ${s===t.status?'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>`; }
  if (d.type === 'handoff') { const t=state.data.tasks.find((x)=>x.id===state.taskId); const available=state.data.team.some((m)=>!isCurrentOwner(t,m)); title='交接任务'; submit='确认交接'; body=`<div class="handoff-flow"><div class="active"><b>1</b><span>当前负责人</span></div><i>↓</i><div><b>2</b><span>接手人</span></div><i>↓</i><div><b>3</b><span>确认交接</span></div></div><div class="field"><label>当前负责人</label><input class="input" value="${esc(t.ownerName||'未分配')}" disabled></div><div class="field"><label>接手人 <span>*</span></label><select class="select" name="toId" id="handoff-to" required ${available?'':'disabled'}>${handoffMemberOptions(t)}</select>${available?'':'<div class="field-hint error-text">Team 中没有其他可接手的成员，请先到 Settings 添加成员。</div>'}</div><div class="field"><label>交接说明</label><textarea class="textarea" name="note" placeholder="交接背景、注意事项或待处理内容"></textarea></div><div class="handoff-confirm" id="handoff-confirm">请选择接手人。确认时会保存当时任务状态和最新进展快照；完成状态不会改变。</div>`; }
  if (d.type === 'new-radar-profile' || d.type === 'edit-radar-profile') { const profile=d.type==='edit-radar-profile'?(state.radarProfiles.find((item)=>item.id===d.id)||activeRadarProfile()):null; const editing=Boolean(profile); title=editing?'编辑探索方向':'新建探索方向'; submit=editing?'保存配置':'创建方向'; body=`<div class="field"><label>方向名称 <span>*</span></label><input class="input" name="name" required maxlength="60" value="${esc(profile?.name||'')}" ${profile?.isDefault?'readonly':''}></div><div class="field"><label>核心领域</label><textarea class="textarea" name="coreDomains" placeholder="每行填写一个领域">${esc((profile?.coreDomains||[]).join('\n'))}</textarea><div class="field-hint">演示提供方目前支持：AI Engineering、Personal Productivity、Knowledge Management。</div></div><div class="field"><label>相邻领域</label><textarea class="textarea" name="adjacentDomains" placeholder="每行填写一个领域">${esc((profile?.adjacentDomains||[]).join('\n'))}</textarea><div class="field-hint">演示提供方目前支持：Learning Science、Behavioral Science、Product Design。</div></div><div class="warning">修改配置不会清除当前批次；下一次 Explore New 才会按新配置查找演示候选。Unknown Window 始终保持开放。</div>`; }
  if (d.type === 'new-member' || d.type === 'edit-member') { const m=state.data.team.find((x)=>x.id===d.id); title=d.type==='new-member'?'添加成员':'编辑成员'; submit='保存成员'; body=`<div class="field"><label>Name <span>*</span></label><input class="input" name="name" required value="${esc(m?.name||'')}"></div><div class="field"><label>Email <span>*</span></label><input class="input" name="email" type="email" required value="${esc(m?.email||'')}"></div>`; }
  if (d.type === 'new-salary' || d.type === 'edit-salary') {
    const item=state.data.salaryRecords.find((entry)=>entry.id===d.id);const f=item?.facts||{};const today=localDateKey();const legacy=Boolean(item&&Number(item.snapshot?.formulaVersion||1)<2&&!f.recordVersion);
    title=item?'编辑工资记录':'新增工资记录';submit='保存工资记录';
    const adjustments=`<details><summary>奖金、补贴与扣款</summary><div class="labor-form-grid"><label>奖金<input class="input" type="number" name="bonus" min="0" step="0.01" value="${f.bonus??0}"></label><label>补贴<input class="input" type="number" name="allowance" min="0" step="0.01" value="${f.allowance??0}"></label><label>扣款<input class="input" type="number" name="deductions" min="0" step="0.01" value="${f.deductions??0}"></label></div></details><div class="field"><label>备注</label><textarea class="textarea" name="note">${esc(f.note||'')}</textarea></div>`;
    if(legacy){const monthStart=`${today.slice(0,7)}-01`;const overtimeField=(key,label)=>`<div class="two-col"><div class="field"><label>${label}</label><input class="input" type="number" name="${key}Value" min="0" step="0.25" value="${f[`${key}Value`]??0}"></div><div class="field"><label>单位</label><select class="select" name="${key}Unit"><option value="hours" ${f[`${key}Unit`]!=='days'?'selected':''}>小时</option><option value="days" ${f[`${key}Unit`]==='days'?'selected':''}>天</option></select></div></div>`;body=`<input type="hidden" name="salarySchema" value="legacy"><div class="warning"><b>旧版记录兼容模式</b><br>这条记录继续使用原始日期范围和 1.5 / 2 / 3 倍加班字段，保存时不会自动改写为新口径。</div><div class="two-col"><div class="field"><label>开始日期 <span>*</span></label><input class="input" type="date" name="periodStart" required value="${esc(f.periodStart||monthStart)}"></div><div class="field"><label>结束日期 <span>*</span></label><input class="input" type="date" name="periodEnd" required value="${esc(f.periodEnd||today)}"></div></div><div class="field"><label>实际总工资（税后到手）<span>*</span></label><input class="input" type="number" name="totalSalary" min="0" step="0.01" required value="${f.totalSalary??''}"></div><div class="two-col"><div class="field"><label>正常工作天数 <span>*</span></label><input class="input" type="number" name="normalDays" min="0" max="366" step="0.25" required value="${f.normalDays??21.75}"></div><div class="field"><label>每天正常工时 <span>*</span></label><input class="input" type="number" name="dailyHours" min="0" max="24" step="0.25" required value="${f.dailyHours??8}"></div></div>${overtimeField('overtime15','1.5 倍额外加班')}${overtimeField('overtime20','2 倍额外加班')}${overtimeField('overtime30','3 倍额外加班')}${adjustments}`;}
    else{body=`<input type="hidden" name="salarySchema" value="v2"><div class="field"><label>记录月份 <span>*</span></label><input class="input" type="month" name="month" required value="${esc(f.month||today.slice(0,7))}"></div><div class="field"><label>实际总工资（税后到手）<span>*</span></label><input class="input" type="number" name="totalSalary" min="0" step="0.01" required value="${f.totalSalary??''}"><div class="field-hint">这是已实际收到的工资；理论加班报酬仅用于估算，不会加入实际工资。</div></div><div class="two-col"><div class="field"><label>实际上班总天数 <span>*</span></label><input class="input" type="number" name="actualWorkDays" min="0" max="366" step="0.25" required value="${f.actualWorkDays??21.75}"></div><div class="field"><label>每天正常工作小时 <span>*</span></label><input class="input" type="number" name="dailyHours" min="0" max="24" step="0.25" required value="${f.dailyHours??8}"></div></div><div class="labor-form-grid"><label>工作日额外加班小时<input class="input" type="number" name="weekdayOvertimeHours" min="0" step="0.25" value="${f.weekdayOvertimeHours??0}"></label><label>周六日加班天数<input class="input" type="number" name="weekendOvertimeDays" min="0" max="366" step="0.25" value="${f.weekendOvertimeDays??0}"></label><label>法定节假日加班天数<input class="input" type="number" name="holidayOvertimeDays" min="0" max="366" step="0.25" value="${f.holidayOvertimeDays??0}"></label></div><div class="warning">实际上班总天数已经包含周末和法定节假日上班天数。系统不会再次把周末或节假日天数叠加到总天数；总实际工时 = 实际上班总天数 × 每日工时 + 工作日额外加班小时。</div>${adjustments}`;}
  }
  if (d.type === 'new-living' || d.type === 'edit-living') { const item=state.data.livingRecords.find((entry)=>entry.id===d.id);const f=item?.facts||{};const latestSalary=laborLatest('salaryRecords','periodStart')?.snapshot?.totalSalary||0;title=item?'编辑生活成本记录':'新增生活成本记录';submit='保存生活记录';const cost=(name,label)=>`<label>${label}<input class="input" type="number" name="${name}" min="0" step="0.01" value="${f[name]??0}"></label>`;body=`<div class="two-col"><div class="field"><label>月份 <span>*</span></label><input class="input" type="month" name="month" required value="${esc(f.month||localDateKey().slice(0,7))}"></div><div class="field"><label>实际到手收入</label><input class="input" type="number" name="actualIncome" min="0" step="0.01" value="${f.actualIncome??latestSalary}"></div></div><h5>普通生活支出</h5><div class="labor-form-grid">${cost('rent','房租与居住')}${cost('food','饮食')}${cost('transport','普通交通')}${cost('utilities','水电、网络、通信')}${cost('dailyNeeds','日常起居')}${cost('otherNecessary','其他必要支出')}${cost('nonEssential','非必要消费')}${cost('oneTime','一次性大额支出')}</div><h5>工作与储蓄</h5><div class="labor-form-grid">${cost('workRelated','工作相关增量支出')}${cost('availableSavings','当前可用储蓄')}</div><div class="warning">工作增量支出只填写“因为这份工作才新增”的费用；已经记入普通交通、居住或饮食的同一笔钱不要重复填写。</div><div class="field"><label>备注</label><textarea class="textarea" name="note">${esc(f.note||'')}</textarea></div>`; }
  if (d.type === 'new-classification' || d.type === 'edit-classification') { const item=classificationItems(d.kind).find((entry)=>entry.id===d.id); const label=d.kind==='contentTypes'?'内容类型':'主题分类'; title=d.type==='new-classification'?`新增${label}`:`重命名${label}`; submit=d.type==='new-classification'?'新增分类':'保存名称'; body=`<div class="field"><label>显示名称 <span>*</span></label><input class="input" name="label" maxlength="60" required autofocus value="${esc(item?.label||'')}"></div><div class="warning">分类关联使用不可变的稳定 ID。重命名只改变显示名称，不会中断已有笔记关联。</div>`; }
  if (d.type === 'delete-classification') { const item=classificationItems(d.kind).find((entry)=>entry.id===d.id); const count=classificationReferenceCount(d.kind,d.id); const label=d.kind==='contentTypes'?'内容类型':'主题分类'; title=`删除${label}`; submit=count?'迁移并删除':'确认删除'; const options=d.kind==='contentTypes'?contentTypeOptions('',d.id):categoryOptions('',d.id); body=`<div class="warning"><b>将删除“${esc(item?.label||'')}”</b><br>${count?`当前可访问的数据源有 ${count} 条笔记引用，必须先迁移到其他分类。`:'当前可访问的数据源没有引用；删除后本地配置将不再显示此分类。'}</div>${count?`<div class="field"><label>迁移到 <span>*</span></label><select class="select" name="replacementId" required><option value="">请选择目标分类</option>${options}</select></div>`:''}<p class="field-hint">若不可访问的另一数据源仍存在相同分类，重新连接时会从笔记元数据安全恢复，不会删除笔记正文。</p>`; }
  if (d.type === 'overtime-help') { title=d.helpKey&&d.helpKey!=='all'?'字段说明':'边际价值 · 字段说明';body=overtimeHelpBody(d.helpKey||'all'); }
  if (d.type === 'overtime-detail') { title='当前节点计算明细';body=overtimeDetailBody(d.detailKey,d.point,d.facts,d.analysis); }
  if (d.type === 'radar-history') { const history=activeRadarHistory();title=`${activeRadarProfile()?.name||'当前方向'} · 探索历史`;body=`<p class="subtle">只展示当前探索方向的成功、无结果、失败和限额记录。</p><div class="radar-history drawer-history">${history.length?history.map(radarHistoryEntry).join(''):'<div class="radar-empty">这个方向还没有探索记录</div>'}</div>`; }
  if (d.type === 'view-overtime') { const item=state.data.overtimeDecisions.find((entry)=>entry.id===d.id);const selected=item?.snapshot?.selected||{};const input=item?.snapshot?.input||{};const nodes=item?.snapshot?.nodes||{};const modern=Number(item?.snapshot?.formulaVersion||0)>=2;title='加班价值记录详情';body=item?`<div class="drawer-fact-head"><span>${esc(item.facts.date||'')}</span><h4>${laborNumber(selected.hours)}h 加班价值快照</h4><p>${esc(item.facts.note||'无备注')}</p></div><div class="labor-live-summary drawer-summary"><div><span>实际增量收入</span><b>${laborMoney(selected.actualIncrementalIncome??selected.totalOvertimeIncome??selected.overtimeIncome)}</b></div>${modern?`<div><span>加班溢价</span><b>${laborMoney(selected.overtimePremium||0)}</b></div>`:''}<div><span>夜班补贴</span><b>${laborMoney(selected.nightSubsidy||0)}</b></div><div><span>净现金收益</span><b>${laborMoney(selected.cashNetValue)}</b></div><div><span>综合净价值</span><b>${laborMoney(selected.comprehensiveValue)}</b></div></div><dl class="drawer-facts"><div><dt>正常时薪 / 加班倍率</dt><dd>${laborMoney(input.normalHourlyRate??input.baseHourlyRate)} × ${laborNumber(selected.totalMultiplier??input.multiplier)} 倍</dd></div>${modern?`<div><dt>打车 / 外卖</dt><dd>${laborMoney(selected.taxiCost)} / ${laborMoney(selected.mealCost)}</dd></div><div><dt>额外现金支出</dt><dd>${laborMoney(selected.extraCosts??((selected.fixedCost||0)+(selected.variableCost||0)))}</dd></div><div><dt>实际占用时间 / 净时薪</dt><dd>${laborNumber(selected.actualOccupiedHours??selected.hours,2)}h / ${selected.actualNetHourly==null?'—':laborMoney(selected.actualNetHourly)}</dd></div><div><dt>最低接受回报 / 差额</dt><dd>${laborMoney(selected.minimumAcceptableReturn||0)} / ${laborMoney(selected.acceptanceGap||0)}</dd></div>`:`<div><dt>旧版固定 / 变动支出</dt><dd>${laborMoney(selected.fixedCost)} / ${laborMoney(selected.variableCost)}</dd></div>`}<div><dt>自由时间 / 疲劳成本</dt><dd>${laborMoney(selected.restOpportunityCost)} / ${laborMoney(selected.fatigueCost)}</dd></div><div><dt>范围内最优点</dt><dd>${nodes.optimal?`${laborNumber(nodes.optimal.hours)}h · ${laborMoney(nodes.optimal.comprehensiveValue)}`:'不存在'}</dd></div></dl><div class="warning">此处展示的是保存当时的试算假设与理论结果，不代表已经实际获得的工资。</div>`:'<div class="warning">记录不存在或已被删除。</div>'; }
  const readOnly=['radar-history','view-overtime','overtime-help','overtime-detail'].includes(d.type);
  const modal=d.type==='new-template';
  return `<div class="drawer-backdrop"><form class="drawer route-${esc(state.route)} ${readOnly?'drawer-readonly':''} ${modal?'drawer-modal':''}" id="drawer-form"><header class="drawer-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></header><div class="drawer-body">${body}</div><footer class="drawer-foot"><button type="button" class="btn" data-close>${readOnly?'关闭':'取消'}</button>${readOnly?'':`<button class="btn primary" type="submit">${submit}</button>`}</footer></form></div>`;
}

function render() {
  stopHomeClock();
  destroyActiveArtwork();
  if (state.route === 'home') app.innerHTML = homePage();
  if (state.route === 'capture') app.innerHTML = capturePage();
  if (state.route === 'todos') app.innerHTML = todosPage();
  if (state.route === 'calendar') app.innerHTML = calendarPage();
  if (state.route === 'templates') app.innerHTML = templatePage();
  if (state.route === 'radar') app.innerHTML = radarPage();
  if (state.route === 'tasks') app.innerHTML = taskList();
  if (state.route === 'task-detail') app.innerHTML = taskDetail();
  if (state.route === 'labor-life') app.innerHTML = laborLifePage();
  if (state.route === 'notes') app.innerHTML = notesPage();
  if (state.route === 'categories') app.innerHTML = categoriesPage();
  if (state.route === 'settings') app.innerHTML = settingsPage();
  if (state.route === 'playground') app.innerHTML = playgroundPage();
  if (state.route === 'home') startHomeClock();
  if (state.route === 'playground' && PLAYGROUND_MODULES[state.playgroundView]) mountArtwork(state.playgroundView);
}

function hasTransientEdits() { return Boolean(state.drawer?.dirty || transientDirtyForms.size); }

function confirmEditorExit() {
  if (!hasTransientEdits()) return true;
  if (!confirm('当前编辑内容尚未保存。确定放弃修改并离开吗？')) return false;
  transientDirtyForms.clear();
  if (state.drawer) state.drawer.dirty=false;
  return true;
}

function markTransientEditorDirty(target) {
  const form=target.closest?.('#drawer-form,#capture-form,#home-capture-form,#todo-quick-form,#template-inline-form,#labor-overtime-form,#overtime-status-form,#labor-forecast-form,#labor-parameters-form,#labor-job-form');
  if (!form) return;
  if (form.id==='drawer-form' && state.drawer) state.drawer.dirty=true;
  else transientDirtyForms.add(form.id);
}

function openDrawer(type, id = null) { state.drawer = { type, id, dirty:false }; render(); }
function closeDrawer(force = false) { const transient=state.drawer?.transient;if(!transient&&!force&&!confirmEditorExit())return false;state.drawer=null;if(transient)document.querySelector('.drawer-backdrop')?.remove();else render();return true; }

async function refresh(message) {
  const readStarted=performance.now();await loadData();const readMs=performance.now()-readStarted;
  const renderStarted=performance.now();render();const renderMs=performance.now()-renderStarted;
  if(message)toast(message);
  if(saveTimingEnabled)console.info(`[save-timing] refresh: ${readMs.toFixed(1)}ms reload + ${renderMs.toFixed(1)}ms render`);
}

function rewriteNoteClassification(note, kind, id, label) {
  const value=normalizeNote(note); const updatedAt=now();
  return kind==='contentTypes'
    ? normalizeNote({...value,contentType:id,contentTypeId:id,contentTypeLabel:label,updatedAt})
    : normalizeNote({...value,categoryId:id,category:label,categoryLabel:label,updatedAt});
}

async function updateClassificationReferences(kind, sourceId, targetId, targetLabel) {
  let changed=0;
  const matches=(note)=>kind==='contentTypes'?normalizeNote(note).contentType===sourceId:noteCategoryId(note)===sourceId;
  const updateList=async(notes,adapter)=>{
    for(const note of notes.filter(matches)){await adapter.update(rewriteNoteClassification(note,kind,targetId,targetLabel));changed+=1;}
  };
  if(state.notesMode==='Memos') await updateList(state.notes,currentNotesAdapter());
  await updateList(state.localClassificationNotes,new LocalNotesAdapter(storage));
  for(const source of state.notesMode==='Memos'?['Local','Memos']:['Local']){
    for(const draft of (await notesDrafts.list(source)).filter(matches)){
      await notesDrafts.save({...rewriteNoteClassification(draft,kind,targetId,targetLabel),source,noteId:draft.noteId,revision:Number(draft.revision||0)+1});
    }
  }
  return changed;
}

async function onSubmit(form) {
  const fd = new FormData(form); const d = state.drawer; const timestamp = now();
  if (d.type === 'new-capture' || d.type === 'edit-capture') {
    const old=state.data.captures.find((item)=>item.id===d.id); const content=String(fd.get('content')||'').trim();
    if(!content)throw new Error('暂存内容不能为空');
    await storage.put('captures',{id:old?.id||uid('capture'),content,status:old?.status||'pending',convertedTodoId:old?.convertedTodoId||'',createdAt:old?.createdAt||timestamp,updatedAt:timestamp,completedAt:old?.completedAt||''}); state.drawer=null; await refresh(old?'暂存内容已更新':'已保存到临时暂存');
  }
  if (d.type === 'new-todo' || d.type === 'edit-todo') {
    const old=state.data.todos.find((item)=>item.id===d.id); const remindValue=String(fd.get('remindAt')||'');
    const item={id:old?.id||uid('todo'),title:String(fd.get('title')||'').trim(),notes:String(fd.get('notes')||'').trim(),plannedDate:String(fd.get('plannedDate')||''),dueDate:String(fd.get('dueDate')||''),remindAt:remindValue?new Date(remindValue).toISOString():'',status:old?.status||'pending',sourceCaptureId:old?.sourceCaptureId||'',createdAt:old?.createdAt||timestamp,updatedAt:timestamp,completedAt:old?.completedAt||''};
    if(!item.title)throw new Error('待办内容不能为空'); await storage.put('todos',item); await syncReminder('todo',item,item.status==='completed'?'':item.remindAt); state.drawer=null; await refresh(old?'待办已更新':'个人待办已创建');
  }
  if (d.type === 'new-event' || d.type === 'edit-event') {
    const old=state.data.calendarEvents.find((item)=>item.id===d.id); const startAt=new Date(String(fd.get('startAt'))); const endAt=new Date(String(fd.get('endAt'))); const remindValue=String(fd.get('remindAt')||'');
    if(Number.isNaN(startAt.getTime())||Number.isNaN(endAt.getTime()))throw new Error('请填写有效的开始和结束时间'); if(endAt<startAt)throw new Error('结束时间不能早于开始时间');
    const item={id:old?.id||uid('event'),title:String(fd.get('title')||'').trim(),notes:String(fd.get('notes')||'').trim(),startAt:startAt.toISOString(),endAt:endAt.toISOString(),remindAt:remindValue?new Date(remindValue).toISOString():'',createdAt:old?.createdAt||timestamp,updatedAt:timestamp};
    if(!item.title)throw new Error('事件标题不能为空'); await storage.put('calendarEvents',item); await syncReminder('event',item,item.remindAt); state.calendarDate=localDateKey(startAt); state.calendarMonth=state.calendarDate.slice(0,7); state.drawer=null; await refresh(old?'日历事件已更新':'日历事件已创建');
  }
  if (d.type === 'new-template' || d.type === 'edit-template') {
    const old=state.data.templates.find((item)=>item.id===d.id); const item={id:old?.id||uid('template'),title:String(fd.get('title')||'').trim(),category:String(fd.get('category')||'').trim()||'通用',content:String(fd.get('content')||''),favorite:fd.get('favorite')==='on',createdAt:old?.createdAt||timestamp,updatedAt:timestamp};
    if(!item.title||!item.content.trim())throw new Error('模板标题和正文不能为空'); await storage.put('templates',item); state.templateId=item.id; state.templateValues={}; state.drawer=null; await refresh(old?'模板已更新':'模板已创建');
  }
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
  if (d.type === 'new-salary' || d.type === 'edit-salary') {
    const old=state.data.salaryRecords.find((item)=>item.id===d.id);const common={totalSalary:Number(fd.get('totalSalary')),dailyHours:Number(fd.get('dailyHours')),bonus:Number(fd.get('bonus')||0),allowance:Number(fd.get('allowance')||0),deductions:Number(fd.get('deductions')||0),note:String(fd.get('note')||'').trim()};let facts;
    if(fd.get('salarySchema')==='legacy'){facts={...old?.facts,...common,periodStart:String(fd.get('periodStart')||''),periodEnd:String(fd.get('periodEnd')||''),normalDays:Number(fd.get('normalDays')),overtime15Value:Number(fd.get('overtime15Value')||0),overtime15Unit:String(fd.get('overtime15Unit')||'hours'),overtime20Value:Number(fd.get('overtime20Value')||0),overtime20Unit:String(fd.get('overtime20Unit')||'hours'),overtime30Value:Number(fd.get('overtime30Value')||0),overtime30Unit:String(fd.get('overtime30Unit')||'hours')};if(!facts.periodStart||!facts.periodEnd||facts.periodEnd<facts.periodStart)throw new Error('请填写有效的统计日期范围');}
    else{facts={recordVersion:2,month:String(fd.get('month')||''),...common,actualWorkDays:Number(fd.get('actualWorkDays')),weekdayOvertimeHours:Number(fd.get('weekdayOvertimeHours')||0),weekendOvertimeDays:Number(fd.get('weekendOvertimeDays')||0),holidayOvertimeDays:Number(fd.get('holidayOvertimeDays')||0)};if(!/^\d{4}-\d{2}$/.test(facts.month))throw new Error('请选择有效月份');const duplicate=state.data.salaryRecords.find((item)=>item.id!==old?.id&&(item.facts?.month===facts.month||String(item.facts?.periodStart||'').slice(0,7)===facts.month));if(duplicate)throw new Error(`${facts.month} 已有工资记录，请编辑原记录而不是重复新增`);}
    const snapshot=calculateSalary(facts);await storage.put('salaryRecords',{id:old?.id||uid('salary'),facts,snapshot,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});state.drawer=null;await refresh(old?'工资记录已原位更新并重新计算':'工资记录已保存');
  }
  if (d.type === 'new-living' || d.type === 'edit-living') { const old=state.data.livingRecords.find((item)=>item.id===d.id);const numeric=['actualIncome','rent','food','transport','utilities','dailyNeeds','otherNecessary','nonEssential','oneTime','workRelated','availableSavings'];const facts={month:String(fd.get('month')||''),note:String(fd.get('note')||'').trim(),...Object.fromEntries(numeric.map((key)=>[key,Number(fd.get(key)||0)]))};if(!/^\d{4}-\d{2}$/.test(facts.month))throw new Error('请选择有效月份');const snapshot=calculateLiving(facts);await storage.put('livingRecords',{id:old?.id||uid('living'),facts,snapshot,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});state.drawer=null;await refresh(old?'生活记录已更新并重新计算':'生活记录已保存'); }
  if (d.type === 'new-classification') { state.classifications=classificationStore.add(state.classifications,d.kind,fd.get('label'));state.drawer=null;render();toast('分类已新增；未被 Memos 笔记引用前仅保存在当前浏览器'); }
  if (d.type === 'edit-classification') { const label=String(fd.get('label')||'').trim().replace(/\s+/g,' ').slice(0,60);if(!label)throw new Error('名称不能为空');if(classificationItems(d.kind).some((item)=>item.id!==d.id&&item.label.toLocaleLowerCase()===label.toLocaleLowerCase()))throw new Error('已存在同名分类');await updateClassificationReferences(d.kind,d.id,d.id,label);state.classifications=classificationStore.rename(state.classifications,d.kind,d.id,label);state.drawer=null;await refresh('分类名称已更新，稳定 ID 与笔记关联保持不变'); }
  if (d.type === 'delete-classification') { const count=classificationReferenceCount(d.kind,d.id);const replacementId=String(fd.get('replacementId')||'');if(count&&!replacementId){toast('请选择迁移目标','error');return;}let changed=0;if(replacementId){const replacement=classificationItems(d.kind).find((item)=>item.id===replacementId);if(!replacement)throw new Error('迁移目标不存在');changed=await updateClassificationReferences(d.kind,d.id,replacement.id,replacement.label);}state.classifications=classificationStore.remove(state.classifications,d.kind,d.id);if(d.kind==='contentTypes'&&state.categoryType===d.id)state.categoryType='All';if(d.kind==='categories'&&state.selectedCategory===d.id)state.selectedCategory='All';state.drawer=null;await refresh(changed?`已迁移 ${changed} 条笔记并删除分类`:'分类已删除'); }
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
    const content = String(fd.get('content')||'');
    if (!content.trim() && !fd.get('title').trim()) { toast('标题和正文不能同时为空','error'); return; }
    const old = state.notes.find((note) => note.id === draftNoteId);
    const timestamp = now();
    const categoryId=String(fd.get('category')||'personal'); const contentTypeId=String(fd.get('contentType')||'note');
    const note = normalizeNote({ id:old?.id||uid('note'), source, title:fd.get('title').trim(), content, categoryId, category:classificationLabel('categories',categoryId,'Personal'), categoryLabel:classificationLabel('categories',categoryId,'Personal'), contentType:contentTypeId, contentTypeId, contentTypeLabel:classificationLabel('contentTypes',contentTypeId,'笔记'), purpose:String(fd.get('purpose')||'').trim(), sourceUrl:safeSourceUrl(fd.get('sourceUrl'), true), pinned:fd.get('pinned')==='on', createdAt:old?.createdAt||timestamp, updatedAt:timestamp });
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
  const matchedCategory=classificationItems('categories').find((entry)=>entry.label===item.domain); const categoryId=matchedCategory?.id||'learning';
  const note = normalizeNote({ id:uid('note'), source:state.notesMode, title:item.title, content:`${item.explanation}${item.changeSummary ? `\n\n本次变化：${item.changeSummary}` : ''}\n\n为什么值得关注：${item.why}\n\n来源：${item.sourceName}\n${item.sourceUrl}`, purpose:item.why || '', sourceUrl:item.sourceUrl || '', contentType:'note', contentTypeId:'note', contentTypeLabel:classificationLabel('contentTypes','note','笔记'), pinned:false, categoryId, category:classificationLabel('categories',categoryId,'Learning'), categoryLabel:classificationLabel('categories',categoryId,'Learning'), createdAt:timestamp, updatedAt:timestamp });
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

function laborFormFacts(form, names) {
  const fd=new FormData(form);return Object.fromEntries(names.map((name)=>[name,fd.get(name)]));
}

function readOvertimeForm(form) {
  const fd=new FormData(form);const names=['overtimeVersion','date','scenario','normalWage','normalPaidHours','baseHourlyRate','multiplier','overtimeHourlyRate','overtimeRateMode','durationValue','taxiCost','mealCost','fixedExtraCost','variableExtraCostPerHour','extraOccupiedHours','minimumAcceptableHourly','nightSubsidyMode','nightSubsidyAmount','wageSettlementMode','settlementUnit','partialUnitRule','bonusMode','bonusThresholdHours','bonusThresholdAmount','legacyFixedCost','legacyVariableCostPerHour','legacyCommuteHours','restValuePerHour','fatigueCoefficient','maxHours','note'];const facts=Object.fromEntries(names.map((name)=>[name,fd.get(name)]));
  ['overtimeVersion','normalWage','normalPaidHours','baseHourlyRate','multiplier','overtimeHourlyRate','durationValue','taxiCost','mealCost','fixedExtraCost','variableExtraCostPerHour','extraOccupiedHours','minimumAcceptableHourly','nightSubsidyAmount','settlementUnit','bonusThresholdHours','bonusThresholdAmount','legacyFixedCost','legacyVariableCostPerHour','legacyCommuteHours','restValuePerHour','fatigueCoefficient','maxHours'].forEach((key)=>facts[key]=Number(facts[key]||0));
  const ids=fd.getAll('customId'),customNames=fd.getAll('customName'),amounts=fd.getAll('customAmount');facts.customExpenses=amounts.map((amount,index)=>({id:String(ids[index]||`custom-${index}`),name:String(customNames[index]||'自定义消费').trim()||'自定义消费',amount:Number(amount||0)}));const tierIds=fd.getAll('bonusTierId'),tierHours=fd.getAll('bonusTierHours'),tierAmounts=fd.getAll('bonusTierAmount');facts.bonusTiers=tierHours.map((hours,index)=>({id:String(tierIds[index]||`tier-${index}`),hours:Number(hours||0),amount:Number(tierAmounts[index]||0)}));facts.note=String(facts.note||'').trim();return facts;
}

function updateOvertimeFoldSummaries(form, facts) {
  const groups=form.querySelectorAll('.overtime-config-group'),fixed=Number(facts.taxiCost||0)+Number(facts.mealCost||0)+Number(facts.fixedExtraCost||0),custom=(facts.customExpenses||[]).reduce((sum,item)=>sum+Number(item.amount||0),0);const values=[fixed||facts.variableExtraCostPerHour||facts.extraOccupiedHours?`一次性 ${laborMoney(fixed)} · 每小时 ${laborMoney(facts.variableExtraCostPerHour)} · 额外 ${laborNumber(facts.extraOccupiedHours,2)}h`:'未配置额外成本',facts.customExpenses?.length?`${facts.customExpenses.length} 项 · 净变化 ${laborMoney(custom)}`:'未添加自定义消费',Number(facts.nightSubsidyAmount||0)>0?`${facts.nightSubsidyMode==='hourly'?'按小时':'固定'} ${laborMoney(facts.nightSubsidyAmount)}`:'未配置夜班补贴',facts.wageSettlementMode==='complete-unit'?`每 ${laborNumber(facts.settlementUnit,2)}h 完整结算${facts.bonusMode==='none'?' · 无额外补贴':' · 已配置补贴门槛'}`:facts.bonusMode==='none'?'按实际时长 · 无额外补贴':'按实际时长 · 已配置补贴门槛'];groups.forEach((group,index)=>{const summary=group.querySelector('summary small');if(summary)summary.textContent=values[index]||summary.textContent;});
}

function updateOvertimePreview(form) {
  const preview=form.querySelector('#labor-overtime-preview');if(!preview)return;
  try{const facts=readOvertimeForm(form),started=performance.now(),analysis=analyzeOvertime(facts);overtimeRuntime.analysisRuns+=1;updateOvertimeFoldSummaries(form,facts);const rateHelp=normalRateExplanation(facts),rateHelpNode=form.querySelector('[data-normal-rate-help]');if(rateHelpNode){rateHelpNode.textContent=rateHelp.text;rateHelpNode.classList.toggle('incomplete',rateHelp.incomplete);}const records=(state.data.overtimeStatusRecords||[]).filter((item)=>item.decisionDate===facts.date);if(state.overtimeViewHours!=null){state.overtimeViewHours=Math.max(0,Math.min(analysis.input.maxHours,Math.round(Number(state.overtimeViewHours)*2)/2));analysis.viewPoint=overtimeAnalysisPoint(analysis,state.overtimeViewHours);}const inspectionHours=analysis.viewPoint?.hours??analysis.selected.hours,inspectionRange=form.querySelector('[data-paired-range="inspectionHours"]'),inspectionNumber=form.querySelector('[data-paired-number="inspectionHours"]');if(inspectionRange){inspectionRange.max=String(analysis.input.maxHours);inspectionRange.value=String(inspectionHours);}if(inspectionNumber){inspectionNumber.max=String(analysis.input.maxHours);inspectionNumber.value=String(inspectionHours);}form.querySelectorAll('[data-overtime-rate]').forEach((card)=>{const rate=Number(card.dataset.overtimeRate);card.classList.toggle('active',Math.abs(rate-Number(analysis.input.multiplier))<.001);const amount=card.querySelector('b');if(amount)amount.textContent=laborMoney(Number(analysis.input.normalHourlyRate||0)*rate);});overtimeRuntime={...overtimeRuntime,analysis,facts,statusRecords:records,signature:overtimeAiSignature(facts,analysis,records),lastAnalysisMs:performance.now()-started};preview.innerHTML=overtimeAnalysisHtml(analysis,records);preview.dataset.analysisRuns=String(overtimeRuntime.analysisRuns);preview.dataset.viewUpdates=String(overtimeRuntime.viewUpdates);}catch(error){preview.innerHTML=`<div class="warning">${esc(error.message)}</div>`;}
}

const OVERTIME_FIELD_HELP = [
  ['normalWage','正常工资','与“正常计薪工时”对应的正常工资总额，建议不含加班费、奖金和补贴。'],['normalPaidHours','正常计薪工时','这笔正常工资覆盖的正常计薪小时数。两项同时填写时，正常时薪 = 正常工资 ÷ 正常计薪工时。'],['normalHourlyRate','正常时薪','正常工作每小时的工资基准，可直接填写，也可由正常工资和正常计薪工时反推。'],['totalMultiplier','加班总倍率','加班时薪 ÷ 正常时薪。例如正常时薪 20 元、加班时薪 30 元，总倍率为 1.5。'],['overtimeHourlyRate','加班时薪','每个可结算加班小时的报酬，与总倍率是同一报酬的两种表示。'],['overtimePremium','加班溢价','实际增量收入减去同等时长的正常工资基准。例如 23−20=3 元溢价。'],['actualIncrementalIncome','实际增量收入','因为加班而额外获得的工资、夜班补贴与门槛补贴之和。'],['cashNetValue','净现金收益','实际增量收入减去打车、外卖、其他一次性费用及随时长变化的费用。'],['actualOccupiedHours','实际额外占用时间','加班时长加上额外通勤、等待等仅因加班产生的时间。'],['actualNetHourly','实际额外净时薪','净现金收益 ÷ 实际额外占用时间；0 小时或分母为 0 时不计算。'],['minimumAcceptableHourly','最低接受净时薪','你当前愿意为额外付出接受的最低每小时净回报，不等于正常时薪。'],['minimumAcceptableReturn','最低接受回报','最低接受净时薪 × 实际额外占用时间。'],['restValuePerHour','自由时间价值','你对被占用自由时间的主观经济估值，只影响综合净价值，不改变现金收入。'],['comprehensiveValue','综合净价值','净现金收益减去自由时间机会成本和疲劳成本估算。'],['fatigueCoefficient','疲劳成本系数','旧版兼容的二次经济估算参数 k；疲劳成本 = k × 加班小时² ÷ 2。它不是医学标准。'],['fatigue','疲劳程度','用户真实记录的 0～100 主观评分，不会自动换算为金钱。'],['willingness','继续加班意愿','用户真实记录的 0～100 主观意愿，可与疲劳同时独立变化。'],['nightSubsidy','夜班补贴','独立于加班工资的固定或按小时补贴，只在加班时计入。'],['settlementUnit','结算单位','工资按完整单位结算时使用的小时单位；未满部分按所选规则处理。'],['bonusThreshold','补贴门槛','达到指定有效时长后才计入的一次性或分档补贴，未达门槛不会提前计入。'],
];

function overtimeHelpButton(key='all') { return `<button class="field-help-button" type="button" data-overtime-help="${key}" aria-label="查看字段说明" title="查看字段说明">?</button>`; }

function overtimeHelpBody(key='all') {
  const items=key==='all'?OVERTIME_FIELD_HELP:OVERTIME_FIELD_HELP.filter(([id])=>id===key);return `<p class="subtle">字段口径来自当前确定性计算模型；主观疲劳评分不会直接换算为金钱。</p><div class="overtime-help-list">${items.map(([id,label,text])=>`<article id="help-${id}"><h4>${esc(label)}</h4><p>${esc(text)}</p></article>`).join('')}</div>`;
}

function overtimeDetailBody(key, point, facts, analysis) {
  const custom=(facts.customExpenses||[]).map((item)=>`${esc(item.name||'自定义消费')} ${laborMoney(point.hours>0?item.amount:0)}`).join('、')||'无';const rows={actualIncrementalIncome:[['加班工资',laborMoney(point.overtimeWage)],['夜班补贴',laborMoney(point.nightSubsidy)],['结算补贴',laborMoney(point.settlementBonus)],['公式','加班工资 + 夜班补贴 + 结算补贴']],overtimePremium:[['实际增量收入',laborMoney(point.actualIncrementalIncome)],['正常工资基准',laborMoney(point.normalPayBaseline)],['公式','实际增量收入 − 同等时长正常工资基准']],cashNetValue:[['实际增量收入',laborMoney(point.actualIncrementalIncome)],['一次性费用',laborMoney(point.fixedCost)],['随时长费用',laborMoney(point.variableCost)],['自定义消费',custom],['公式','实际增量收入 − 额外现金支出']],actualNetHourly:[['净现金收益',laborMoney(point.cashNetValue)],['加班时长',`${laborNumber(point.hours,2)} 小时`],['额外通勤及等待',`${laborNumber(Math.max(0,point.actualOccupiedHours-point.hours),2)} 小时`],['公式','净现金收益 ÷ 实际额外占用时间']],comprehensiveValue:[['净现金收益',laborMoney(point.cashNetValue)],['自由时间机会成本',laborMoney(point.restOpportunityCost)],['疲劳成本估算',laborMoney(point.fatigueCost)],['公式','净现金收益 − 自由时间机会成本 − 疲劳成本估算']]};const labels={actualIncrementalIncome:'实际增量收入',overtimePremium:'加班溢价',cashNetValue:'净现金收益',actualNetHourly:'实际额外净时薪',comprehensiveValue:'综合净价值'};const values={actualIncrementalIncome:point.actualIncrementalIncome,overtimePremium:point.overtimePremium,cashNetValue:point.cashNetValue,actualNetHourly:point.actualNetHourly,comprehensiveValue:point.comprehensiveValue};return `<div class="drawer-fact-head"><span>${laborNumber(point.hours,2)} 小时节点</span><h4>${labels[key]||'计算明细'} · ${values[key]==null?'—':laborMoney(values[key])}</h4><p>以下全部读取当前计算快照，不单独重算。</p></div><dl class="drawer-facts">${(rows[key]||[]).map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><div class="warning">正常工资基准只用于比较溢价，不会重复加入实际增量收入。</div>`;
}

function openTransientDrawer(drawer) { state.drawer={...drawer,dirty:false,transient:true};document.querySelector('.drawer-backdrop')?.remove();app.insertAdjacentHTML('beforeend',renderDrawer()); }

function updateOvertimeViewDom(form) {
  const analysis=overtimeRuntime.analysis;if(!analysis)return updateOvertimePreview(form);const point=overtimeAnalysisPoint(analysis,state.overtimeViewHours??analysis.selected.hours);analysis.viewPoint=point;state.overtimeViewHours=point.hours;overtimeRuntime.viewUpdates+=1;overtimeRuntime.signature=overtimeAiSignature(overtimeRuntime.facts,analysis,overtimeRuntime.statusRecords);setPairedValue(form,'inspectionHours',point.hours);const top=form.querySelector('[data-overtime-result-top]'),bottom=form.querySelector('[data-overtime-result-bottom]'),aiHost=form.querySelector('[data-overtime-ai-host]'),preview=form.querySelector('#labor-overtime-preview');if(top)top.innerHTML=overtimeResultTopHtml(analysis);if(bottom)bottom.innerHTML=overtimeResultBottomHtml(analysis,overtimeRuntime.statusRecords);if(aiHost)aiHost.innerHTML=overtimeAiHtml();if(preview){preview.dataset.analysisRuns=String(overtimeRuntime.analysisRuns);preview.dataset.viewUpdates=String(overtimeRuntime.viewUpdates);}const width=760,left=62,right=24,x=left+point.hours*(width-left-right)/Math.max(.5,Number(analysis.input.maxHours)||12);form.querySelectorAll('[data-overtime-view-line]').forEach((line)=>{line.setAttribute('x1',x);line.setAttribute('x2',x);});form.querySelectorAll('[data-overtime-view-label]').forEach((label)=>{label.setAttribute('x',Math.min(width-right-4,x+5));label.textContent=`查看 ${laborNumber(point.hours,2)}h`;});
}

function updateOvertimeInspection(target) {
  const form=target.closest('#labor-overtime-form');if(!form)return false;const name=target.dataset?.pairedRange||target.dataset?.pairedNumber;if(name!=='inspectionHours')return false;syncPairedControl(target);const max=Math.max(.5,Math.round((Number(form.elements.maxHours?.value)||12)*2)/2),raw=Math.max(0,Math.min(max,Number(form.elements.inspectionHours?.value)||0)),hours=Math.round(raw*2)/2;state.overtimeViewHours=hours;setPairedValue(form,'inspectionHours',hours);if(overtimeViewFrame)cancelAnimationFrame(overtimeViewFrame);overtimeViewFrame=requestAnimationFrame(()=>{overtimeViewFrame=null;if(form.isConnected)updateOvertimeViewDom(form);});return true;
}

async function generateOvertimeAi(button) {
  if(overtimeRuntime.aiPending)return false;
  const requestId=overtimeRuntime.aiRequestId+1,requestSignature=overtimeRuntime.signature,form=button.closest('#labor-overtime-form');
  overtimeRuntime.aiRequestId=requestId;overtimeRuntime.aiPending=true;overtimeRuntime.aiError='';
  const refreshHost=()=>{const host=form?.isConnected?form.querySelector('[data-overtime-ai-host]'):document.querySelector('#labor-overtime-form [data-overtime-ai-host]');if(host)host.innerHTML=overtimeAiHtml();};
  refreshHost();
  try {
    if(!overtimeRuntime.analysis||!overtimeRuntime.facts)throw new Error('请先完成当前试算');
    const credentials=radarCredentials.getCredentials(),config=radarCredentials.getConfig();if(!credentials.deepseekApiKey)throw new Error('请先在 Settings 配置 DeepSeek API Key');
    const analysis=overtimeRuntime.analysis,viewed=analysis.viewPoint||analysis.selected,latestStatuses=overtimeRuntime.statusRecords.slice().sort((a,b)=>String(b.observedAt||b.createdAt).localeCompare(String(a.observedAt||a.createdAt))).slice(0,12);
    const payload={decisionDate:overtimeRuntime.facts.date,input:{normalHourlyRate:analysis.input.normalHourlyRate,overtimeHourlyRate:analysis.input.overtimeHourlyRate,multiplier:analysis.input.multiplier,selectedHours:analysis.selected.hours,minimumAcceptableHourly:analysis.input.minimumAcceptableHourly,restValuePerHour:analysis.input.restValuePerHour,fatigueCoefficient:analysis.input.fatigueCoefficient,wageSettlementMode:analysis.input.wageSettlementMode,settlementUnit:analysis.input.settlementUnit,partialUnitRule:analysis.input.partialUnitRule,bonusMode:analysis.input.bonusMode,bonusThresholdHours:analysis.input.bonusThresholdHours,bonusThresholdAmount:analysis.input.bonusThresholdAmount},current:viewed,nodes:analysis.nodes,acceptableRanges:analysis.acceptableRanges,noAcceptableOvertime:analysis.noAcceptableOvertime,suggestions:overtimeSuggestions(analysis,overtimeRuntime.statusRecords),statusRecords:latestStatuses.map(({hours,fatigue,willingness,reasons,decision,note,observedAt})=>({hours,fatigue,willingness,reasons,decision,note,observedAt}))};
    const provider=new RemoteRadarProvider({...credentials,modelId:config.modelId}),result=await provider.analyzeOvertime(payload),text=String(result.analysis||'').trim();if(!text)throw new Error('AI 未返回有效分析');
    if(requestId!==overtimeRuntime.aiRequestId||requestSignature!==overtimeRuntime.signature){overtimeRuntime.aiError='试算参数已更新，本次返回未应用，请重新生成';toast(overtimeRuntime.aiError,'error');return false;}
    overtimeRuntime.ai={text,signature:requestSignature,createdAt:now(),modelId:result.modelId||config.modelId};overtimeRuntime.aiError='';toast('分析生成成功');return true;
  } catch(error) {
    if(requestId===overtimeRuntime.aiRequestId){overtimeRuntime.aiError=String(error?.message||'未知错误');toast(`AI 分析失败：${overtimeRuntime.aiError}`,'error');}
    return false;
  } finally {
    if(requestId===overtimeRuntime.aiRequestId)overtimeRuntime.aiPending=false;
    refreshHost();
  }
}

function setPairedValue(form,name,value) {
  const numberInput=form.querySelector(`[data-paired-number="${name}"]`),range=form.querySelector(`[data-paired-range="${name}"]`);if(numberInput)numberInput.value=String(Math.round(Number(value)*10000)/10000);if(range){if(Number(value)>Number(range.max)){range.max=String(value);if(numberInput)numberInput.max=String(value);}range.value=String(value);}
}

function syncPairedControl(target) {
  const name=target.dataset?.pairedRange||target.dataset?.pairedNumber;if(!name)return;const form=target.closest('form');if(!form)return;const range=form.querySelector(`[data-paired-range="${name}"]`),numberInput=form.querySelector(`[data-paired-number="${name}"]`);if(target===range&&numberInput)numberInput.value=range.value;else if(target===numberInput&&range&&numberInput.value!==''){const value=Number(numberInput.value);if(Number.isFinite(value)){if(value>Number(range.max)){range.max=String(value);numberInput.max=String(value);}range.value=String(value);}}
  if(form.id==='overtime-status-form'&&numberInput?.value!==''){let value=Number(numberInput.value);if(name==='hours')value=Math.round(value*2)/2;if(['fatigue','willingness'].includes(name))value=Math.round(value);value=Math.max(Number(numberInput.min||0),Math.min(Number(numberInput.max||Number.MAX_SAFE_INTEGER),value));numberInput.value=String(value);if(range)range.value=String(value);}
  if(form.id!=='labor-overtime-form')return;const mode=form.elements.overtimeRateMode;const get=(field)=>Number(form.elements[field]?.value||0);let normal=get('baseHourlyRate');if(get('normalWage')>0&&get('normalPaidHours')>0){normal=get('normalWage')/get('normalPaidHours');setPairedValue(form,'baseHourlyRate',normal);}if(name==='overtimeHourlyRate'){mode.value='hourly';if(normal>0)setPairedValue(form,'multiplier',get('overtimeHourlyRate')/normal);}else if(name==='multiplier'){mode.value='multiplier';setPairedValue(form,'overtimeHourlyRate',normal*get('multiplier'));}else if(['normalWage','normalPaidHours','baseHourlyRate'].includes(name)){if(mode.value!=='hourly')setPairedValue(form,'overtimeHourlyRate',normal*get('multiplier'));else if(normal>0)setPairedValue(form,'multiplier',get('overtimeHourlyRate')/normal);}
}

function readOvertimeStatusForm(form) {
  const fd=new FormData(form);const optionalScore=(name)=>{const raw=String(fd.get(name)??'').trim();if(raw==='')return null;const value=Number(raw);if(!Number.isFinite(value)||value<0||value>100)throw new Error(`${name==='fatigue'?'疲劳程度':'继续加班意愿'}必须在 0～100 之间`);return Math.round(value);};const hours=Number(fd.get('hours'));if(!Number.isFinite(hours)||hours<0||hours>744||Math.abs(hours*2-Math.round(hours*2))>1e-9)throw new Error('当前加班时长必须以 0.5 小时为步长');const observedAt=new Date(String(fd.get('observedAt')||''));if(Number.isNaN(observedAt.getTime()))throw new Error('记录时间无效');return {decisionDate:String(fd.get('decisionDate')||localDateKey()),hours,fatigue:optionalScore('fatigue'),willingness:optionalScore('willingness'),reasons:fd.getAll('reason').map(String),decision:String(fd.get('decision')||''),note:String(fd.get('note')||'').trim(),observedAt:observedAt.toISOString()};
}

function syncOvertimeDuration(form,target,{commit=false}={}) {
  const range=form.querySelector('[data-overtime-range]'),numberInput=form.elements.durationValue,maxInput=form.elements.maxHours;if(!range||!numberInput)return;
  const max=Math.max(.5,Math.round((Number(maxInput?.value)||12)*2)/2);range.max=String(max);numberInput.max=String(max);
  if(target===range)numberInput.value=range.value;
  else {const raw=Math.max(0,Math.min(max,Number(numberInput.value)||0)),snapped=Math.round(raw*2)/2;range.value=String(snapped);if(commit||target===maxInput||target===numberInput)numberInput.value=String(snapped);}
}

function readForecastForm(form) {
  const facts=laborFormFacts(form,['startSavings','monthlyIncome','monthlySpending','necessaryLiving','safetyMonths','months','annualIncomeGrowth','annualSpendingGrowth']);Object.keys(facts).forEach((key)=>facts[key]=Number(facts[key]||0));return facts;
}

function updateForecastPreview(form) {
  const preview=form.querySelector('#labor-forecast-preview');if(!preview)return;try{preview.innerHTML=forecastHtml(readForecastForm(form));}catch(error){preview.innerHTML=`<div class="warning">${esc(error.message)}</div>`;}
}

function readJobForm(form) {
  const facts=laborFormFacts(form,['date','name','candidateBasis','candidateSalary','candidateAfterTaxEstimate','candidateDays','candidateDailyHours','candidateOvertimeHours','candidateCommuteDaily','candidateTransport','candidateLivingDelta','candidateOtherCost','note']);['candidateSalary','candidateAfterTaxEstimate','candidateDays','candidateDailyHours','candidateOvertimeHours','candidateCommuteDaily','candidateTransport','candidateLivingDelta','candidateOtherCost'].forEach((key)=>facts[key]=Number(facts[key]||0));facts.name=String(facts.name||'').trim();facts.note=String(facts.note||'').trim();return facts;
}

function updateJobPreview(form) {
  const preview=form.querySelector('#labor-job-preview');if(!preview)return;try{const facts=readJobForm(form);const hasCandidate=Boolean(facts.candidateSalary||facts.candidateAfterTaxEstimate);preview.innerHTML=jobComparisonHtml(compareJobs(laborCurrentJobInput(facts)),hasCandidate);}catch(error){preview.innerHTML=`<div class="warning">${esc(error.message)}</div>`;}
}

async function saveLaborParameters(patch, message='计算参数已保存') {
  const timestamp=now();const old=state.data.laborParameters.find((item)=>item.id==='default');const facts={...(old?.facts||{}),...patch};await storage.put('laborParameters',{id:'default',facts,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});transientDirtyForms.delete('labor-parameters-form');transientDirtyForms.delete('labor-forecast-form');await refresh(message);
}

async function handleAppClick(e) {
  if(e.target.closest('[data-toggle-main-nav]')){state.mainNavCollapsed=!state.mainNavCollapsed;if(state.mainNavCollapsed)state.openNavGroup=null;render();return;}
  const contentToggle=e.target.closest('[data-toggle-content-sidebar]');if(contentToggle){const key=contentToggle.dataset.toggleContentSidebar;state.contentSidebarCollapsed[key]=!state.contentSidebarCollapsed[key];render();return;}
  const settingsSection=e.target.closest('[data-settings-section]');if(settingsSection){if(!confirmEditorExit())return;state.settingsSection=settingsSection.dataset.settingsSection;render();return;}
  const radarProfileButton=e.target.closest('[data-select-radar-profile]');if(radarProfileButton){selectRadarProfile(radarProfileButton.dataset.selectRadarProfile);render();return;}
  if(e.target.closest('[data-open-radar-history]')){state.drawer={type:'radar-history',dirty:false};render();return;}
  const navGroup=e.target.closest('[data-nav-group]'); if(navGroup){if(!confirmEditorExit())return;if(state.mainNavCollapsed){state.mainNavCollapsed=false;state.openNavGroup=navGroup.dataset.navGroup;render();return;}const group=navGroup.dataset.navGroup;state.openNavGroup=state.openNavGroup===group?null:group;render();document.querySelector(`[data-nav-group="${group}"]`)?.focus();return;}
  const nav=e.target.closest('[data-nav]'); if(nav){if(!confirmEditorExit())return;if(state.route==='notes')await flushNoteDraft();if(state.route==='templates'){state.templateEditing=false;transientDirtyForms.delete('template-inline-form');}persistNotesUi(nav.dataset.nav==='notes');state.route=nav.dataset.nav;if(PERSONAL_ROUTES.has(state.route))state.openNavGroup='personal';if(state.route==='playground')state.playgroundView='list';state.search='';state.drawer=null;render();window.scrollTo({top:0});return;}
  const laborTab=e.target.closest('[data-labor-tab]');if(laborTab){if(!confirmEditorExit())return;state.laborTab=laborTab.dataset.laborTab;state.laborEditingOvertimeId=null;state.laborEditingOvertimeStatusId=null;state.overtimeViewHours=null;state.laborEditingJobId=null;render();return;}
  const overtimeHelp=e.target.closest('[data-overtime-help]');if(overtimeHelp){e.preventDefault();openTransientDrawer({type:'overtime-help',helpKey:overtimeHelp.dataset.overtimeHelp||'all'});return;}
  const overtimeDetail=e.target.closest('[data-overtime-detail]');if(overtimeDetail&&overtimeRuntime.analysis){const point=overtimeRuntime.analysis.viewPoint||overtimeRuntime.analysis.selected;openTransientDrawer({type:'overtime-detail',detailKey:overtimeDetail.dataset.overtimeDetail,point:{...point},facts:structuredClone(overtimeRuntime.facts),analysis:overtimeRuntime.analysis});return;}
  const overtimeAi=e.target.closest('[data-generate-overtime-ai]');if(overtimeAi){await runOperationLocked('overtime:ai-analysis',overtimeAi,()=>generateOvertimeAi(overtimeAi),'正在生成分析……');return;}
  const addOvertimeExpense=e.target.closest('[data-add-overtime-expense]');if(addOvertimeExpense){const form=addOvertimeExpense.closest('#labor-overtime-form'),list=form?.querySelector('[data-overtime-expenses]');if(list){list.querySelector('.overtime-expense-empty')?.remove();list.insertAdjacentHTML('beforeend',overtimeExpenseRow({id:uid('expense'),name:'',amount:0},list.children.length));transientDirtyForms.add(form.id);updateOvertimePreview(form);}return;}
  const removeOvertimeExpense=e.target.closest('[data-remove-overtime-expense]');if(removeOvertimeExpense){const form=removeOvertimeExpense.closest('#labor-overtime-form'),row=removeOvertimeExpense.closest('.overtime-expense-row'),list=row?.parentElement;row?.remove();if(list&&!list.querySelector('.overtime-expense-row'))list.innerHTML='<p class="subtle overtime-expense-empty">暂无自定义消费。</p>';if(form){transientDirtyForms.add(form.id);updateOvertimePreview(form);}return;}
  const addOvertimeTier=e.target.closest('[data-add-overtime-tier]');if(addOvertimeTier){const form=addOvertimeTier.closest('#labor-overtime-form'),list=form?.querySelector('[data-overtime-tiers]');if(list){list.querySelector('.overtime-tier-empty')?.remove();list.insertAdjacentHTML('beforeend',overtimeBonusTierRow({id:uid('tier'),hours:.5,amount:0},list.children.length));transientDirtyForms.add(form.id);updateOvertimePreview(form);}return;}
  const removeOvertimeTier=e.target.closest('[data-remove-overtime-tier]');if(removeOvertimeTier){const form=removeOvertimeTier.closest('#labor-overtime-form'),row=removeOvertimeTier.closest('.overtime-tier-row'),list=row?.parentElement;row?.remove();if(list&&!list.querySelector('.overtime-tier-row'))list.innerHTML='<p class="subtle overtime-tier-empty">多档补贴尚未添加。</p>';if(form){transientDirtyForms.add(form.id);updateOvertimePreview(form);}return;}
  const overtimeSeries=e.target.closest('[data-toggle-overtime-series]');if(overtimeSeries){const key=overtimeSeries.dataset.toggleOvertimeSeries;const hidden=new Set(state.overtimeHiddenSeries);hidden.has(key)?hidden.delete(key):hidden.add(key);if(hidden.size>=5)hidden.delete(key);state.overtimeHiddenSeries=[...hidden];const form=overtimeSeries.closest('#labor-overtime-form'),preview=form?.querySelector('#labor-overtime-preview');if(preview&&overtimeRuntime.analysis)preview.innerHTML=overtimeAnalysisHtml(overtimeRuntime.analysis,overtimeRuntime.statusRecords);return;}
  const overtimePoint=e.target.closest('[data-view-overtime-hours]');if(overtimePoint){state.overtimeViewHours=Number(overtimePoint.dataset.viewOvertimeHours);const form=document.querySelector('#labor-overtime-form');if(form)updateOvertimeViewDom(form);return;}
  const printOvertime=e.target.closest('[data-print-overtime]');if(printOvertime){const form=printOvertime.closest('#labor-overtime-form');if(!form)throw new Error('未找到当前加班试算');printOvertimeReport(form);return;}
  const laborPoint=e.target.closest('[data-labor-record]');if(laborPoint){const store=laborPoint.dataset.laborStore;if(store==='salaryRecords')openDrawer('edit-salary',laborPoint.dataset.laborRecord);if(store==='livingRecords')openDrawer('edit-living',laborPoint.dataset.laborRecord);return;}
  const editSalary=e.target.closest('[data-edit-salary]');if(editSalary){openDrawer('edit-salary',editSalary.dataset.editSalary);return;}
  const editLiving=e.target.closest('[data-edit-living]');if(editLiving){openDrawer('edit-living',editLiving.dataset.editLiving);return;}
  const editOvertime=e.target.closest('[data-edit-overtime]');if(editOvertime){if(!confirmEditorExit())return;state.laborEditingOvertimeId=editOvertime.dataset.editOvertime;render();return;}
  const viewOvertime=e.target.closest('[data-view-overtime]');if(viewOvertime){state.drawer={type:'view-overtime',id:viewOvertime.dataset.viewOvertime,dirty:false};render();return;}
  const editOvertimeStatus=e.target.closest('[data-edit-overtime-status]');if(editOvertimeStatus){if(!confirmEditorExit())return;state.laborEditingOvertimeStatusId=editOvertimeStatus.dataset.editOvertimeStatus;render();return;}
  if(e.target.closest('[data-cancel-overtime-status]')){if(!confirmEditorExit())return;state.laborEditingOvertimeStatusId=null;render();return;}
  const deleteOvertimeStatus=e.target.closest('[data-delete-overtime-status]');if(deleteOvertimeStatus){if(confirm('确定删除这条状态记录吗？')){await storage.delete('overtimeStatusRecords',deleteOvertimeStatus.dataset.deleteOvertimeStatus);if(state.laborEditingOvertimeStatusId===deleteOvertimeStatus.dataset.deleteOvertimeStatus)state.laborEditingOvertimeStatusId=null;await refresh('状态记录已删除');}return;}
  if(e.target.closest('[data-cancel-overtime-edit]')){if(!confirmEditorExit())return;state.laborEditingOvertimeId=null;render();return;}
  const editJob=e.target.closest('[data-edit-job]');if(editJob){if(!confirmEditorExit())return;state.laborEditingJobId=editJob.dataset.editJob;render();return;}
  if(e.target.closest('[data-cancel-job-edit]')){if(!confirmEditorExit())return;state.laborEditingJobId=null;render();return;}
  const deleteLabor=e.target.closest('[data-delete-labor]');if(deleteLabor){const [store,id]=deleteLabor.dataset.deleteLabor.split(':');const allowed=new Set(['salaryRecords','overtimeDecisions','livingRecords','jobComparisons']);if(!allowed.has(store))throw new Error('未知记录类型');if(confirm('确定删除这条边际价值记录吗？原始事实与计算快照都会删除。')){await storage.delete(store,id);if(state.laborEditingOvertimeId===id)state.laborEditingOvertimeId=null;if(state.laborEditingJobId===id)state.laborEditingJobId=null;await refresh('记录已删除');}return;}
  const openArtwork=e.target.closest('[data-playground-open]'); if(openArtwork){state.playgroundView=openArtwork.dataset.playgroundOpen;render();window.scrollTo({top:0});return;}
  if(e.target.closest('[data-playground-back]')){state.playgroundView='list';render();window.scrollTo({top:0});return;}
  const retryArtwork=e.target.closest('[data-playground-retry]'); if(retryArtwork){mountArtwork(retryArtwork.dataset.playgroundRetry);return;}
  const open=e.target.closest('[data-open]'); if(open){openDrawer(open.dataset.open,open.dataset.open==='edit-radar-profile'?state.radarProfileId:null); return;}
  if(e.target.closest('[data-close]') || e.target.classList.contains('drawer-backdrop')){closeDrawer();return;}
  const editCapture=e.target.closest('[data-edit-capture]'); if(editCapture){openDrawer('edit-capture',editCapture.dataset.editCapture);return;}
  const completeCapture=e.target.closest('[data-complete-capture]'); if(completeCapture){const item=state.data.captures.find((entry)=>entry.id===completeCapture.dataset.completeCapture);if(item){const timestamp=now();await storage.put('captures',{...item,status:'completed',completedAt:timestamp,updatedAt:timestamp});await refresh();toast('暂存已完成，24 小时后自动清理','',{label:'撤销',dataset:{undoCapture:item.id}});}return;}
  const undoCapture=e.target.closest('[data-undo-capture]'); if(undoCapture){const item=state.data.captures.find((entry)=>entry.id===undoCapture.dataset.undoCapture);if(item){await storage.put('captures',{...item,status:'pending',completedAt:'',updatedAt:now()});await refresh('已恢复为待处理');}return;}
  const convertCapture=e.target.closest('[data-convert-capture]'); if(convertCapture){const capture=state.data.captures.find((item)=>item.id===convertCapture.dataset.convertCapture);if(!capture)return;const todoId=`todo_from_${capture.id}`;const existing=state.data.todos.find((item)=>item.id===todoId||item.sourceCaptureId===capture.id);if(!existing){const timestamp=now();await storage.put('todos',{id:todoId,title:capture.content.split(/\n/)[0].slice(0,160),notes:capture.content.includes('\n')?capture.content.split(/\n/).slice(1).join('\n'):'',plannedDate:'',dueDate:'',remindAt:'',status:'pending',sourceCaptureId:capture.id,createdAt:timestamp,updatedAt:timestamp,completedAt:''});}await storage.put('captures',{...capture,status:'completed',convertedTodoId:existing?.id||todoId,completedAt:now(),updatedAt:now()});await refresh(existing?'该暂存已关联到已有待办':'已转为个人待办');return;}
  const deleteCapture=e.target.closest('[data-delete-capture]'); if(deleteCapture&&confirm('确定永久删除这条暂存吗？')){await storage.delete('captures',deleteCapture.dataset.deleteCapture);await refresh('暂存已删除');return;}
  const todoView=e.target.closest('[data-todo-view]'); if(todoView){state.todoView=todoView.dataset.todoView;render();return;}
  const toggleTodo=e.target.closest('[data-toggle-todo]'); if(toggleTodo){const item=state.data.todos.find((entry)=>entry.id===toggleTodo.dataset.toggleTodo);if(item){const completed=item.status!=='completed';const updated={...item,status:completed?'completed':'pending',completedAt:completed?now():'',updatedAt:now()};await storage.put('todos',updated);await syncReminder('todo',updated,completed?'':updated.remindAt);await refresh(completed?'待办已完成':'待办已恢复');}return;}
  const editTodo=e.target.closest('[data-edit-todo]'); if(editTodo){openDrawer('edit-todo',editTodo.dataset.editTodo);return;}
  const postponeTodo=e.target.closest('[data-postpone-todo]'); if(postponeTodo){const item=state.data.todos.find((entry)=>entry.id===postponeTodo.dataset.postponeTodo);if(item){await storage.put('todos',{...item,plannedDate:shiftDate(item.plannedDate,1),updatedAt:now()});await refresh('计划日期已顺延一天');}return;}
  const deleteTodo=e.target.closest('[data-delete-todo]'); if(deleteTodo&&confirm('确定删除这条个人待办吗？关联提醒也会删除。')){await storage.delete('todos',deleteTodo.dataset.deleteTodo);await storage.delete('reminders',reminderId('todo',deleteTodo.dataset.deleteTodo));await refresh('个人待办及关联提醒已删除');return;}
  const calendarShift=e.target.closest('[data-calendar-shift]'); if(calendarShift){const base=new Date(`${state.calendarMonth}-01T12:00:00`);base.setMonth(base.getMonth()+Number(calendarShift.dataset.calendarShift));state.calendarMonth=localDateKey(base).slice(0,7);state.calendarDate=`${state.calendarMonth}-01`;render();return;}
  const calendarDate=e.target.closest('[data-calendar-date]'); if(calendarDate){state.calendarDate=calendarDate.dataset.calendarDate;state.calendarMonth=state.calendarDate.slice(0,7);render();return;}
  const editEvent=e.target.closest('[data-edit-event]'); if(editEvent){openDrawer('edit-event',editEvent.dataset.editEvent);return;}
  const deleteEvent=e.target.closest('[data-delete-event]'); if(deleteEvent&&confirm('确定删除这个日历事件吗？关联提醒也会删除。')){await storage.delete('calendarEvents',deleteEvent.dataset.deleteEvent);await storage.delete('reminders',reminderId('event',deleteEvent.dataset.deleteEvent));state.drawer=null;await refresh('日历事件及关联提醒已删除');return;}
  const reminderAction=e.target.closest('[data-read-reminder],[data-ignore-reminder]'); if(reminderAction){const id=reminderAction.dataset.readReminder||reminderAction.dataset.ignoreReminder;const item=state.data.reminders.find((entry)=>entry.id===id);if(item){await storage.put('reminders',{...item,status:reminderAction.dataset.readReminder?'read':'ignored',updatedAt:now()});await refresh('提醒已处理');}return;}
  const selectTemplate=e.target.closest('[data-select-template]'); if(selectTemplate){if(state.templateEditing&&!confirmEditorExit())return;state.templateEditing=false;transientDirtyForms.delete('template-inline-form');state.templateId=selectTemplate.dataset.selectTemplate;state.templateValues={};render();return;}
  const editTemplate=e.target.closest('[data-edit-template]'); if(editTemplate){state.templateId=editTemplate.dataset.editTemplate;state.templateEditing=true;render();return;}
  if(e.target.closest('[data-cancel-template-edit]')){if(!confirmEditorExit())return;state.templateEditing=false;transientDirtyForms.delete('template-inline-form');render();return;}
  const favoriteTemplate=e.target.closest('[data-favorite-template]'); if(favoriteTemplate){const item=state.data.templates.find((entry)=>entry.id===favoriteTemplate.dataset.favoriteTemplate);if(item){await storage.put('templates',{...item,favorite:!item.favorite,updatedAt:now()});await refresh(item.favorite?'已取消收藏':'已收藏模板');}return;}
  const deleteTemplate=e.target.closest('[data-delete-template]'); if(deleteTemplate&&confirm('确定删除这个模板吗？')){await storage.delete('templates',deleteTemplate.dataset.deleteTemplate);state.templateId=null;state.templateValues={};await refresh('模板已删除');return;}
  const copyTemplate=e.target.closest('[data-copy-template]'); if(copyTemplate){const item=state.data.templates.find((entry)=>entry.id===copyTemplate.dataset.copyTemplate);if(item){await copyText(fillTemplate(item.content,state.templateValues));toast('模板内容已复制');}return;}
  const newNote=e.target.closest('[data-new-note]'); if(newNote){await startNewNote();return;}
  const newPrompt=e.target.closest('[data-new-prompt]'); if(newPrompt){await startNewNote({contentType:'prompt'});return;}
  const selectNote=e.target.closest('[data-select-note]'); if(selectNote){await openNoteEditor(selectNote.dataset.selectNote);return;}
  const openNote=e.target.closest('[data-open-note]'); if(openNote){await openNoteEditor(openNote.dataset.openNote);return;}
  const contentType=e.target.closest('[data-content-type]'); if(contentType){state.categoryType=contentType.dataset.contentType;state.categoryExpandedId=null;render();return;}
  const expandContent=e.target.closest('[data-expand-content]'); if(expandContent){const id=expandContent.dataset.expandContent;state.categoryExpandedId=state.categoryExpandedId===id?null:id;render();return;}
  const editContent=e.target.closest('[data-edit-content]'); if(editContent){await openNoteEditor(editContent.dataset.editContent);return;}
  const copyContent=e.target.closest('[data-copy-content]'); if(copyContent){const note=state.notes.find((item)=>item.id===copyContent.dataset.copyContent);if(!note)throw new Error('未找到要复制的内容');await copyText(note.content);toast('正文已复制');return;}
  const quickTag=e.target.closest('[data-quick-tag]'); if(quickTag){state.categorySearch=quickTag.dataset.quickTag;state.categoryExpandedId=null;render();return;}
  const removeQuickTag=e.target.closest('[data-remove-quick-tag]'); if(removeQuickTag){state.categoryQuickTags=state.categoryQuickTags.filter((tag)=>tag!==removeQuickTag.dataset.removeQuickTag);persistCategoryQuickTags();render();return;}
  if(e.target.closest('[data-add-quick-tag]')){state.categoryTagEditor=true;render();document.querySelector('#quick-tag-input')?.focus();return;}
  if(e.target.closest('[data-cancel-quick-tag]')){state.categoryTagEditor=false;render();return;}
  if(e.target.closest('[data-save-quick-tag]')){const value=String(document.querySelector('#quick-tag-input')?.value||'').trim().slice(0,40);if(!value){toast('请输入快捷搜索词','error');return;}if(!state.categoryQuickTags.includes(value))state.categoryQuickTags=[...state.categoryQuickTags,value].slice(0,20);state.categoryTagEditor=false;persistCategoryQuickTags();render();return;}
  if(e.target.closest('[data-clear-category-search]')){state.categorySearch='';state.categoryExpandedId=null;render();return;}
  const category=e.target.closest('[data-category]'); if(category){state.selectedCategory=category.dataset.category;render();return;}
  const deleteRadar=e.target.closest('[data-delete-radar-profile]'); if(deleteRadar){await deleteRadarProfile(deleteRadar.dataset.deleteRadarProfile);return;}
  if(e.target.closest('[data-explore-new]')){await exploreNew();return;}
  const saveRadar=e.target.closest('[data-save-radar]'); if(saveRadar){await saveRadarToNotes(saveRadar.dataset.saveRadar);return;}
  const task=e.target.closest('[data-task]'); if(task){state.taskId=task.dataset.task;state.taskHistoryTab='activity';state.route='task-detail';render();window.scrollTo({top:0});return;}
  const historyTab=e.target.closest('[data-history-tab]'); if(historyTab){state.taskHistoryTab=historyTab.dataset.historyTab;render();return;}
  const editMember=e.target.closest('[data-edit-member]'); if(editMember){openDrawer('edit-member',editMember.dataset.editMember);return;}
  const addClassification=e.target.closest('[data-classification-add]'); if(addClassification){state.drawer={type:'new-classification',kind:addClassification.dataset.classificationAdd,id:null};render();return;}
  const editClassification=e.target.closest('[data-classification-edit]'); if(editClassification){const [kind,id]=editClassification.dataset.classificationEdit.split(':');state.drawer={type:'edit-classification',kind,id};render();return;}
  const deleteClassification=e.target.closest('[data-classification-delete]'); if(deleteClassification){const [kind,id]=deleteClassification.dataset.classificationDelete.split(':');state.drawer={type:'delete-classification',kind,id};render();return;}
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
}

app.addEventListener('click', async (e) => {
  try {
    const trigger=e.target.closest(WRITE_ACTION_SELECTOR);
    if(trigger)await runOperationLocked(actionOperationKey(trigger),trigger,()=>handleAppClick(e),trigger.matches('[data-delete-labor],[data-delete-overtime-status],[data-delete-capture],[data-delete-todo],[data-delete-event],[data-delete-template],[data-delete-radar-profile],[data-delete-note],[data-delete-member],[data-delete-task]')?'处理中…':'保存中…');
    else await handleAppClick(e);
  } catch(error) { toast(error.message || '操作失败','error'); }
});

app.addEventListener('submit', async (e) => {
  if(!['drawer-form','note-editor-form','capture-form','home-capture-form','todo-quick-form','template-inline-form','labor-overtime-form','overtime-status-form','labor-forecast-form','labor-parameters-form','labor-job-form'].includes(e.target.id))return;
  e.preventDefault();
  try {
    await runOperationLocked(submitOperationKey(e.target),e.target,async()=>{
    if(e.target.id==='drawer-form'){await onSubmit(e.target);if(!state.drawer)transientDirtyForms.delete(e.target.id);}
    else if(e.target.id==='note-editor-form')await saveNoteForm(e.target);
    else if(e.target.id==='template-inline-form'){const fd=new FormData(e.target);const old=state.data.templates.find((item)=>item.id===e.target.dataset.templateId);const title=String(fd.get('title')||'').trim(),content=String(fd.get('content')||'');if(!old||!title||!content.trim())throw new Error('模板标题和正文不能为空');await storage.put('templates',{...old,title,content,category:String(fd.get('category')||'其他').trim()||'其他',favorite:fd.get('favorite')==='on',updatedAt:now()});state.templateEditing=false;state.templateValues={};transientDirtyForms.delete(e.target.id);await refresh('模板已原位更新');}
    else if(e.target.id==='labor-overtime-form'){const facts=readOvertimeForm(e.target);if(!facts.date)throw new Error('请选择决策日期');const snapshot=analyzeOvertime(facts);const old=state.data.overtimeDecisions.find((item)=>item.id===state.laborEditingOvertimeId);const timestamp=now();await storage.put('overtimeDecisions',{id:old?.id||uid('overtime'),facts,snapshot,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});transientDirtyForms.delete(e.target.id);state.laborEditingOvertimeId=null;await refresh(old?'加班决策已更新':'加班决策已保存');}
    else if(e.target.id==='overtime-status-form'){const facts=readOvertimeStatusForm(e.target);const old=state.data.overtimeStatusRecords.find((item)=>item.id===state.laborEditingOvertimeStatusId);const timestamp=now();await storage.put('overtimeStatusRecords',{id:old?.id||uid('overtime-status'),...facts,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});transientDirtyForms.delete(e.target.id);state.laborEditingOvertimeStatusId=null;await refresh(old?'状态记录已更新':'此刻状态已记录');}
    else if(e.target.id==='labor-forecast-form'){const facts=readForecastForm(e.target);forecastSavings(facts);await saveLaborParameters({forecastStartSavings:facts.startSavings,forecastMonthlyIncome:facts.monthlyIncome,forecastMonthlySpending:facts.monthlySpending,forecastNecessaryLiving:facts.necessaryLiving,safetyMonths:facts.safetyMonths,forecastMonths:facts.months,annualIncomeGrowth:facts.annualIncomeGrowth,annualSpendingGrowth:facts.annualSpendingGrowth},'预测假设已保存');}
    else if(e.target.id==='labor-parameters-form'){const fd=new FormData(e.target);const patch={safetyMonths:Number(fd.get('safetyMonths')||0),targetMonthlySavings:Number(fd.get('targetMonthlySavings')||0),bufferRatio:Number(fd.get('bufferRatio')||0),currentCommuteDaily:Number(fd.get('currentCommuteDaily')||0)};salaryTargets({necessaryLiving:0,targetSavings:patch.targetMonthlySavings,bufferRatio:patch.bufferRatio});if(patch.safetyMonths<0||patch.currentCommuteDaily<0||patch.currentCommuteDaily>24)throw new Error('个人参数超出有效范围');await saveLaborParameters(patch);}
    else if(e.target.id==='labor-job-form'){const facts=readJobForm(e.target);if(!facts.date||!facts.name)throw new Error('请填写比较日期和候选工作名称');const snapshot=compareJobs(laborCurrentJobInput(facts));const old=state.data.jobComparisons.find((item)=>item.id===state.laborEditingJobId);const timestamp=now();await storage.put('jobComparisons',{id:old?.id||uid('job'),facts,snapshot,createdAt:old?.createdAt||timestamp,updatedAt:timestamp});transientDirtyForms.delete(e.target.id);state.laborEditingJobId=null;await refresh(old?'工作比较已更新':'工作比较已保存');}
    else if(['capture-form','home-capture-form'].includes(e.target.id)){const content=String(new FormData(e.target).get('content')||'').trim();if(!content)throw new Error('暂存内容不能为空');const timestamp=now();await storage.put('captures',{id:uid('capture'),content,status:'pending',convertedTodoId:'',createdAt:timestamp,updatedAt:timestamp,completedAt:''});transientDirtyForms.delete(e.target.id);e.target.reset();await refresh('已保存到临时暂存');}
    else {const title=String(new FormData(e.target).get('title')||'').trim();if(!title)throw new Error('待办内容不能为空');const timestamp=now();await storage.put('todos',{id:uid('todo'),title,notes:'',plannedDate:'',dueDate:'',remindAt:'',status:'pending',sourceCaptureId:'',createdAt:timestamp,updatedAt:timestamp,completedAt:''});transientDirtyForms.delete(e.target.id);e.target.reset();await refresh('个人待办已添加');}
    });
  } catch(error){toast(error.message || '保存失败','error');}
});
function applySearchInput(input) {
  if(input.id==='category-search'){state.categorySearch=input.value;state.categoryExpandedId=null;render();const next=document.querySelector('#category-search');next?.focus();next?.setSelectionRange(next.value.length,next.value.length);return true;}
  if(['task-search','note-search'].includes(input.id)){state.search=input.value;render();const next=document.querySelector(`#${input.id}`);next?.focus();next?.setSelectionRange(next.value.length,next.value.length);return true;}
  if(input.id==='template-search'){state.templateSearch=input.value;render();const next=document.querySelector('#template-search');next?.focus();next?.setSelectionRange(next.value.length,next.value.length);return true;}
  return false;
}
app.addEventListener('compositionstart',(e)=>{if(['category-search','task-search','note-search','template-search'].includes(e.target.id))composingSearches.add(e.target.id);});
app.addEventListener('compositionend',(e)=>{if(composingSearches.delete(e.target.id))applySearchInput(e.target);});
app.addEventListener('input', (e) => {
  const editor=e.target.closest('#note-editor-form'); if(editor){scheduleNoteDraft(editor);return;}
  if(updateOvertimeInspection(e.target))return;
  syncPairedControl(e.target);
  markTransientEditorDirty(e.target);
  const overtimeForm=e.target.closest('#labor-overtime-form');if(overtimeForm){syncOvertimeDuration(overtimeForm,e.target);updateOvertimePreview(overtimeForm);return;}
  const forecastForm=e.target.closest('#labor-forecast-form');if(forecastForm){updateForecastPreview(forecastForm);return;}
  const jobForm=e.target.closest('#labor-job-form');if(jobForm){updateJobPreview(jobForm);return;}
  if(composingSearches.has(e.target.id)||e.isComposing)return;
  if(applySearchInput(e.target))return;
  if(e.target.matches('[data-template-variable]')){state.templateValues[e.target.dataset.templateVariable]=e.target.value;const template=state.data.templates.find((item)=>item.id===state.templateId);const preview=document.querySelector('#template-preview');if(template&&preview)preview.textContent=fillTemplate(template.content,state.templateValues);return;}
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
  if(updateOvertimeInspection(e.target))return;
  markTransientEditorDirty(e.target);
  const overtimeForm=e.target.closest('#labor-overtime-form');if(overtimeForm){syncOvertimeDuration(overtimeForm,e.target,{commit:true});updateOvertimePreview(overtimeForm);return;}
  const forecastForm=e.target.closest('#labor-forecast-form');if(forecastForm){updateForecastPreview(forecastForm);return;}
  const jobForm=e.target.closest('#labor-job-form');if(jobForm){updateJobPreview(jobForm);return;}
  if(e.target.id==='labor-history-range'){state.laborRange=e.target.value;render();return;}
  if(e.target.id==='labor-trend-metric'){state.laborTrendMetric=e.target.value;render();return;}
  if(e.target.id==='status-filter'){state.status=e.target.value;render();}
  if(e.target.id==='template-category'){state.templateCategory=e.target.value;state.templateId=null;state.templateValues={};render();}
  if(e.target.id==='template-favorites'){state.templateFavorites=e.target.checked;state.templateId=null;state.templateValues={};render();}
  if(e.target.id==='note-category-filter'){await flushNoteDraft();state.selectedCategory=e.target.value;state.noteId=null;state.noteDraft=null;persistNotesUi(true);render();}
  if(e.target.id==='radar-profile-select'){selectRadarProfile(e.target.value);render();}
  if(e.target.id==='remember-radar-keys'&&!e.target.checked){radarCredentials.useSessionOnly();toast('已清除长期保存的 Radar 密钥；当前会话仍可继续使用');}
  if(e.target.id==='handoff-to'){const member=state.data.team.find((m)=>m.id===e.target.value);const hint=document.querySelector('#handoff-confirm');if(hint)hint.textContent=member?`确认后负责人将更新为 ${member.name}；任务状态保持不变，并保存当前快照。`:'请选择接手人。确认时会保存当时任务状态和最新进展快照；完成状态不会改变。';}
  if(e.target.id==='import-data' && e.target.files[0]) await runOperationLocked('import:json',e.target,()=>importData(e.target.files[0]),'导入中…');
});
document.addEventListener('pointerdown',(e)=>pointerActivationGuard.begin(e),true);
document.addEventListener('pointermove',(e)=>pointerActivationGuard.move(e),true);
document.addEventListener('pointerup',(e)=>pointerActivationGuard.end(e),true);
document.addEventListener('pointercancel',()=>pointerActivationGuard.cancel(),true);
document.addEventListener('click',(e)=>{if(pointerActivationGuard.shouldSuppress(e)){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-view-overtime-hours],[data-labor-record]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}if(e.key==='Escape'&&state.drawer)closeDrawer();});
document.querySelector('#toast-region').addEventListener('click',async(e)=>{const button=e.target.closest('[data-undo-capture]');if(!button)return;try{await runOperationLocked(`action:undoCapture:${button.dataset.undoCapture}`,button,async()=>{const item=await storage.get('captures',button.dataset.undoCapture);if(item){await storage.put('captures',{...item,status:'pending',completedAt:'',updatedAt:now()});button.closest('.toast')?.remove();await refresh('已恢复为待处理');}},'处理中…');}catch(error){toast(error.message||'撤销失败','error');}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.route==='notes')flushNoteDraft().catch(()=>{});});
window.addEventListener('beforeunload',(event)=>{persistNotesUi(state.route==='notes');destroyActiveArtwork();if(captureCleanupTimer)clearInterval(captureCleanupTimer);if(hasTransientEdits()){event.preventDefault();event.returnValue='';}});

loadData()
  .then(() => { appLoaded=true; render(); captureCleanupTimer=setInterval(async()=>{const removed=await storage.deleteWhere('captures',(item)=>isExpiredCapture(item));if(removed){state.data.captures=state.data.captures.filter((item)=>!isExpiredCapture(item));if(['home','capture'].includes(state.route)&&!hasTransientEdits()&&!state.drawer)render();}},60000); })
  .catch((error) => {
    app.innerHTML = `<div class="empty"><h2>无法打开本地数据库</h2><p>${esc(error.message)}</p></div>`;
  });
