(() => {
  const CONTENT_TYPES = Object.freeze([
    { id:'prompt', label:'提示词' },
    { id:'note', label:'笔记' },
    { id:'sop', label:'SOP / 指南' },
    { id:'other', label:'其他' },
  ]);
  const TYPE_IDS = new Set(CONTENT_TYPES.map((item) => item.id));
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function normalizeContentType(value) {
    const type = String(value || '').trim().toLowerCase();
    return TYPE_IDS.has(type) ? type : 'note';
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
    return {
      ...note,
      contentType:normalizeContentType(note.contentType),
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
    return [normalized.title, normalized.purpose, normalized.content, normalized.category, contentTypeLabel(normalized.contentType)].join(' ').toLocaleLowerCase();
  }

  function searchNotes(notes, { query = '', contentType = 'All', category = 'All' } = {}) {
    const keywords = tokenize(query);
    return (notes || []).map(normalizeNote).filter((note) => (
      (contentType === 'All' || note.contentType === contentType) &&
      (category === 'All' || note.category === category) &&
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
