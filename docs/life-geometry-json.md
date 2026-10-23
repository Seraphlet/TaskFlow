# Life Geometry JSON 契约（V4）

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
- `relationships`: 推荐填写 `relationType`（`parent-child`、`partner`、`friend`、`classmate`、`colleague`、`acquaintance`、`caregiver`、`sibling`、`relative`、`other`）以及 `segments`。每段包含统一时间轴上的 `fromTime`、`toTime`、`status` 和可选的 `eventIds`；旧版 `startTime`、`endTime` 仍兼容。

`status` 支持 `meeting`、`close`、`distant`、`reconnecting`、`ended`，分别表示相遇、陪伴、疏远、重联和关系终止。`eventIds` 必须引用已有事件，用于说明关系变化的故事依据。关系状态只控制人物轨迹的靠近程度和可见性；淡出不会删除人物、事件或关系数据。

所有事件时间都使用同一条世界时间轴。不同出生时间人物的 `time: 30` 表示同一个世界时刻，而不是所有人都是 30 岁。人物年龄统一按 `event.time - character.birthTime` 推导，并在内部事件的 `characterAge` 中保留。转换器会自动排序事件、补齐人物时间区间、应用状态变化并生成绘图状态采样。

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
- `examples/life-v4-ensemble-story.json`：覆盖毕业分流、短暂交集、家庭代际、意外离世、主角先离世和失联重逢的完整群像故事。
- `examples/life-invalid-example.json`：故意包含重复 ID、越界状态、无效引用和死亡后事件，用于验证字段级错误提示。

## AI 生成与离线创作

“AI 生成人生”复用 Settings 中 Radar 的 DeepSeek Key 和模型 ID，通过同源 `/api/life/generate` 调用固定可信的 DeepSeek 地址；前端不新增或持久化第二份凭证。后端要求模型先构建人物与关系，再生成各人物独立事件和关系交集，并在返回浏览器前执行结构、唯一 ID、引用、独立人生、出生/死亡、亲子代际、事件边界、关系区间和 `eventIds` 校验；仅对不改变含义的重复事件/关系 ID 做确定性修复，其余问题要求模型完整重写一次。两次仍失败时保留当前播放结果。

作品的“导入人生与创作工具”仍内置可复制提示词和完整 `life-story` 示例，可在后端不可用时从其他工具生成后人工导入。离线规则模式不需要任何 API。三个入口都要经过前端校验、排序、状态规范化与轨迹预计算后才进入统一渲染器。真实人物或事实资料必须明确来源与事实边界，虚构内容须标注为虚构。
