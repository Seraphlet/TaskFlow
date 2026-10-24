(() => {
  const CONTENT_TYPES = Object.freeze([
    { id:'prompt', label:'提示词' },
    { id:'note', label:'笔记' },
    { id:'sop', label:'SOP / 指南' },
    { id:'other', label:'其他' },
  ]);
  const legacyCategoryId = window.TaskFlowClassifications?.legacyCategoryId || ((value) => ({
    'ai engineering':'ai-engineering', company:'company', learning:'learning', project:'project', personal:'personal'
  }[String(value || '').trim().toLocaleLowerCase()] || ''));
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function normalizeContentType(value) {
    const type = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{1,80}$/.test(type) ? type : 'note';
  }

  function safeSourceUrl(value, strict = false) {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
      const parsed = new URL(input);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
      return parsed.href;
    } catch {
      if (strict) throw new Error('来源链接必须是有效的 HTTP 或 HTTPS 地址');
      return '';
    }
  }

  function normalizeNote(note = {}) {
    const contentType = normalizeContentType(note.contentTypeId || note.contentType);
    const categoryLabel = String(note.categoryLabel || note.category || (note.companyName ? 'Company' : 'Personal')).trim() || 'Personal';
    const categoryId = String(note.categoryId || legacyCategoryId(categoryLabel) || categoryLabel.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'personal');
    return {
      ...note,
      contentType,
      contentTypeId:contentType,
      contentTypeLabel:String(note.contentTypeLabel || '').trim(),
      category:categoryLabel,
      categoryId,
      categoryLabel,
      purpose:String(note.purpose ?? note.summary ?? ''),
      sourceUrl:safeSourceUrl(note.sourceUrl),
      pinned:Boolean(note.pinned),
    };
  }

  function tokenize(query) {
    return [...new Set(String(query || '').trim().split(/\s+/).map((word) => word.toLocaleLowerCase()).filter(Boolean))];
  }

  function noteSearchText(note) {
    const normalized = normalizeNote(note);
    return [normalized.title, normalized.purpose, normalized.content, normalized.categoryLabel, normalized.contentTypeLabel || contentTypeLabel(normalized.contentType)].join(' ').toLocaleLowerCase();
  }

  function searchNotes(notes, { query = '', contentType = 'All', category = 'All' } = {}) {
    const keywords = tokenize(query);
    return (notes || []).map(normalizeNote).filter((note) => (
      (contentType === 'All' || note.contentType === contentType) &&
      (category === 'All' || note.categoryId === category || note.category === category) &&
      (!keywords.length || keywords.some((keyword) => noteSearchText(note).includes(keyword)))
    )).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function highlightHtml(value, keywords) {
    const terms = (Array.isArray(keywords) ? keywords : tokenize(keywords)).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!terms.length) return escapeHtml(value);
    const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
    return String(value || '').split(pattern).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
  }

  function contentTypeLabel(value) {
    return CONTENT_TYPES.find((item) => item.id === normalizeContentType(value))?.label || '笔记';
  }

  function contentSummary(note, limit = 150) {
    const normalized = normalizeNote(note);
    const value = normalized.purpose.trim() || normalized.content.trim().replace(/\s+/g, ' ');
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
  }

  window.TaskFlowContentLibrary = { CONTENT_TYPES, normalizeContentType, normalizeNote, tokenize, searchNotes, highlightHtml, contentTypeLabel, contentSummary, safeSourceUrl };
})();
