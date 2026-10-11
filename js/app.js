const { LocalStorageAdapter, STORES } = window.TaskFlowStorage;
const { NoopNotificationAdapter, NotificationEvents, formatTaskNotification } = window.TaskFlowNotifications;

const storage = new LocalStorageAdapter();
const notifications = new NoopNotificationAdapter();
const app = document.querySelector('#app');
const STATUS = ['Todo', 'Doing', 'Blocked', 'Done'];
const state = { route: 'tasks', taskId: null, companyId: null, search: '', status: 'All', drawer: null, data: {} };
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const dateText = (iso) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const badge = (status) => `<span class="badge ${status.toLowerCase()}">${status}</span>`;

async function loadData() {
  await storage.init();
  const entries = await Promise.all(STORES.map(async (name) => [name, await storage.all(name)]));
  state.data = Object.fromEntries(entries);
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
        ${navButton('tasks','▣','TaskFlow')}
        ${navButton('companies','▥','公司吐槽墙')}
        ${navButton('settings','⚙','Settings')}
      </nav>
      <div class="local-note">数据仅保存在当前浏览器。<br>定期导出 JSON 备份。</div>
    </aside>
    <main class="main"><header class="topbar"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><span class="badge done">Local</span></header>${content}</main>
  </div>${renderDrawer()}`;
}

function navButton(route, icon, label) {
  const active = (state.route === route || (route === 'tasks' && state.route === 'task-detail') || (route === 'companies' && state.route === 'company-detail')) ? 'active' : '';
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
    <div class="stat-row">${STATUS.map((s) => `<div class="card stat"><span>${s}</span><b>${counts[s]}</b></div>`).join('')}</div>
    <div class="toolbar"><div class="search"><span>⌕</span><label class="sr-only" for="task-search">搜索任务</label><input id="task-search" class="input" type="search" placeholder="搜索任务、要求或负责人" value="${esc(state.search)}"></div>
      <select id="status-filter" class="select filter" aria-label="状态筛选"><option>All</option>${STATUS.map((s) => `<option ${state.status === s ? 'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="card task-table">${tasks.length ? `<table><thead><tr><th>任务</th><th>状态</th><th>负责人</th><th>下一步</th><th>更新</th></tr></thead><tbody>${tasks.map((t) => `<tr class="click-row" data-task="${t.id}"><td><div class="title-cell">${esc(t.title)}</div><div class="subtle">${esc(t.requirement.slice(0,70))}</div></td><td>${badge(t.status)}</td><td>${esc(t.ownerName || '未分配')}</td><td>${esc(t.next || '—')}</td><td class="subtle">${dateText(t.updatedAt)}</td></tr>`).join('')}</tbody></table>` : empty('还没有匹配的任务','新建一个任务，开始记录进展。')}</div>
  </section>`, 'TaskFlow', `${state.data.tasks.length} 个任务 · 本地持久化`);
}

function taskDetail() {
  const task = state.data.tasks.find((t) => t.id === state.taskId);
  if (!task) { state.route = 'tasks'; return taskList(); }
  const activities = state.data.activity.filter((a) => a.taskId === task.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const handoffs = state.data.handoffs.filter((h) => h.taskId === task.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return shell(`<section class="page">
    <button class="back-link" data-nav="tasks">← 返回任务列表</button>
    <div class="page-head"><div><h3>${esc(task.title)}</h3><p>${badge(task.status)}</p></div><div><button class="btn" data-open="update-task">更新进度</button> <button class="btn dark" data-open="handoff">交接</button> <button class="btn danger" data-delete-task="${task.id}">删除</button></div></div>
    <div class="detail-grid"><div class="detail-main">
      <article class="card section highlight"><h4>Requirement · 任务要求</h4><div class="prose">${esc(task.requirement)}</div></article>
      <article class="card section"><h4>Current Summary · 当前整体进度</h4><div class="prose">${esc(task.currentSummary || '暂无进度总结')}</div>${task.blockedReason ? `<div class="warning" style="margin-top:14px"><b>阻塞说明：</b>${esc(task.blockedReason)}</div>`:''}</article>
      <article class="card section next-box"><h4>Next · 下一步</h4><div class="prose">${esc(task.next || '暂未设置')}</div></article>
      <article class="card section"><h4>Activity · 更新记录</h4>${activities.length ? `<div class="timeline">${activities.map(activityItem).join('')}</div>` : '<p class="subtle">暂无记录</p>'}</article>
      <article class="card section"><h4>Handoff History · 交接历史</h4>${handoffs.length ? `<div class="timeline">${handoffs.map(handoffItem).join('')}</div>` : '<p class="subtle">暂无交接记录</p>'}</article>
    </div><aside class="detail-side"><article class="card section"><h4>任务信息</h4><div class="meta-list">
      <div class="meta-item"><span>状态</span><b>${task.status}</b></div><div class="meta-item"><span>负责人</span><b>${esc(task.ownerName || '未分配')}</b></div><div class="meta-item"><span>交付对象</span><b>${esc(task.delivery || '—')}</b></div><div class="meta-item"><span>创建时间</span><b>${dateText(task.createdAt)}</b></div><div class="meta-item"><span>最近更新</span><b>${dateText(task.updatedAt)}</b></div>
    </div></article></aside></div>
  </section>`, '任务详情', task.title);
}

function activityItem(a) {
  const changes = (a.changes || []).map((c) => `${c.field}：${c.from || '空'} → ${c.to || '空'}`).join('；');
  return `<div class="event"><div class="event-head"><b>${esc(a.actor || '未署名')}</b><time>${dateText(a.createdAt)}</time></div><div class="subtle">${esc(a.type === 'handoff' ? '任务交接' : a.type === 'created' ? '创建任务' : '进度更新')}</div>${a.progress ? `<p>${esc(a.progress)}</p>`:''}${changes ? `<p class="subtle">${esc(changes)}</p>`:''}</div>`;
}

function handoffItem(h) {
  return `<div class="event"><div class="event-head"><b>${esc(h.fromName || '未分配')} → ${esc(h.toName)}</b><time>${dateText(h.createdAt)}</time></div>${h.note ? `<p>${esc(h.note)}</p>`:''}<p class="subtle">快照：${h.status} · ${esc(h.currentSummary || '无总结')} · 下一步：${esc(h.next || '无')}</p></div>`;
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
  return shell(`<section class="page"><div class="page-head"><div><h3>Settings</h3><p>存储状态、团队和备份。</p></div></div>
    <div class="settings-grid"><article class="card setting-card"><h4>服务状态</h4><div class="setting-row"><span>Storage Mode</span><span class="setting-value ready">Local</span></div><div class="setting-row"><span>Server</span><span class="setting-value muted">Not Configured</span></div><div class="setting-row"><span>Email Notification</span><span class="setting-value muted">Not Configured</span></div></article>
      <article class="card setting-card"><h4>数据备份</h4><p class="subtle">导入采用合并策略；相同 ID 的已有记录会保留，不会直接覆盖。</p><div class="import-box"><button class="btn dark" id="export-data">导出 JSON</button><label class="btn" for="import-data">导入 JSON</label><input class="sr-only" id="import-data" type="file" accept="application/json,.json"></div><div class="warning" style="margin-top:18px">浏览器存储不是云端备份。清除站点数据、浏览器重置或更换设备均可能导致数据丢失。</div></article>
      ${teamSettings()}
      <article class="card setting-card"><h4>接口边界</h4><p class="subtle">UI 通过 Storage Adapter 访问数据；Remote Adapter 已预留但未配置。通知接口仅定义 TaskCreated 与 TaskHandedOff，V1 不发送也不模拟邮件。</p></article>
    </div></section>`, 'Settings', '本地模式 · 后端与邮件未配置');
}

function empty(title, text) { return `<div class="empty"><div class="empty-mark">◇</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`; }

function memberOptions(selected = '') {
  return `<option value="">未分配</option>${state.data.team.map((m) => `<option value="${m.id}" ${selected === m.id ? 'selected':''}>${esc(m.name)}</option>`).join('')}`;
}

function renderDrawer() {
  if (!state.drawer) return '';
  const d = state.drawer;
  let title = '', body = '', submit = '';
  if (d.type === 'new-task') { title='新建任务'; submit='创建任务'; body=`<div class="field"><label>Title <span>*</span></label><input class="input" name="title" required maxlength="120"></div><div class="field"><label>Requirement <span>*</span></label><textarea class="textarea" name="requirement" required></textarea></div><div class="two-col"><div class="field"><label>Owner</label><select class="select" name="ownerId">${memberOptions()}</select></div><div class="field"><label>Delivery</label><input class="input" name="delivery"></div></div><div class="field"><label>Next</label><textarea class="textarea" name="next"></textarea></div>`; }
  if (d.type === 'update-task') { const t=state.data.tasks.find((x)=>x.id===state.taskId); title='更新任务'; submit='保存更新'; body=`<div class="field"><label>Updated By</label><input class="input" name="actor" placeholder="你的名字"></div><div class="field"><label>Status</label><select class="select" name="status" id="update-status">${STATUS.map((s)=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}</select></div><div class="field"><label>Progress</label><textarea class="textarea" name="progress" placeholder="本次做了什么（将追加到 Activity）"></textarea></div><div class="field"><label>Current Summary</label><textarea class="textarea" name="currentSummary">${esc(t.currentSummary||'')}</textarea></div><div class="field"><label>Next</label><textarea class="textarea" name="next">${esc(t.next||'')}</textarea></div><div class="field blocked-field" id="blocked-wrap" ${t.status==='Blocked'?'':'hidden'}><label>阻塞说明</label><textarea class="textarea" name="blockedReason">${esc(t.blockedReason||'')}</textarea></div>`; }
  if (d.type === 'handoff') { const t=state.data.tasks.find((x)=>x.id===state.taskId); title='交接任务'; submit='确认交接'; body=`<div class="field"><label>From</label><input class="input" value="${esc(t.ownerName||'未分配')}" disabled></div><div class="field"><label>To <span>*</span></label><select class="select" name="toId" required>${memberOptions()}</select></div><div class="field"><label>Note</label><textarea class="textarea" name="note" placeholder="交接背景或注意事项"></textarea></div><p class="field-hint">确认后将保存当前状态、进度总结与下一步快照。</p>`; }
  if (d.type === 'new-company') { title='添加公司'; submit='添加'; body=`<div class="field"><label>公司名称 <span>*</span></label><input class="input" name="name" required maxlength="120"></div>`; }
  if (d.type === 'new-comment' || d.type === 'edit-comment') { const c=state.data.comments.find((x)=>x.id===d.id); title=d.type==='new-comment'?'新增留言':'编辑留言'; submit=d.type==='new-comment'?'保存留言':'保存修改'; body=`<div class="field"><label>Content <span>*</span></label><textarea class="textarea" name="content" required placeholder="以个人记录的方式写下你的观察">${esc(c?.content||'')}</textarea><div class="field-hint">留言只保存在本地，不代表平台认定的事实。</div></div>`; }
  if (d.type === 'new-member' || d.type === 'edit-member') { const m=state.data.team.find((x)=>x.id===d.id); title=d.type==='new-member'?'添加成员':'编辑成员'; submit='保存成员'; body=`<div class="field"><label>Name <span>*</span></label><input class="input" name="name" required value="${esc(m?.name||'')}"></div><div class="field"><label>Email <span>*</span></label><input class="input" name="email" type="email" required value="${esc(m?.email||'')}"></div>`; }
  return `<div class="drawer-backdrop"><form class="drawer" id="drawer-form"><header class="drawer-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="关闭">×</button></header><div class="drawer-body">${body}</div><footer class="drawer-foot"><button type="button" class="btn" data-close>取消</button><button class="btn primary" type="submit">${submit}</button></footer></form></div>`;
}

function render() {
  if (state.route === 'tasks') app.innerHTML = taskList();
  if (state.route === 'task-detail') app.innerHTML = taskDetail();
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
    const task = { id:uid('task'), title:fd.get('title').trim(), requirement:fd.get('requirement').trim(), ownerId:owner?.id||'', ownerName:owner?.name||'', delivery:fd.get('delivery').trim(), next:fd.get('next').trim(), status:'Todo', currentSummary:'', blockedReason:'', createdAt:timestamp, updatedAt:timestamp };
    await storage.put('tasks',task); await storage.put('activity',{ id:uid('activity'), taskId:task.id, type:'created', actor:owner?.name||'未署名', progress:'创建了任务', changes:[], createdAt:timestamp });
    await notifications.notify(NotificationEvents.TaskCreated, formatTaskNotification(NotificationEvents.TaskCreated, task));
    state.drawer=null; await refresh('任务已创建');
  }
  if (d.type === 'update-task') {
    const task=state.data.tasks.find((t)=>t.id===state.taskId); const changes=[];
    const updates={ status:fd.get('status'), currentSummary:fd.get('currentSummary').trim(), next:fd.get('next').trim(), blockedReason:fd.get('status')==='Blocked'?fd.get('blockedReason').trim():'', updatedAt:timestamp };
    ['status','currentSummary','next','blockedReason'].forEach((field)=>{ if ((task[field]||'') !== (updates[field]||'')) changes.push({field,from:task[field]||'',to:updates[field]||''}); });
    if (fd.get('progress').trim() || changes.length) await storage.put('activity',{id:uid('activity'),taskId:task.id,type:'update',actor:fd.get('actor').trim()||'未署名',progress:fd.get('progress').trim(),changes,createdAt:timestamp});
    await storage.put('tasks',{...task,...updates}); state.drawer=null; await refresh('任务已更新，历史记录已追加');
  }
  if (d.type === 'handoff') {
    const task=state.data.tasks.find((t)=>t.id===state.taskId); const to=state.data.team.find((m)=>m.id===fd.get('toId'));
    if (!to) { toast('请选择接手人','error'); return; }
    const handoff={id:uid('handoff'),taskId:task.id,fromId:task.ownerId||'',fromName:task.ownerName||'未分配',toId:to.id,toName:to.name,note:fd.get('note').trim(),status:task.status,currentSummary:task.currentSummary,next:task.next,createdAt:timestamp};
    await storage.put('handoffs',handoff); await storage.put('tasks',{...task,ownerId:to.id,ownerName:to.name,updatedAt:timestamp}); await storage.put('activity',{id:uid('activity'),taskId:task.id,type:'handoff',actor:to.name,progress:`${handoff.fromName} 将任务交接给 ${to.name}${handoff.note ? `：${handoff.note}`:''}`,changes:[{field:'owner',from:handoff.fromName,to:to.name}],createdAt:timestamp});
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

app.addEventListener('click', async (e) => {
  const nav=e.target.closest('[data-nav]'); if(nav){state.route=nav.dataset.nav; state.search=''; state.drawer=null; render(); return;}
  const open=e.target.closest('[data-open]'); if(open){openDrawer(open.dataset.open); return;}
  if(e.target.closest('[data-close]') || (e.target.classList.contains('drawer-backdrop'))){closeDrawer();return;}
  const task=e.target.closest('[data-task]'); if(task){state.taskId=task.dataset.task;state.route='task-detail';render();return;}
  const company=e.target.closest('[data-company]'); if(company){state.companyId=company.dataset.company;state.route='company-detail';render();return;}
  const editComment=e.target.closest('[data-edit-comment]'); if(editComment){openDrawer('edit-comment',editComment.dataset.editComment);return;}
  const editMember=e.target.closest('[data-edit-member]'); if(editMember){openDrawer('edit-member',editMember.dataset.editMember);return;}
  if(e.target.id==='export-data'){await exportData();return;}
  const deleteComment=e.target.closest('[data-delete-comment]'); if(deleteComment && confirm('确定删除这条留言吗？此操作不可撤销。')){await storage.delete('comments',deleteComment.dataset.deleteComment);await refresh('留言已删除');return;}
  const deleteMember=e.target.closest('[data-delete-member]'); if(deleteMember && confirm('确定删除该成员吗？历史任务与记录中的姓名会保留。')){await storage.delete('team',deleteMember.dataset.deleteMember);await refresh('成员已删除；历史名称已保留');return;}
  const deleteTask=e.target.closest('[data-delete-task]'); if(deleteTask){const ac=state.data.activity.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;const hc=state.data.handoffs.filter((x)=>x.taskId===deleteTask.dataset.deleteTask).length;if(confirm(`确定删除该任务吗？将同时删除 ${ac} 条活动和 ${hc} 条交接记录。`)){await storage.delete('tasks',deleteTask.dataset.deleteTask);await storage.deleteWhere('activity',(x)=>x.taskId===deleteTask.dataset.deleteTask);await storage.deleteWhere('handoffs',(x)=>x.taskId===deleteTask.dataset.deleteTask);state.route='tasks';await refresh(`任务及关联的 ${ac} 条活动、${hc} 条交接记录已删除`);}return;}
  const deleteCompany=e.target.closest('[data-delete-company]'); if(deleteCompany){const cc=state.data.comments.filter((x)=>x.companyId===deleteCompany.dataset.deleteCompany).length;if(confirm(`确定删除该公司吗？将同时删除 ${cc} 条关联留言。`)){await storage.delete('companies',deleteCompany.dataset.deleteCompany);await storage.deleteWhere('comments',(x)=>x.companyId===deleteCompany.dataset.deleteCompany);state.route='companies';await refresh(`公司及 ${cc} 条关联留言已删除`);}return;}
});

app.addEventListener('submit', async (e) => { if(e.target.id==='drawer-form'){e.preventDefault();await onSubmit(e.target);} });
app.addEventListener('input', (e) => { if(e.target.id==='task-search' || e.target.id==='company-search'){state.search=e.target.value;render();const input=document.querySelector(`#${e.target.id}`);input.focus();input.setSelectionRange(input.value.length,input.value.length);} });
app.addEventListener('change', async (e) => { if(e.target.id==='status-filter'){state.status=e.target.value;render();} if(e.target.id==='update-status'){document.querySelector('#blocked-wrap').hidden=e.target.value!=='Blocked';} if(e.target.id==='import-data' && e.target.files[0]) await importData(e.target.files[0]); });
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&state.drawer)closeDrawer();});

loadData()
  .then(render)
  .catch((error) => {
    app.innerHTML = `<div class="empty"><h2>无法打开本地数据库</h2><p>${esc(error.message)}</p></div>`;
  });
