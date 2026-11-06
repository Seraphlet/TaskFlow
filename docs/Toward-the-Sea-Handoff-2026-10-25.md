# Toward the Sea｜设备迁移、离职清理与开发交接

- 更新时间：2026-11-06
- 仓库：`git@github.com:Seraphlet/TaskFlow.git`
- 分支：`main`
- 服务器目录：`/var/www/html/TaskFlow`
- systemd 服务：`taskflow-radar.service`
- 线上地址：`https://memo.noahanna.online/taskflow/`

本文件路径保持不变，便于 README 和新设备继续引用。界面名称是 **Toward the Sea**，仓库名、服务名和兼容键仍保留 TaskFlow。

## 1. 离职清理电脑前必须完成

GitHub 只保存源码，不保存浏览器、服务器和本机凭证中的全部数据。

| 内容 | 是否在 Git 中 | 清理前处理 |
| --- | --- | --- |
| HTML、CSS、JS、Python、测试、文档、静态图片 | 是 | 确认本次提交已出现在 GitHub `main` |
| 浏览器 IndexedDB（Tasks、Local Notes、Radar、边际价值等） | 否 | Settings 导出 JSON，并安全保存到个人设备 |
| Memos 远端笔记 | 否 | 数据仍在 Memos；记录服务地址，Token 在新设备重新创建或填写 |
| Tavily、DeepSeek、Memos API Key | 否 | 不写入交接文档或 Git；新设备重新配置 |
| Windows `.env` | 否 | 如仍需要，通过可信方式单独迁移，禁止提交 Git |
| `server/data/radar.sqlite3` | 否 | 原服务器继续保留；迁移服务器时单独备份 |
| Nginx、systemd、Let's Encrypt 配置 | 否 | 位于服务器系统目录，不在仓库中 |

离职前清单：

1. 打开 Settings，执行“导出本地 JSON”。
2. 打开导出文件，确认 `schemaVersion` 为 `10`，且文件大小不是 0。
3. 将 JSON 保存到个人且可信的位置；不要留在待清理的公司电脑上。
4. 在 GitHub 网页确认 `main` 最新提交和本机 `git log -1 --oneline` 一致。
5. 记录服务器、Memos 和域名地址，但不要把 Token、API Key 或 `.env` 内容写入 Git。
6. 确认备份可用后，再清理公司电脑上的仓库、浏览器站点数据、SSH 私钥和凭证。

> 如果没有导出 JSON，仅存在旧浏览器 IndexedDB 的本地数据无法从 GitHub 恢复。API Key 也不会包含在 JSON 备份中。

## 2. 新设备恢复

### 2.1 拉取源码

```powershell
cd C:\Users\你的用户名\Desktop
git clone git@github.com:Seraphlet/TaskFlow.git
cd TaskFlow
git status
git log -1 --oneline
```

如果新设备还没有 GitHub SSH Key，先在新设备生成并添加到 GitHub，再执行 clone；不要复制公司设备的私钥到不可信位置。

### 2.2 本地运行

完整运行（推荐，支持 Radar / AI 后端）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8788
```

访问 `http://127.0.0.1:8788`。

只检查静态前端：

```powershell
python -m http.server 4173
```

访问 `http://127.0.0.1:4173`。多数基础功能也可双击 `index.html`，但动态模块、CORS 和 API 在 HTTP 环境更可靠。

### 2.3 恢复数据和凭证

1. Settings 导入离职前导出的 JSON。
2. 检查 Tasks、Local Notes、Radar 历史、暂存、待办、日历、模板和边际价值记录。
3. 重新填写 Memos、Tavily、DeepSeek 凭证。
4. Memos Notes 不与 Local Notes 自动合并；先确认当前数据源再编辑。

## 3. Ubuntu 服务器更新

本次主要是静态前端、IndexedDB、文档和测试更新，正常情况下无需重启 Nginx 或 FastAPI：

```bash
cd /var/www/html/TaskFlow
git status --short --branch
git pull --ff-only origin main
git log -1 --oneline
curl -I https://memo.noahanna.online/taskflow/
```

然后在浏览器打开站点并按 `Ctrl + Shift + R`。若 `git status` 显示服务器有本地修改，不要执行 `reset --hard`；先备份并确认差异。

未来提交包含 `server/` 或 Python 依赖变化时，再执行：

```bash
cd /var/www/html/TaskFlow
python3 -m pip install -r requirements.txt
sudo systemctl restart taskflow-radar
sudo systemctl status taskflow-radar --no-pager
sudo journalctl -u taskflow-radar -n 80 --no-pager
```

正确服务名是 `taskflow-radar.service`，不是 `taskflow.service`。查看实际配置：

```bash
systemctl show taskflow-radar -p FragmentPath --value
sudo systemctl cat taskflow-radar
```

## 4. 当前工程结构

```text
index.html
├─ styles.css                         全站、工作页、响应式和打印样式
├─ js/app.js                          应用外壳、路由、页面与事件委托
├─ js/storage.js                      IndexedDB V10、导入导出与兼容
├─ js/labor-life.js                   加班、工资等既有确定性计算
├─ js/marginal-planning.js            资金规划、事件冲击与可持续性计算
├─ js/evaluation-engine.js            统一安全 JSON 选择评估引擎
├─ js/notes.js                        Local / Memos Notes 与草稿
├─ js/personal-workspace.js           暂存、待办、日历、提醒和模板
├─ js/radar.js                        Radar 凭证和 Provider
├─ js/playground/                     数字艺术
├─ server/app.py                      FastAPI、Radar / Life API 与静态服务
├─ docs/marginal-value-architecture.md
└─ examples/evaluation-template-tool-value.json
```

前端仍是无构建工具的 HTML、CSS、JavaScript；后端是可选 FastAPI。不要为接手方便擅自迁移框架或重置 IndexedDB。

## 5. “边际价值”V10 架构

当前入口由四部分组成：

1. **基础事实记录**：工资、工时、生活成本等可复用事实。
2. **加班价值**：保留离散结算、补贴、溢价、费用、主观状态、曲线、打印和 AI 分析。
3. **资金规划**：计划收入、固定/弹性支出、目标、事件冲击和储备金方案。
4. **选择评估**：同一个安全 JSON 模板引擎驱动工具购买、工作机会、迁居等选择。

资金规划核心公式：

```text
C = I - E - F          # 当前可支配余额
R = C - P              # 完成目标后的余额
R_rem = R - X          # 已知事件后的余额
R_after = R_rem - x    # 模拟新增事件后的余额
```

储备金不会自动填补缺口，只有用户明确选择使用时才进入结果。事实、方案、计算快照分开保存，历史记录不会因为后来修改参数而被重算覆盖。

选择评估引擎：

- 使用白名单运算符解释模板，不使用 `eval` / `Function`。
- 内置模板与用户导入模板使用同一验证和计算路径。
- 内置模板包括工具购买、工作机会、迁居评估。
- 非法字段、未知运算符、除零和非有限数会返回明确错误。

模块间只显式传递必要事实：加班结果可写入事实，资金规划可读取事实，选择评估可以引用已确认参数；不会隐式覆盖其他模块数据。

## 6. IndexedDB 与备份兼容

当前数据库版本：**V10**。

V8 既有集合继续保留：

- `salaryRecords`
- `overtimeDecisions`
- `livingRecords`
- `laborParameters`
- `jobComparisons`

V10 新增：

- `fundScenarios`
- `evaluationTemplates`
- `evaluationRecords`

Tasks、Activity、Handoffs、Team、Notes、Notes Drafts、Radar、个人工作区集合均保持。导入器支持 V1–V10；相同 ID 默认保留当前本地记录，避免旧备份静默覆盖新数据。API Key 不参与导入导出。

不要删除旧 store、批量改 `taskflow-*` 键，或把旧记录原地转换成新结构。需要迁移时先增加版本、兼容读取和回滚测试。

## 7. 必须保留的内部名称

用户界面名称是 **Toward the Sea**，但以下内部标识为兼容历史数据而保留：

- GitHub 仓库与服务器目录：`TaskFlow`
- systemd：`taskflow-radar.service`
- IndexedDB / Web Storage：`taskflow-*`
- Memos 元数据：`taskflow:meta:v1`
- 后端环境变量：`TASKFLOW_*`
- JavaScript 全局命名空间：`TaskFlow*`

## 8. 验证基线

提交前应执行：

```powershell
node --test tests/*.test.js
node --check js/app.js
node --check js/storage.js
node --check js/marginal-planning.js
node --check js/evaluation-engine.js
git diff --check
```

2026-11-06 基线：27 个 JavaScript 测试文件全部通过。已在真实浏览器验证：

- 保存基础事实。
- 资金规划示例得到 `4550` 元余额。
- 目标与事件后出现 `-150` 元缺口，且未自动使用储备金。
- 保存资金方案快照。
- 三种选择模板可计算并保存。
- 公式说明抽屉可打开。
- IndexedDB 正常升级到 V10。

## 9. 已知限制

- 浏览器本地数据不等于云备份；清除站点数据会丢失未导出的内容。
- 资金预测是确定性情景计算，不是投资、法律或财务建议。
- 疲劳、意愿和时间价值属于个人输入，不是医学量表，也不应被模型伪装成客观事实。
- 选择评估模板是辅助比较，不替用户作最终决定。
- 税前和税后收入缺少换算依据时不会自动混合比较。
- `file://` 下动态 import、远端请求和 CORS 可能受浏览器限制。
- 服务器 SQLite、Nginx、systemd 和证书不在 GitHub 中，需要服务器级备份。

## 10. 固定接手流程

新设备或新 Agent 开始前：

```bash
git status --short --branch
git pull --ff-only origin main
git log -5 --oneline
```

阅读顺序：

1. 本交接文档。
2. `README.md`。
3. `docs/marginal-value-architecture.md`。
4. `js/storage.js`、`js/marginal-planning.js`、`js/evaluation-engine.js`。
5. 对应测试文件。

推荐交给下一位开发者的开场说明：

> 请在 Toward the Sea 当前 `main` 上增量开发。先阅读交接文档和边际价值架构说明，运行全部测试；保留 IndexedDB V1–V10、Memos 元数据、`taskflow-*` 键和服务器服务名兼容，不重建项目、不清空数据。任何修改先验证现状，再做最小变更。

边际价值重构前的本地回滚基线为 `8cad8f0`。本次重构对应提交以 GitHub `main` 上提交信息 `feat: rebuild marginal value architecture` 为准。
