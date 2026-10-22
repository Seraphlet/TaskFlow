(() => {
  const QUOTAS = Object.freeze({ 'Core Domain': 5, 'Adjacent Fields': 2, 'Unknown Window': 1 });
  const DEFAULT_MODEL_ID = 'deepseek-flash';
  const DEFAULT_DAILY_LIMIT = 3;
  const RADAR_CONFIG_KEY = 'taskflow-radar-provider-config-v1';
  const TAVILY_KEY = 'taskflow-tavily-api-key-v1';
  const DEEPSEEK_KEY = 'taskflow-deepseek-api-key-v1';
  const DEFAULT_PROFILE = Object.freeze({
    id: 'profile_ai_engineering',
    name: 'AI Engineering',
    coreDomains: ['AI Engineering', 'Personal Productivity', 'Knowledge Management'],
    adjacentDomains: ['Learning Science', 'Behavioral Science', 'Product Design'],
    isDefault: true
  });

  const DEMO_BATCHES = [
    [
      ['Core Domain', '渐进式总结', 'Learning', '让笔记在再次使用时逐步变得清晰，而不是首次记录就要求完整整理。', '它能降低记录门槛，也保留后续提炼的空间。', 'Forte Labs', 'https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/'],
      ['Core Domain', 'Local-first software', 'AI Engineering', '数据先属于本地设备，网络与服务端是增强而不是前提。', '它直接影响个人工具的数据所有权、离线体验与架构边界。', 'Ink & Switch', 'https://www.inkandswitch.com/local-first/'],
      ['Core Domain', '认知卸载', 'Learning', '把待记忆的信息可靠地放进外部系统，释放有限的工作记忆。', '理解它有助于判断工具是在减负，还是制造更多维护工作。', 'The Decision Lab', 'https://thedecisionlab.com/biases/cognitive-offloading'],
      ['Core Domain', '实施意图', 'Personal', '用“如果 X 发生，我就做 Y”的形式把目标变成可触发的行动。', '它为任务的“下一步”提供了比模糊目标更可执行的写法。', 'NCI', 'https://cancercontrol.cancer.gov/brp/research/constructs/implementation-intentions'],
      ['Core Domain', '事件溯源思维', 'AI Engineering', '保留发生过的事件，再由事件推导当前状态。', 'Activity 历史与当前任务状态的边界可以因此更清楚。', 'Martin Fowler', 'https://martinfowler.com/eaaDev/EventSourcing.html'],
      ['Adjacent Fields', '选择架构', 'Project', '界面如何排列选项，会系统性地影响人的判断与行动。', '它提醒我们减少字段并不只是视觉简化，也是在设计行为路径。', 'Behavioral Scientist', 'https://behavioralscientist.org/choice-architecture/'],
      ['Adjacent Fields', '信息觅食理论', 'Learning', '人会根据“信息气味”判断是否继续探索一条线索。', '它可用于改善 Radar 卡片的解释和来源呈现。', 'Nielsen Norman Group', 'https://www.nngroup.com/articles/information-scent/'],
      ['Unknown Window', '可逆计算', 'AI Engineering', '一些计算模型要求每一步都能从结果恢复输入。', '它从一个陌生角度挑战我们对历史、撤销与状态变化的常见假设。', 'Wikipedia', 'https://en.wikipedia.org/wiki/Reversible_computing']
    ],
    [
      ['Core Domain', '收件箱归零之外', 'Personal', '入口的价值不是保持空白，而是让每条输入得到明确去向。', '这能避免把“清空列表”误当成真正推进工作。', 'Nielsen Norman Group', 'https://www.nngroup.com/articles/todo-lists/'],
      ['Core Domain', '任务切换成本', 'Personal', '从一个目标切换到另一个目标时，注意力不会立即完整转移。', '它支持减少并行工作、突出下一步和保留上下文。', 'APA', 'https://www.apa.org/research/action/multitask'],
      ['Core Domain', '纯文本的耐久性', 'AI Engineering', '简单、可读取的格式通常比专有结构更容易长期迁移。', '它有助于评估个人记录系统的可导出性与寿命。', 'W3C', 'https://www.w3.org/Provider/Style/URI'],
      ['Core Domain', '检索练习', 'Learning', '主动回想比重复阅读更能巩固长期记忆。', 'Notes 不只是储存，也可以成为重新提取想法的入口。', 'The Learning Scientists', 'https://www.learningscientists.org/retrieval-practice'],
      ['Core Domain', '状态机', 'AI Engineering', '对象在有限状态间按明确事件转换。', '它能让任务状态更新保持简单、可预测且容易测试。', 'MDN', 'https://developer.mozilla.org/en-US/docs/Glossary/State_machine'],
      ['Adjacent Fields', '边界对象', 'Project', '同一件轻量产物可以帮助不同视角的人协作理解问题。', '简洁的 Note 或 Task 也可能承担跨情境沟通作用。', 'Wikipedia', 'https://en.wikipedia.org/wiki/Boundary_object'],
      ['Adjacent Fields', '前景理论', 'Learning', '人对损失和收益的感受并不对称。', '它能帮助识别优先级判断中隐藏的心理偏差。', 'Britannica', 'https://www.britannica.com/money/prospect-theory'],
      ['Unknown Window', '群体感知', 'AI Engineering', '大量简单个体通过局部互动可以形成整体协调行为。', '它提供一种不同于中央计划的任务协作想象。', 'Wikipedia', 'https://en.wikipedia.org/wiki/Swarm_intelligence']
    ],
    [
      ['Core Domain', 'Zeigarnik 效应', 'Personal', '未完成的事项更容易持续占据注意力。', '可靠记录下一步可能比强迫自己一直记住任务更有效。', 'Psychology Today', 'https://www.psychologytoday.com/us/basics/zeigarnik-effect'],
      ['Core Domain', '双向链接的取舍', 'Learning', '链接能提供语境，但过度连接也会增加整理成本。', '它帮助我们坚持“记录优先，整理其次”的产品边界。', 'Nielsen Norman Group', 'https://www.nngroup.com/articles/hypertext-and-hypermedia/'],
      ['Core Domain', '离线优先', 'AI Engineering', '应用在无网络时仍完成主要工作，联网后再处理增强能力。', '这与双击 HTML、浏览器本地存储的目标直接相关。', 'web.dev', 'https://web.dev/learn/pwa/offline-data'],
      ['Core Domain', '最小可行动步骤', 'Project', '把模糊目标缩小为能直接开始的可观察动作。', '它让任务的下一步真正承担启动工作的作用。', 'Atlassian', 'https://www.atlassian.com/blog/productivity/how-to-write-smart-goals'],
      ['Core Domain', '可供性', 'Project', '对象的形态会暗示用户可以怎样操作它。', '清楚的按钮、选中态和编辑区能减少说明文字的负担。', 'Interaction Design Foundation', 'https://www.interaction-design.org/literature/topics/affordances'],
      ['Adjacent Fields', '注意力残留', 'Learning', '离开一个任务后，部分注意力仍可能停留在原任务。', '它解释了为何明确保存进度和下一步有助于顺畅切换。', 'University of Washington', 'https://faculty.washington.edu/sophie/attention-residue/'],
      ['Adjacent Fields', '弱联系', 'Personal', '不常接触的关系有时会带来更陌生、更新颖的信息。', 'Radar 的相邻领域可以借鉴这种跨边界发现机制。', 'Britannica', 'https://www.britannica.com/topic/weak-tie'],
      ['Unknown Window', '生物启发计算', 'AI Engineering', '算法借鉴进化、神经系统或群体行为来解决问题。', '它打开一扇与常规软件设计逻辑差异很大的窗口。', 'Nature', 'https://www.nature.com/subjects/biologically-inspired-computing']
    ]
  ];

  const CORE_TERMS = ['AI Engineering', 'Personal Productivity', 'Knowledge Management'];
  const ADJACENT_TERMS = ['Learning Science', 'Behavioral Science', 'Product Design'];
  const CATALOG = DEMO_BATCHES.flatMap((items, batchIndex) => items.map((item, order) => ({
    id: `demo_${batchIndex}_${order}`,
    section: item[0], title: item[1], domain: item[2], explanation: item[3],
    why: item[4], sourceName: item[5], sourceUrl: item[6], provider: 'Demo',
    matchTerms: item[0] === 'Core Domain' ? CORE_TERMS : item[0] === 'Adjacent Fields' ? ADJACENT_TERMS : []
  })));

  const normalize = (value) => String(value || '').trim().toLocaleLowerCase();
  const supports = (item, configuredDomains) => configuredDomains.some((domain) => item.matchTerms.some((term) => {
    const configured = normalize(domain); const supported = normalize(term);
    return configured && (configured.includes(supported) || supported.includes(configured));
  }));

  // Future providers only need to implement this method and return the same result shape.
  class DemoRadarProvider {
    async getNextBatch(profile, usedItemIds = []) {
      const used = new Set(usedItemIds);
      const eligible = CATALOG.filter((item) => !used.has(item.id) && (
        item.section === 'Unknown Window' ||
        (item.section === 'Core Domain' && supports(item, profile.coreDomains || [])) ||
        (item.section === 'Adjacent Fields' && supports(item, profile.adjacentDomains || []))
      ));
      const items = Object.entries(QUOTAS).flatMap(([section, quota]) => eligible.filter((item) => item.section === section).slice(0, quota));
      const counts = Object.fromEntries(Object.keys(QUOTAS).map((section) => [section, items.filter((item) => item.section === section).length]));
      const shortages = Object.fromEntries(Object.entries(QUOTAS).map(([section, quota]) => [section, quota - counts[section]]));
      return { items: structuredClone(items), shortages, provider: 'Demo', exhausted: items.length === 0 };
    }
  }

  class RadarCredentialStore {
    getConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem(RADAR_CONFIG_KEY));
        return { provider:'DeepSeek', modelId:DEFAULT_MODEL_ID, remember:false, dailyLimit:DEFAULT_DAILY_LIMIT, ...(saved || {}) };
      } catch { return { provider:'DeepSeek', modelId:DEFAULT_MODEL_ID, remember:false, dailyLimit:DEFAULT_DAILY_LIMIT }; }
    }

    getCredentials() {
      return {
        tavilyApiKey: sessionStorage.getItem(TAVILY_KEY) || localStorage.getItem(TAVILY_KEY) || '',
        deepseekApiKey: sessionStorage.getItem(DEEPSEEK_KEY) || localStorage.getItem(DEEPSEEK_KEY) || ''
      };
    }

    validateModel(modelId) {
      const value = String(modelId || '').trim();
      if (value.length < 3 || value.length > 64 || !/^deepseek-[a-z0-9][a-z0-9._-]*$/i.test(value)) {
        throw new Error('模型 ID 必须以 deepseek- 开头，仅包含字母、数字、点、下划线或连字符，长度为 3–64 个字符');
      }
      return value;
    }

    save({ tavilyApiKey, deepseekApiKey, modelId, remember, dailyLimit = DEFAULT_DAILY_LIMIT }) {
      const parsedLimit = Number(dailyLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) throw new Error('单日搜索上限必须是 1–50 的整数');
      const config = { provider:'DeepSeek', modelId:this.validateModel(modelId), remember:Boolean(remember), dailyLimit:parsedLimit, updatedAt:new Date().toISOString() };
      const tavily = String(tavilyApiKey || '').trim();
      const deepseek = String(deepseekApiKey || '').trim();
      if (!deepseek) throw new Error('请填写 DeepSeek API Key；Tavily API Key 可选');
      sessionStorage.removeItem(TAVILY_KEY); sessionStorage.removeItem(DEEPSEEK_KEY);
      localStorage.removeItem(TAVILY_KEY); localStorage.removeItem(DEEPSEEK_KEY);
      const target = config.remember ? localStorage : sessionStorage;
      if (tavily) target.setItem(TAVILY_KEY, tavily);
      target.setItem(DEEPSEEK_KEY, deepseek);
      localStorage.setItem(RADAR_CONFIG_KEY, JSON.stringify(config));
      return config;
    }

    rememberSessionDraft({ tavilyApiKey, deepseekApiKey }) {
      const tavily = String(tavilyApiKey || '').trim();
      const deepseek = String(deepseekApiKey || '').trim();
      if (tavily) sessionStorage.setItem(TAVILY_KEY, tavily);
      if (deepseek) sessionStorage.setItem(DEEPSEEK_KEY, deepseek);
      return this.getCredentials();
    }

    useSessionOnly() {
      const credentials = this.getCredentials(); const config = this.getConfig();
      localStorage.removeItem(TAVILY_KEY); localStorage.removeItem(DEEPSEEK_KEY);
      if (credentials.tavilyApiKey) sessionStorage.setItem(TAVILY_KEY, credentials.tavilyApiKey);
      if (credentials.deepseekApiKey) sessionStorage.setItem(DEEPSEEK_KEY, credentials.deepseekApiKey);
      localStorage.setItem(RADAR_CONFIG_KEY, JSON.stringify({ ...config, remember:false, updatedAt:new Date().toISOString() }));
    }

    clear() {
      localStorage.removeItem(RADAR_CONFIG_KEY);
      sessionStorage.removeItem(TAVILY_KEY); sessionStorage.removeItem(DEEPSEEK_KEY);
      localStorage.removeItem(TAVILY_KEY); localStorage.removeItem(DEEPSEEK_KEY);
    }
  }

  class RemoteRadarProvider {
    constructor({ tavilyApiKey, deepseekApiKey, modelId }) {
      this.tavilyApiKey = String(tavilyApiKey || '').trim();
      this.deepseekApiKey = String(deepseekApiKey || '').trim();
      this.modelId = String(modelId || DEFAULT_MODEL_ID).trim();
    }

    assertTrustedContext() {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      if (location.protocol !== 'https:' && !(location.protocol === 'http:' && local)) {
        throw new Error('真实 Radar 仅允许通过 HTTPS，或可信 localhost 的 HTTP 环境使用；双击 HTML 时请继续使用 Demo 模式');
      }
      if (!this.deepseekApiKey) throw new Error('请先在 Settings 保存 DeepSeek API Key；Tavily API Key 可选');
    }

    async post(path, payload, timeoutMs = 60000) {
      this.assertTrustedContext();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(path, {
          method:'POST', headers:{ 'Content-Type':'application/json' }, signal:controller.signal,
          body:JSON.stringify({ ...payload, credentials:{ tavilyApiKey:this.tavilyApiKey, deepseekApiKey:this.deepseekApiKey }, modelId:this.modelId })
        });
        const text = await response.text(); let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        if (!response.ok) {
          const error = new Error(body?.detail || body?.message || `Radar 服务请求失败（HTTP ${response.status}）`);
          error.status = response.status;
          throw error;
        }
        return body;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Radar 请求超时，请稍后重试');
        if (error instanceof TypeError) throw new Error('无法连接 Radar 后端，请确认 FastAPI 服务和反向代理已启动');
        throw error;
      } finally { clearTimeout(timer); }
    }

    async testConnection() { return this.post('/api/radar/test', {}); }
    async getNextBatch(profile, usedItemIds = []) {
      return this.post('/api/radar/explore', { profile, usedItemIds }, 240000);
    }
    async generateLife({ birthYear, worldId, worldLabel, direction = '' }) {
      return this.post('/api/life/generate', { birthYear, worldId, worldLabel, direction }, 240000);
    }
  }

  function normalizeLegacyItems(items = []) {
    return items.map((legacy) => {
      const match = CATALOG.find((item) => item.title === legacy.title);
      return match ? structuredClone(match) : { ...legacy, provider: 'Demo' };
    });
  }

  function usedIdsThroughLegacyIndex(index = 0) {
    const batchesSeen = Math.min(Math.max(Number(index) + 1, 1), DEMO_BATCHES.length);
    return CATALOG.filter((item) => Number(item.id.split('_')[1]) < batchesSeen).map((item) => item.id);
  }

  window.TaskFlowRadar = { DemoRadarProvider, RemoteRadarProvider, RadarCredentialStore, DEFAULT_MODEL_ID, DEFAULT_DAILY_LIMIT, DEFAULT_PROFILE, QUOTAS, normalizeLegacyItems, usedIdsThroughLegacyIndex };
})();
