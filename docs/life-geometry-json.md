# Life Geometry JSON 契约（V1）

Life Geometry 把数据分成三层：`person-template` 描述人物条件与候选经历，世界包描述年份范围内的环境规则，`life-result` 只记录一次已经实际发生的人生。Canvas 只消费结果，不决定事件。

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

## 人生结果 / 固定故事

- `kind`: `life-result`。
- `metadata.mode`: 开放推演结果为 `open`；不可改写的导入故事为 `fixed`。
- `timelineType`: `age` 或 `story-time`。无明确年龄的小说应使用 `story-time`。
- `primaryCharacterId`: 主线人物 ID。
- `characters`: 人物、显示区间、生命终点与状态采样。
- `events`: 已发生事件；`characterId` 必须有效，`age` 必须可排序。
- `relationships`: 双方 ID、关系分段与结束原因。分离不等于死亡。
- `candidateResolutions`: 候选事件最终是 `preserved`、`delayed`、`changed`、`cancelled` 或 `terminated`。
- `endAge`: 整个画面的终点，可晚于主角死亡，以表现世界仍在继续。

导入器只读取 JSON 数据，不执行脚本，也不会把文本当作 HTML。完整示例见 `examples/life-person-template.json` 与 `examples/life-fixed-story.json`。

## AI 离线创作

作品的“导入人生与创作工具”面板内置可复制提示词。AI 只用于网页外预生成 JSON，运行时不调用任何模型。生成后应先经过本地校验；真实人物或事实资料必须明确来源与事实边界，虚构内容须标注为虚构。
