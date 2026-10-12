const { LocalStorageAdapter, STORES } = window.TaskFlowStorage;
const { NoopNotificationAdapter, NotificationEvents, formatTaskNotification } = window.TaskFlowNotifications;
const { LocalNotesAdapter, MemosNotesAdapter, NotesCredentialStore } = window.TaskFlowNotes;
const { batch: radarBatch } = window.TaskFlowRadar;

const storage = new LocalStorageAdapter();
const notifications = new NoopNotificationAdapter();
const notesCredentials = new NotesCredentialStore();
const app = document.querySelector('#app');
const STATUS = ['Todo', 'Doing', 'Blocked', 'Done'];
const STATUS_LABELS = { Todo: '待办', Doing: '进行中', Blocked: '已阻塞', Done: '已完成' };
const FIELD_LABELS = { status: '任务状态', remark: '备注', next: '下一步行动', blockedReason: '阻塞说明', owner: '负责人' };
const CATEGORIES = ['AI Engineering', 'Company', 'Learning', 'Project', 'Personal'];
const state = { route: 'tasks', taskId: null, noteId: null, noteDraft: null, selectedCategory: 'All', companyId: null, search: '', status: 'All', taskHistoryTab: 'activity', drawer: null, data: {}, notes: [], notesMode: 'Local', notesError: '', memosTest: null, radar: null };
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const dateText = (iso) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const badge = (status) => `<span class="badge ${String(status || 'Todo').toLowerCase()}">${esc(STATUS_LABELS[status] || status || '待办')}</span>`;

async function loadData() {
  await storage.init();
  const entries = await Promise.all(STORES.map(async (name) => [name, await storage.all(name)]));
  state.data = Object.fromEntries(entries);
  await loadNotes();
  state.radar = state.data.radar.find((item) => item.id === 'current') || null;
  if (!state.radar) {
    state.radar = { id: 'current', index: 0, createdAt: now(), items: radarBatch(0) };
    await storage.put('radar', state.radar);
    state.data.radar = [state.radar];
  }
}

function currentNotesAdapter() {
  const config = notesCredentials.getConfig();
  if (config.mode !== 'Memos') return new LocalNotesAdapter(storage);
  return new MemosNotesAdapter({ serverUrl: config.serverUrl, token: notesCredentials.getToken(), apiBase: config.apiBase });
}

async function loadNotes() {
  const config = notesCredentials.getConfig();
  state.notesMode = config.mode === 'Memos' ? 'Memos' : 'Local';
  state.notesError = '';
  try { state.notes = await currentNotesAdapter().list(); }
  catch (error) { state.notes = []; state.notesError = error.message; }
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.querySelector('#toast-region').append(el);
  setTimeout(() => el.remove(), 3200);
}

function shell(content, title, subtitle) {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">TF</div><div><h1>TaskFlow</h1><small>Local workspace</small></div></div>
      <nav class="nav-list" aria-label="主导航">
        ${navButton('radar','◉','Radar')}
        ${navButton('notes','✎','Notes')}
        ${navButton('categories','◇','Categories')}
        ${navButton('tasks','▣','Tasks')}
      </nav>
      <div class="local-note">浏览器本地优先 · Notes：${esc(state.notesMode)}<br><button class="sidebar-settings" data-nav="settings">⚙ Settings</button></div>
    </aside>
    <main class="main"><header class="topbar"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><span class="badge ${state.notesMode === 'Memos' ? 'doing' : 'done'}">${['notes','categories'].includes(state.route) ? esc(state.notesMode) : 'Local'}</span></header>${content}</main>
  </div>${renderDrawer()}`;
}

function navButton(route, icon, label) {
  const active = (state.route === route || (route === 'tasks' && state.route === 'task-detail')) ? 'active' : '';
  return `<button class="nav-btn ${active}" data-nav="${route}"><span class="nav-icon">${icon}</span>${label}</button>`;
}

function taskList() {
  const tasks = [...state.data.tasks]
    .filter((t) => !state.search || `${t.title} ${t.requirement} ${t.ownerName || ''}`.toLowerCase().includes(state.search.toLowerCase()))
    .filter((t) => state.status === 'All' || t.status === state.status)
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = Object.fromEntries(STATUS.map((s) => [s, state.data.tasks.filter((t) => t.status === s).length]));
  return shell(`<section class="page">
    <div class="page-head"><div><h3>任务总览</h3><p>聚焦要求、当前进度与下一步。</p></div><button class="btn primary" data-open="new-task">＋ 新建任务</button></div>
    <div class="stat-row">${STATUS.map((s) => `<div class="card stat"><span>${STATUS_LABELS[s]}</span><b>${counts[s]}</b></div>`).join('')}</div>
    <div class="toolbar"><div class="search"><span>⌕</span><label class="sr-only" for="task-search">搜索任务</label><input id="task-search" class="input" type="search" placeholder="搜索任务、要求或负责人" value="${esc(state.search)}"></div>
      <select id="status-filter" class="select filter" aria-label="状态筛选"><option value="All">全部状态</option>${STATUS.map((s) => `<option value="${s}" ${state.status === s ? 'selected':''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
    <div class="card task-table">${tasks.length ? `<table><thead><tr><th>任务</th><th>状态</th><th>负责人</th><th>下一步</th><th>更新</th></tr></thead><tbody>${tasks.map((t) => `<tr class="click-row" data-task="${t.id}"><td><div class="title-cell">${esc(t.title)}</div><div class="subtle">${esc(t.requirement.slice(0,70))}</div></td><td>${badge(t.status)}</td><td>${esc(t.ownerName || '未分配')}</td><td>${esc(t.next || '—')}</td><td class="subtle">${dateText(t.updatedAt)}</td></tr>`).join('')}</tbody></table>` : empty('还没有匹配的任务','新建一个任务，开始记录进展。')}</div>
  </section>`, 'Tasks', `${state.data.tasks.length} 个任务 · 本地持久化`);
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
    <section class="task-history"><div class="history-tabs" role="tablist" aria-label="任务历史"><button class="history-tab ${showingActivity ? 'active':''}" type="button" role="tab" aria-selected="${showingActivity}" data-history-tab="activity">Activity <span>${activities.length}</span></button><button class="history-tab ${showingActivity ? '':'active'}" type="button" role="tab" aria-selected="${!showingActivity}" data-history-tab="handoffs">交接记录 <span>${handoffs.length}</span></button></div>
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

function noteEditor(note) {
  const isNew = !note || note.id === 'new';
  const draft = isNew ? (state.noteDraft || {}) : note;
  return `<form class="note-workspace-editor" id="note-editor-form" data-note-id="${isNew ? '' : esc(note.id)}">
    <div class="note-editor-toolbar"><span>${isNew ? '新记录' : `更新于 ${dateText(note.updatedAt)}`}</span>${isNew ? '' : `<button type="button" class="btn small danger" data-delete-note="${esc(note.id)}">删除</button>`}</div>
    <input class="note-title-input" name="title" maxlength="160" placeholder="标题（可空）" value="${esc(draft.title || '')}">
    <textarea class="note-body-input" name="content" placeholder="记下此刻的想法…" autofocus>${esc(draft.content || '')}</textarea>
    <footer class="note-editor-footer"><label>Category <select class="select" name="category">${categoryOptions(draft.category || 'Personal')}</select></label><div><span class="save-status subtle">记录优先，之后再整理。</span><button class="btn primary" type="submit">保存 Note</button></div></footer>
  </form>`;
}

function notesPage() {
  const q = state.search.toLowerCase();
  const notes = [...state.notes]
    .filter((n) => state.selectedCategory === 'All' || noteCategory(n) === state.selectedCategory)
    .filter((n) => !q || `${n.title || ''} ${n.content || ''} ${noteCategory(n)}`.toLowerCase().includes(q))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  let selected = state.noteId === 'new' ? { id: 'new', ...state.noteDraft } : state.notes.find((n) => n.id === state.noteId);
  if (!selected && notes.length) { selected = notes[0]; state.noteId = selected.id; }
  const unavailable = state.notesError ? `<div class="warning"><b>${esc(state.notesMode)} 当前不可用：</b>${esc(state.notesError)}</div>` : '';
  return shell(`<section class="page notes-page"><div class="page-head"><div><h3>Notes</h3><p>快速记录，按分类查看；标题可以留空。</p></div><button class="btn primary" data-new-note ${state.notesError ? 'disabled' : ''}>＋ 新建 Note</button></div>${unavailable}
    <div class="notes-workspace card"><aside class="notes-list-pane"><div class="notes-list-tools"><div class="search"><span>⌕</span><label class="sr-only" for="note-search">搜索记录</label><input id="note-search" class="input" type="search" placeholder="搜索记录" value="${esc(state.search)}"></div><select id="note-category-filter" class="select" aria-label="分类筛选"><option value="All">全部分类</option>${categoryOptions(state.selectedCategory)}</select></div><div class="notes-list">${notes.length ? notes.map(noteListItem).join('') : `<div class="empty compact"><b>暂无记录</b><p>新建一条简单记录。</p></div>`}</div></aside><section class="note-editor-pane">${selected ? noteEditor(selected) : empty('选择或新建 Note','编辑区会在这里打开。')}</section></div>
  </section>`, 'Notes', `${state.notes.length} 条记录 · ${state.notesMode}`);
}

function categoriesPage() {
  const groups = CATEGORIES.map((category) => ({ category, notes: state.notes.filter((note) => noteCategory(note) === category).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) }));
  const active = state.selectedCategory === 'All' ? null : groups.find((group) => group.category === state.selectedCategory);
  return shell(`<section class="page"><div class="page-head"><div><h3>Categories</h3><p>分类只用于聚合 Notes；Company 是其中一个分类。</p></div></div>
    <div class="category-grid">${groups.map((group) => `<button class="card category-card ${active?.category === group.category ? 'active' : ''}" data-category="${esc(group.category)}"><span>${esc(group.category)}</span><b>${group.notes.length}</b><small>条记录</small></button>`).join('')}</div>
    <section class="category-notes"><div class="section-title"><h4>${active ? esc(active.category) : '最近记录'}</h4><button class="btn small" data-category="All">查看全部</button></div>${(active ? active.notes : [...state.notes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)).length ? `<div class="category-note-list">${(active ? active.notes : [...state.notes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)).map((note) => `<button data-open-note="${esc(note.id)}"><b>${esc(note.title || note.content?.slice(0, 52) || '未命名记录')}</b><span>${esc(noteCategory(note))} · ${dateText(note.updatedAt)}</span></button>`).join('')}</div>` : `<div class="card">${empty('这个分类还没有记录','在 Notes 中创建或调整一条记录。')}</div>`}</section>
  </section>`, 'Categories', '简单分类 · 与 Notes 共用数据');
}

function radarCard(item) {
  return `<article class="card radar-card"><div class="radar-card-top"><span class="category-chip">${esc(item.domain)}</span><span class="subtle">${esc(item.sourceName)}</span></div><h4>${esc(item.title)}</h4><p>${esc(item.explanation)}</p><div class="radar-why"><b>为什么值得关注</b><span>${esc(item.why)}</span></div><footer><a class="btn small" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a><button class="btn small primary" data-save-radar="${esc(item.id)}">Save Notes</button></footer></article>`;
}

function radarPage() {
  const sections = ['Core Domain', 'Adjacent Fields', 'Unknown Window'];
  return shell(`<section class="page radar-page"><div class="page-head"><div><h3>Current Exploration</h3><p>当前批次会持续保留，直到你主动探索下一批。</p></div><button class="btn primary" data-explore-new>Explore New</button></div><div class="radar-batch-meta"><span>探索批次 ${Number(state.radar?.index || 0) + 1}</span><span>生成于 ${dateText(state.radar?.createdAt || now())}</span><span>共 ${state.radar?.items?.length || 0} 条</span></div>${sections.map((section) => { const items=(state.radar?.items || []).filter((item) => item.section === section); return `<section class="radar-section"><div class="section-title"><h4>${section}</h4><span>${items.length}</span></div><div class="radar-grid">${items.map(radarCard).join('')}</div></section>`; }).join('')}</section>`, 'Radar', '认知探索窗口 · 非随机信息流');
}

function companyList() {
  const companies = state.data.companies.filter((c) => !state.search || c.name.toLowerCase().includes(state.search.toLowerCase())).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return shell(`<section class="page"><div class="page-head"><div><h3>公司吐槽墙</h3><p>以个人原始记录的方式，按公司聚合留言。</p></div><button class="btn primary" data-open="new-company">＋ 添加公司</button></div>
    <div class="toolbar"><div class="search"><span>⌕</span><label class="sr-only" for="company-search">搜索公司</label><input id="company-search" class="input" type="search" placeholder="搜索公司名称" value="${esc(state.search)}"></div></div>
    ${companies.length ? `<div class="company-grid">${companies.map((c) => { const count = state.data.comments.filter((x) => x.companyId === c.id).length; return `<article class="card company-card" data-company="${c.id}"><h4>${esc(c.name)}</h4><div class="company-count"><span>本地留言</span><span><b>${count}</b> 条 →</span></div></article>`; }).join('')}</div>` : `<div class="card">${empty('还没有公司','添加一家公司后即可记录留言。')}</div>`}
  </section>`, '公司吐槽墙', `${state.data.companies.length} 家公司 · 留言仅自己可见`);
}

function companyDetail() {
  const company = state.data.companies.find((c) => c.id === state.companyId);
  if (!company) { state.route = 'companies'; return companyList(); }
  const comments = state.data.comments.filter((c) => c.companyId === company.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return shell(`<section class="page"><button class="back-link" data-nav="companies">← 返回公司列表</button>
    <div class="page-head"><div><h3>${esc(company.name)}</h3><p>${comments.length} 条个人留言 · 内容按原始记录展示</p></div><div><button class="btn primary" data-open="new-comment">＋ 新增留言</button> <button class="btn danger" data-delete-company="${company.id}">删除公司</button></div></div>
    ${comments.length ? `<div class="comment-list">${comments.map((c) => `<article class="card comment"><div class="prose">${esc(c.content)}</div><div class="comment-foot"><time class="subtle">${dateText(c.createdAt)}${c.updatedAt !== c.createdAt ? ' · 已编辑':''}</time><div class="comment-actions"><button class="btn small" data-edit-comment="${c.id}">编辑</button><button class="btn small danger" data-delete-comment="${c.id}">删除</button></div></div></article>`).join('')}</div>` : `<div class="card">${empty('暂无留言','记录一条你的原始观察。')}</div>`}
  </section>`, company.name, `${comments.length} 条留言`);
}

function teamSettings() {
  const members = [...state.data.team].sort((a,b) => a.name.localeCompare(b.name));
  return `<article class="card setting-card"><div class="page-head" style="margin-bottom:10px"><div><h4>Team</h4><p>用于任务负责人和交接选择。</p></div><button class="btn small" data-open="new-member">＋ 添加成员</button></div>
    ${members.length ? `<table><thead><tr><th>姓名</th><th>邮箱</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="subtle">${esc(m.email)}</td><td><button class="btn small" data-edit-member="${m.id}">编辑</button> <button class="btn small danger" data-delete-member="${m.id}">删除</button></td></tr>`).join('')}</tbody></table>` : '<p class="subtle">尚未添加成员。</p>'}
  </article>`;
}

function settingsPage() {
  const config = notesCredentials.getConfig();
  const legacyCount = state.data.comments.length;
  return shell(`<section class="page"><div class="page-head"><div><h3>Settings</h3><p>存储状态、团队和备份。</p></div></div>
    <div class="settings-grid"><article class="card setting-card"><h4>TaskFlow 服务状态</h4><p class="subtle">任务存储与 Notes 存储相互独立。</p><div class="setting-row"><span>Task Storage</span><span class="setting-value ready">Local</span></div><div class="setting-row"><span>Remote Adapter</span><span class="setting-value muted">Not Configured</span></div><div class="setting-row"><span>Email Notification</span><span class="setting-value muted">Not Configured</span></div></article>
      <article class="card setting-card"><h4>数据备份</h4><p class="subtle">覆盖本地 Tasks、Notes、Radar 批次、Team、旧版公司墙及历史记录。导入采用合并策略，相同 ID 保留已有记录；Memos 远端笔记和访问令牌不会导出。</p><div class="import-box"><button class="btn dark" id="export-data">导出本地 JSON</button><label class="btn" for="import-data">导入 JSON</label><input class="sr-only" id="import-data" type="file" accept="application/json,.json"></div><div class="warning" style="margin-top:18px">浏览器存储不是云端备份。file:// 数据可能按浏览器与文件路径隔离，清除站点数据仍会导致丢失。</div></article>
      <article class="card setting-card notes-storage-card"><h4>Notes Storage</h4><div class="setting-row"><span>当前模式</span><span class="setting-value ${config.mode === 'Memos' ? 'remote' : 'ready'}">${esc(config.mode || 'Local')}</span></div>
        <div class="field"><label>Memos Server URL</label><input class="input" id="memos-url" type="url" placeholder="https://memos.example.com" value="${esc(config.serverUrl || '')}"><div class="field-hint">可粘贴设置页链接；连接时会自动提取站点根地址，不会把页面路径或 #fragment 当成 API 路径。</div></div>
        <div class="field"><label>API 版本</label><select class="select" id="memos-api"><option value="auto">自动检测</option><option value="/api" ${config.apiBase === '/api' ? 'selected':''}>26.10 / Latest（/api）</option><option value="/api/v1" ${config.apiBase === '/api/v1' ? 'selected':''}>0.30–0.31（/api/v1）</option></select></div>
        <div class="field"><label>Access Token</label><input class="input" id="memos-token" type="password" autocomplete="off" placeholder="不会回显或写入备份"><div class="field-hint">Token 不进入 URL、日志、源码或 JSON 导出。</div></div>
        <label class="check-row"><input id="remember-token" type="checkbox" ${config.remember ? 'checked':''}> 记住令牌（默认关闭；同源脚本或浏览器扩展可能读取本地凭据）</label>
        <div class="import-box"><button class="btn" data-test-memos>Test Connection</button><button class="btn primary" data-connect-memos>Connect</button>${config.mode === 'Memos' ? '<button class="btn" data-disconnect-memos>切回 Local</button>' : ''}<button class="btn danger" data-clear-memos>Clear Credentials</button></div>
        <div id="memos-test-status" class="field-hint">${state.notesError ? esc(state.notesError) : config.mode === 'Memos' ? `已连接 ${esc(config.serverUrl || '')}；仅操作 TaskFlow 标记的 Memos。` : '未配置时 Local 完整可用。连接测试成功后才可启用 Memos。'}</div>
        <div class="warning">从 file:// 连接远程 Memos 可能被 CORS / Origin: null 策略拒绝。不会要求关闭浏览器安全功能，也不会使用第三方代理。</div>
      </article>
      ${teamSettings()}
      <article class="card setting-card"><h4>旧版公司墙兼容</h4><p class="subtle">原 companies / comments 数据仍完整保留。可复制为 Local Notes；旧数据不会被删除，重复迁移会按固定 ID 跳过。</p><div class="setting-row"><span>旧版留言</span><b>${legacyCount} 条</b></div><div class="import-box"><button class="btn" data-open-legacy-wall>打开旧版公司墙</button><button class="btn" data-migrate-legacy ${legacyCount ? '' : 'disabled'}>复制到 Local Notes</button></div></article>
      <article class="card setting-card"><h4>接口边界</h4><p class="subtle">TaskFlow 继续通过既有 Storage Adapter 访问本地数据，Remote Adapter 预留未删除。Notes 使用独立的 LocalNotesAdapter / MemosNotesAdapter。通知接口仍仅定义 TaskCreated 与 TaskHandedOff，未配置时不模拟发送。</p></article>
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
  if (d.type === 'new-company') { title='添加公司'; submit='添加'; body=`<div class="field"><label>公司名称 <span>*</span></label><input class="input" name="name" required maxlength="120"></div>`; }
  if (d.type === 'new-comment' || d.type === 'edit-comment') { const c=state.data.comments.find((x)=>x.id===d.id); title=d.type==='new-comment'?'新增留言':'编辑留言'; submit=d.type==='new-comment'?'保存留言':'保存修改'; body=`<div class="field"><label>Content <span>*</span></label><textarea class="textarea" name="content" required placeholder="以个人记录的方式写下你的观察">${esc(c?.content||'')}</textarea><div class="field-hint">留言只保存在本地，不代表平台认定的事实。</div></div>`; }
  if (d.type === 'new-member' || d.type === 'edit-member') { const m=state.data.team.find((x)=>x.id===d.id); title=d.type==='new-member'?'添加成员':'编辑成员'; submit='保存成员'; body=`<div class="field"><label>Name <span>*</span></label><input class="input" name="name" required value="${esc(m?.name||'')}"></div><div class="field"><label>Email <span>*</span></label><input class="input" name="email" type="email" required value="${esc(m?.email||'')}"></div>`; }
  return `<div class="drawer-backdrop"><form class="drawer" id="drawer-form"><header class="drawer-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></header><div class="drawer-body">${body}</div><footer class="drawer-foot"><button type="button" class="btn" data-close>取消</button><button class="btn primary" type="submit">${submit}</button></footer></form></div>`;
}

function render() {
  if (state.route === 'radar') app.innerHTML = radarPage();
  if (state.route === 'tasks') app.innerHTML = taskList();
  if (state.route === 'task-detail') app.innerHTML = taskDetail();
  if (state.route === 'notes') app.innerHTML = notesPage();
  if (state.route === 'categories') app.innerHTML = categoriesPage();
  if (state.route === 'companies') app.innerHTML = companyList();
  if (state.route === 'company-detail') app.innerHTML = companyDetail();
  if (state.route === 'settings') app.innerHTML = settingsPage();
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
  if (d.type === 'new-company') { const name=fd.get('name').trim(); if(state.data.companies.some((c)=>c.name.toLowerCase()===name.toLowerCase())) { toast('该公司已存在','error'); return; } await storage.put('companies',{id:uid('company'),name,createdAt:timestamp}); state.drawer=null; await refresh('公司已添加'); }
  if (d.type === 'new-comment') { await storage.put('comments',{id:uid('comment'),companyId:state.companyId,content:fd.get('content').trim(),createdAt:timestamp,updatedAt:timestamp}); state.drawer=null; await refresh('留言已保存'); }
  if (d.type === 'edit-comment') { const c=state.data.comments.find((x)=>x.id===d.id); await storage.put('comments',{...c,content:fd.get('content').trim(),updatedAt:timestamp}); state.drawer=null; await refresh('留言已更新'); }
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

async function migrateLegacyWall() {
  const local=new LocalNotesAdapter(storage); const existing=new Set((await local.list()).map((n)=>n.id)); let added=0;
  for(const comment of state.data.comments) {
    const id=`note_legacy_${comment.id}`; if(existing.has(id)) continue;
    const company=state.data.companies.find((c)=>c.id===comment.companyId);
    await local.create({id,source:'Local',legacySource:{store:'comments',id:comment.id},title:company?.name||'',content:comment.content,category:'Company',createdAt:comment.createdAt,updatedAt:comment.updatedAt||comment.createdAt}); added++;
  }
  await refresh(`兼容复制完成：新增 ${added} 条 Local Notes；旧版数据保持不变`);
}

async function saveNoteForm(form) {
  const fd = new FormData(form);
  const content = fd.get('content').trim();
  if (!content && !fd.get('title').trim()) { toast('标题和正文不能同时为空','error'); return; }
  const old = state.notes.find((note) => note.id === form.dataset.noteId);
  const timestamp = now();
  const note = { id:old?.id||uid('note'), source:state.notesMode, title:fd.get('title').trim(), content, category:fd.get('category'), createdAt:old?.createdAt||timestamp, updatedAt:timestamp };
  const saved = old ? await currentNotesAdapter().update(note) : await currentNotesAdapter().create(note);
  state.noteId = saved?.id || note.id; state.noteDraft = null;
  await refresh(state.notesMode === 'Memos' ? 'Note 已保存到 Memos' : 'Note 已保存在本地');
}

async function exploreNew() {
  const index = Number(state.radar?.index || 0) + 1;
  state.radar = { id:'current', index, createdAt:now(), items:radarBatch(index) };
  await storage.put('radar', state.radar);
  state.data.radar = [state.radar];
  render(); toast('已生成新的探索批次');
}

async function saveRadarToNotes(id) {
  const item = state.radar?.items.find((entry) => entry.id === id);
  if (!item) return;
  const timestamp = now();
  const note = { id:uid('note'), source:state.notesMode, title:item.title, content:`${item.explanation}\n\n为什么值得关注：${item.why}\n\n来源：${item.sourceName}\n${item.sourceUrl}`, category:CATEGORIES.includes(item.domain)?item.domain:'Learning', createdAt:timestamp, updatedAt:timestamp };
  await currentNotesAdapter().create(note);
  await loadNotes();
  toast(`已保存到 Notes · ${note.category}`);
}

app.addEventListener('click', async (e) => {
  try {
  const nav=e.target.closest('[data-nav]'); if(nav){state.route=nav.dataset.nav; state.search=''; state.drawer=null; render(); return;}
  const open=e.target.closest('[data-open]'); if(open){openDrawer(open.dataset.open); return;}
  if(e.target.closest('[data-close]') || (e.target.classList.contains('drawer-backdrop'))){closeDrawer();return;}
  const newNote=e.target.closest('[data-new-note]'); if(newNote){state.noteId='new';state.noteDraft={category:state.selectedCategory==='All'?'Personal':state.selectedCategory};render();return;}
  const selectNote=e.target.closest('[data-select-note]'); if(selectNote){state.noteId=selectNote.dataset.selectNote;state.noteDraft=null;render();return;}
  const openNote=e.target.closest('[data-open-note]'); if(openNote){state.noteId=openNote.dataset.openNote;state.route='notes';render();return;}
  const category=e.target.closest('[data-category]'); if(category){state.selectedCategory=category.dataset.category;render();return;}
  if(e.target.closest('[data-explore-new]')){await exploreNew();return;}
  const saveRadar=e.target.closest('[data-save-radar]'); if(saveRadar){await saveRadarToNotes(saveRadar.dataset.saveRadar);return;}
  const task=e.target.closest('[data-task]'); if(task){state.taskId=task.dataset.task;state.taskHistoryTab='activity';state.route='task-detail';render();return;}
  const historyTab=e.target.closest('[data-history-tab]'); if(historyTab){state.taskHistoryTab=historyTab.dataset.historyTab;render();return;}
  const company=e.target.closest('[data-company]'); if(company){state.companyId=company.dataset.company;state.route='company-detail';render();return;}
  const editComment=e.target.closest('[data-edit-comment]'); if(editComment){openDrawer('edit-comment',editComment.dataset.editComment);return;}
  const editMember=e.target.closest('[data-edit-member]'); if(editMember){openDrawer('edit-member',editMember.dataset.editMember);return;}
  if(e.target.id==='export-data'){await exportData();return;}
  if(e.target.closest('[data-test-memos]')){await testMemosConnection();return;}
  if(e.target.closest('[data-connect-memos]')){await connectMemos();return;}
  if(e.target.closest('[data-disconnect-memos]')){notesCredentials.useLocal();state.search='';await refresh('Notes 已切换回 Local；Memos 数据未改动');return;}
  if(e.target.closest('[data-clear-memos]') && confirm('确定清除已保存的 Memos 配置和令牌吗？远端数据不会被删除。')){notesCredentials.clear();state.memosTest=null;await refresh('Memos 凭据已清除，Notes 使用 Local');return;}
  if(e.target.closest('[data-open-legacy-wall]')){state.route='companies';state.search='';render();return;}
  if(e.target.closest('[data-migrate-legacy]')){await migrateLegacyWall();return;}
  const deleteNote=e.target.closest('[data-delete-note]'); if(deleteNote && confirm(`确定从 ${state.notesMode} 删除这条 Note 吗？此操作不会影响另一数据源。`)){await currentNotesAdapter().delete(deleteNote.dataset.deleteNote);state.noteId=null;state.drawer=null;await refresh(`Note 已从 ${state.notesMode} 删除`);return;}
  const deleteComment=e.target.closest('[data-delete-comment]'); if(deleteComment && confirm('确定删除这条留言吗？此操作不可撤销。')){await storage.delete('comments',deleteComment.dataset.deleteComment);await refresh('留言已删除');return;}
  const deleteMember=e.target.closest('[data-delete-member]'); if(deleteMember && confirm('确定删除该成员吗？历史任务与记录中的姓名会保留。')){await storage.delete('team',deleteMember.dataset.deleteMember);await refresh('成员已删除；历史名称已保留');return;}
  const deleteTask=e.target.closest('[data-delete-task]'); if(deleteTask){const ac=state.data.activity.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;const hc=state.data.handoffs.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;if(confirm(`确定删除该任务吗？将同时删除 ${ac} 条活动和 ${hc} 条交接记录。`)){await storage.delete('tasks',deleteTask.dataset.deleteTask);await storage.deleteWhere('activity',(x)=>x.taskId===deleteTask.dataset.deleteTask);await storage.deleteWhere('handoffs',(x)=>x.taskId===deleteTask.dataset.deleteTask);state.route='tasks';await refresh(`任务及关联的 ${ac} 条活动、${hc} 条交接记录已删除`);}return;}
  const deleteCompany=e.target.closest('[data-delete-company]'); if(deleteCompany){const cc=state.data.comments.filter((x)=>x.companyId===deleteCompany.dataset.deleteCompany).length;if(confirm(`确定删除该公司吗？将同时删除 ${cc} 条关联留言。`)){await storage.delete('companies',deleteCompany.dataset.deleteCompany);await storage.deleteWhere('comments',(x)=>x.companyId===deleteCompany.dataset.deleteCompany);state.route='companies';await refresh(`公司及 ${cc} 条关联留言已删除`);}return;}
  } catch(error) { toast(error.message || '操作失败','error'); }
});

app.addEventListener('submit', async (e) => { if(e.target.id==='drawer-form'||e.target.id==='note-editor-form'){e.preventDefault();try{if(e.target.id==='drawer-form')await onSubmit(e.target);else await saveNoteForm(e.target);}catch(error){toast(error.message || '保存失败','error');}} });
app.addEventListener('input', (e) => { if(['task-search','company-search','note-search'].includes(e.target.id)){state.search=e.target.value;render();const input=document.querySelector(`#${e.target.id}`);input.focus();input.setSelectionRange(input.value.length,input.value.length);} });
app.addEventListener('change', async (e) => { if(e.target.id==='status-filter'){state.status=e.target.value;render();} if(e.target.id==='note-category-filter'){state.selectedCategory=e.target.value;state.noteId=null;render();} if(e.target.id==='handoff-to'){const member=state.data.team.find((m)=>m.id===e.target.value);const hint=document.querySelector('#handoff-confirm');if(hint)hint.textContent=member?`确认后负责人将更新为 ${member.name}；任务状态保持不变，并保存当前快照。`:'请选择接手人。确认时会保存当时任务状态和最新进展快照；完成状态不会改变。';} if(e.target.id==='import-data' && e.target.files[0]) await importData(e.target.files[0]); });
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&state.drawer)closeDrawer();});

loadData()
  .then(render)
  .catch((error) => {
    app.innerHTML = `<div class="empty"><h2>无法打开本地数据库</h2><p>${esc(error.message)}</p></div>`;
  });
