# Life Geometry JSON 契约（V1）

Life Geometry 把数据分成四层：`person-template` 描述人物条件与候选经历，世界包描述年份范围内的环境规则，面向 AI 的 `life-story` 描述固定故事，内部 `life-result` 记录可直接绘制的人生。Canvas 只消费结果，不决定事件。

## 人物模板

- `schemaVersion`: 当前为 `1.0`。
- `kind`: `person-template`。
- `mode`: `open`，表示允许世界规则重新推演。
- `metadata`: 标题、是否虚构、资料依据说明。
- `person`: `id`、`name`、`birthConditions`、`traits`、`expectedLifespan`。
- `relatedCharacters`: 有独立生命终点的关联人物。
- `candidateEvents`: 候选事件。每项包含结构化 `type`、`preferredAge`、`ageRange`、`probability`、`conditions`、`effects`；可选 `fallback` 表示条件不满足时的替代经历。

`conditions.requiresFlags` 表示前置结果。例如职业事件要求 `university`，大学被中断后职业不能无条件发生。`effects.death=true` 会终止本人全部未来候选事件。描述文字不参与规则判断。

## 世界规则

内置世界包与人物模板独立，包含 `base`、按年份生效的 `stages` 和 `incidents`。当前世界均明确标注为 `artistic-simulation`，是受现实规律启发的艺术模拟，不宣称为真实历史统计模型。

当前年份始终为 `出生年份 + 年龄`。引擎在每一年重新读取世界状态，因此同一人物更换出生年份后可得到不同经历，原始人物模板不会被修改。

## AI 固定故事（推荐导入格式）

AI 应输出 `kind: "life-story"`，不需要生成 `annualStates` 或 Canvas 坐标。网页负责校验并转换为统一的 `life-result`。

- `timelineType`: `age` 或 `story-time`。
- `primaryCharacterId`: 必须引用 `characters` 中存在的人物。
- `characters`: `id`、`name` 必填；`birthTime`、`endTime`、`initialState` 可选。
- `events`: `id`、`characterId`、`time`、`type`、`title` 必填；`description`、`stateChanges` 可选。
- `stateChanges`: 只接受健康、资源、情绪、教育、稳定性五个 -1–1 的增量。
- `relationships`: 使用统一时间轴上的 `startTime`、`endTime`，分离不等于死亡。

所有事件时间都使用同一条世界时间轴。不同出生时间人物的 `time: 30` 表示同一个世界时刻，而不是所有人都是 30 岁。转换器会自动排序事件、补齐人物时间区间、应用状态变化并生成绘图状态采样。

## 内部人生结果 / 旧版固定故事

- `kind`: `life-result`。
- `metadata.mode`: 开放推演结果为 `open`；不可改写的导入故事为 `fixed`。
- `timelineType`: `age` 或 `story-time`。无明确年龄的小说应使用 `story-time`。
- `primaryCharacterId`: 主线人物 ID。
- `characters`: 人物、显示区间、生命终点与状态采样。
- `events`: 已发生事件；`characterId` 必须有效，`age` 必须可排序。
- `relationships`: 双方 ID、关系分段与结束原因。分离不等于死亡。
- `candidateResolutions`: 候选事件最终是 `preserved`、`delayed`、`changed`、`cancelled` 或 `terminated`。
- `endAge`: 整个画面的终点，可晚于主角死亡，以表现世界仍在继续。

导入器只读取 JSON 数据，不执行脚本，也不会把文本当作 HTML。完整示例：

- `examples/life-person-template.json`：开放人物模板。
- `examples/life-fixed-story.json`：旧版完整结果契约。
- `examples/life-multi-person-story.json`：推荐给 AI 的简化多人物故事。
- `examples/life-invalid-example.json`：故意包含重复 ID、越界状态、无效引用和死亡后事件，用于验证字段级错误提示。

## AI 离线创作

作品的“导入人生与创作工具”面板内置可复制提示词及完整 `life-story` 示例。AI 只用于网页外预生成 JSON，运行时不调用任何模型。生成后会依次经过语法解析、字段校验、引用校验、时间和生死一致性校验、状态规范化，再进入统一渲染器。真实人物或事实资料必须明确来源与事实边界，虚构内容须标注为虚构。
