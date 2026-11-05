(() => {
  class OperationLockRegistry {
    constructor() { this.pending = new Map(); }

    start(key, operation) {
      const normalizedKey = String(key || 'operation');
      const existing = this.pending.get(normalizedKey);
      if (existing) return { started:false, promise:existing };

      const promise = Promise.resolve().then(operation);
      this.pending.set(normalizedKey, promise);
      const release = () => {
        if (this.pending.get(normalizedKey) === promise) this.pending.delete(normalizedKey);
      };
      promise.then(release, release);
      return { started:true, promise };
    }

    has(key) { return this.pending.has(String(key || 'operation')); }
    get size() { return this.pending.size; }
  }

  window.TaskFlowOperationLocks = { OperationLockRegistry };
})();
