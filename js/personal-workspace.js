(() => {
  const CAPTURE_RETENTION_MS = 24 * 60 * 60 * 1000;
  const TEMPLATE_DEFAULT_CATEGORIES = Object.freeze(['工作沟通','AI Prompt','文档结构','个人生活','检查清单']);
  const pad = (value) => String(value).padStart(2,'0');

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  }

  function isExpiredCapture(item, at = Date.now()) {
    return item?.status === 'completed' && Number.isFinite(Date.parse(item.completedAt)) && at - Date.parse(item.completedAt) >= CAPTURE_RETENTION_MS;
  }

  function todoMatchesView(todo, view, today = localDateKey()) {
    const completed=todo.status === 'completed' || Boolean(todo.completed);
    if (view === 'completed') return completed;
    if (completed) return false;
    if (view === 'today') return todo.plannedDate === today || todo.dueDate === today;
    if (view === 'upcoming') return [todo.plannedDate,todo.dueDate].filter(Boolean).some((date) => date > today);
    return true;
  }

  function shiftDate(value, days = 1) {
    if (!value) return '';
    const [year,month,day] = String(value).split('-').map(Number);
    const date = new Date(year,month-1,day);
    date.setDate(date.getDate()+days);
    return localDateKey(date);
  }

  function reminderId(entityType, entityId) { return `reminder:${entityType}:${entityId}`; }

  function dueReminders(reminders, at = Date.now()) {
    return (reminders || []).filter((item) => ['pending','unread'].includes(item.status) && Number.isFinite(Date.parse(item.remindAt)) && Date.parse(item.remindAt) <= at)
      .sort((a,b) => String(a.remindAt).localeCompare(String(b.remindAt)));
  }

  function extractTemplateVariables(content) {
    const result=[]; const seen=new Set(); const pattern=/{{\s*([^{}]+?)\s*}}/g; let match;
    while((match=pattern.exec(String(content||'')))){const name=match[1].trim();if(name&&!seen.has(name)){seen.add(name);result.push(name);}}
    return result;
  }

  function fillTemplate(content, values = {}) {
    return String(content||'').replace(/{{\s*([^{}]+?)\s*}}/g,(placeholder,name)=>{
      const value=String(values[name.trim()]??'');
      return value ? value : placeholder;
    });
  }

  function monthGrid(year, month) {
    if(typeof year==='string'){const parts=year.split('-').map(Number);year=parts[0];month=parts[1]-1;}
    const first=new Date(year,month,1); const mondayOffset=(first.getDay()+6)%7; const start=new Date(year,month,1-mondayOffset);
    return Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);const inMonth=date.getMonth()===month;return {date:localDateKey(date),day:date.getDate(),currentMonth:inMonth,inMonth};});
  }

  window.TaskFlowPersonalWorkspace = { CAPTURE_RETENTION_MS, TEMPLATE_DEFAULT_CATEGORIES, localDateKey, isExpiredCapture, todoMatchesView, shiftDate, reminderId, dueReminders, extractTemplateVariables, fillTemplate, monthGrid };
})();
