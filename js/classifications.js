(() => {
  const STORAGE_KEY = 'taskflow-note-classifications-v1';
  const DEFAULT_CONTENT_TYPES = Object.freeze([
    { id:'prompt', label:'提示词', builtIn:true },
    { id:'note', label:'笔记', builtIn:true },
    { id:'sop', label:'SOP / 指南', builtIn:true },
    { id:'other', label:'其他', builtIn:true },
  ]);
  const DEFAULT_CATEGORIES = Object.freeze([
    { id:'ai-engineering', label:'AI Engineering', builtIn:true },
    { id:'company', label:'Company', builtIn:true },
    { id:'learning', label:'Learning', builtIn:true },
    { id:'project', label:'Project', builtIn:true },
    { id:'personal', label:'Personal', builtIn:true },
  ]);

  const copyDefaults = () => ({
    version:1,
    contentTypes:DEFAULT_CONTENT_TYPES.map((item) => ({ ...item })),
    categories:DEFAULT_CATEGORIES.map((item) => ({ ...item })),
  });
  const cleanLabel = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const cleanId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
  const legacyCategoryId = (value) => DEFAULT_CATEGORIES.find((item) => item.label.toLocaleLowerCase() === cleanLabel(value).toLocaleLowerCase())?.id || '';

  class ClassificationStore {
    constructor(store = typeof localStorage !== 'undefined' ? localStorage : null) { this.store = store; }
    read() {
      if (!this.store) return copyDefaults();
      try {
        const value = JSON.parse(this.store.getItem(STORAGE_KEY));
        if (!value || value.version !== 1 || !Array.isArray(value.contentTypes) || !Array.isArray(value.categories)) return copyDefaults();
        return this.sanitize(value);
      } catch { return copyDefaults(); }
    }
    sanitize(value) {
      const clean = (items) => {
        const seen = new Set();
        return items.map((item) => ({ id:cleanId(item?.id), label:cleanLabel(item?.label), builtIn:Boolean(item?.builtIn) }))
          .filter((item) => item.id && item.label && !seen.has(item.id) && seen.add(item.id));
      };
      const result = { version:1, contentTypes:clean(value.contentTypes), categories:clean(value.categories) };
      if (!result.contentTypes.length) result.contentTypes = copyDefaults().contentTypes;
      if (!result.categories.length) result.categories = copyDefaults().categories;
      return result;
    }
    write(config) {
      const value = this.sanitize(config);
      if (this.store) this.store.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    }
    resolve(notes = []) {
      const config = this.read();
      const add = (kind, id, label) => {
        id = cleanId(id); label = cleanLabel(label) || id;
        if (!id || config[kind].some((item) => item.id === id)) return;
        config[kind].push({ id, label, builtIn:false, discovered:true });
      };
      notes.forEach((note) => {
        const typeId = cleanId(note.contentTypeId || note.contentType || 'note') || 'note';
        add('contentTypes', typeId, note.contentTypeLabel || typeId);
        const categoryId = cleanId(note.categoryId) || legacyCategoryId(note.category) || cleanId(note.category);
        add('categories', categoryId, note.categoryLabel || note.category || categoryId);
      });
      return this.write(config);
    }
    add(config, kind, label) {
      label = cleanLabel(label);
      if (!label) throw new Error('名称不能为空');
      if (config[kind].some((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('已存在同名分类');
      const prefix = kind === 'contentTypes' ? 'type' : 'category';
      const id = `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
      config[kind].push({ id, label, builtIn:false });
      return this.write(config);
    }
    rename(config, kind, id, label) {
      label = cleanLabel(label);
      if (!label) throw new Error('名称不能为空');
      if (config[kind].some((item) => item.id !== id && item.label.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('已存在同名分类');
      const item = config[kind].find((entry) => entry.id === id);
      if (!item) throw new Error('分类不存在或已被删除');
      item.label = label;
      return this.write(config);
    }
    remove(config, kind, id) {
      if (config[kind].length <= 1) throw new Error('至少需要保留一个分类');
      const next = { ...config, [kind]:config[kind].filter((item) => item.id !== id) };
      if (next[kind].length === config[kind].length) throw new Error('分类不存在或已被删除');
      return this.write(next);
    }
  }

  window.TaskFlowClassifications = { ClassificationStore, DEFAULT_CONTENT_TYPES, DEFAULT_CATEGORIES, legacyCategoryId, cleanId, cleanLabel };
})();
