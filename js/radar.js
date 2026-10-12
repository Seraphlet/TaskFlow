(() => {
  const BATCHES = [
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

  function batch(index) {
    return BATCHES[index % BATCHES.length].map((item, order) => ({
      id: `radar_${index}_${order}`,
      section: item[0], title: item[1], domain: item[2], explanation: item[3],
      why: item[4], sourceName: item[5], sourceUrl: item[6]
    }));
  }

  window.TaskFlowRadar = { batch, batchCount: BATCHES.length };
})();
