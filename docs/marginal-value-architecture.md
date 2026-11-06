# 边际价值新架构

回滚基线：`8cad8f0`。新架构只增加存储集合和计算模块，不删除或迁移旧记录。

## 模块边界

- 基础事实：工资工时、月度收入与生活支出、固定义务、储备投入、储备余额与安全线。空白为未知，`0` 为用户确认的零值。
- 加班价值：继续使用既有 V2/V4 公式、状态记录、打印与 AI 解释。
- 资金规划：`C = I - E - F`、`R = C - P`、`R_rem = R - X`；支出后为负时只展示缺口和中性方案，不自动减少储备投入或使用储备金。
- 选择评估：三个内置模板和所有导入模板共用 `evaluation-engine.js`。引擎只支持数字、标识符、算术运算和白名单函数，不使用 `eval` 或 `Function`。

旧 `salaryRecords`、`livingRecords`、`jobComparisons` 等集合仍原样保留。V10 只新增 `fundScenarios`、`evaluationTemplates`、`evaluationRecords`。历史记录保存原始输入、模板/公式版本和结果快照，之后升级公式不会静默重算旧结论。

## JSON 模板

必需字段为 `schemaVersion`、`id`、`name`、`inputs`、`formulas`、`outputs`。可选 `exploration` 与 `cashflows`。允许函数：`min`、`max`、`abs`、`ceil`、`floor`、`round`、`sqrt`、`pow`、`safeDiv`。模板限制输入和公式数量、表达式长度与探索点数，并检查未知引用、循环依赖、范围和除零。

可导入示例：`examples/evaluation-template-tool-value.json`。同 ID 模板不会覆盖；应修改 ID 后重新导入。删除自定义模板不会删除已经保存的评估历史。内置模板不能删除，但可复制。

## 模块交接

模块间只传递显式 `Scenario` 快照。选择评估只能把模板声明的实际 `cashflows` 交给资金规划；经济成本、残值或时间价值不会自动变成现金流。带入后先进入未保存预览，用户再次明确保存才写入历史。
