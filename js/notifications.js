(() => {
const NotificationEvents = Object.freeze({
  TaskCreated: 'TaskCreated',
  TaskHandedOff: 'TaskHandedOff',
});

class NoopNotificationAdapter {
  async notify() {
    // Intentionally disabled in V1. Never reports a false successful send.
    return { configured: false, sent: false };
  }
}

function formatTaskNotification(event, task, note = '') {
  return [
    `[${event}] ${task.title}`,
    `要求：${task.requirement}`,
    `当前进度：${task.currentSummary || '暂无'}`,
    `下一步：${task.next || '暂无'}`,
    note ? `交接备注：${note}` : '',
  ].filter(Boolean).join('\n');
}

window.TaskFlowNotifications = { NoopNotificationAdapter, NotificationEvents, formatTaskNotification };
})();
