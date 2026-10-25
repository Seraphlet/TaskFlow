# Toward the Sea｜设备迁移与开发交接

更新时间：2026-10-25
仓库：`git@github.com:Seraphlet/TaskFlow.git`
分支：`main`
功能交接基线：`04f4469 fix(ui): guard drawer drags and anchor sidebar footer`

## 1. 最重要的迁移提醒

GitHub 保存的是源码，不保存当前浏览器和服务器的全部运行数据。

| 内容 | 是否在 Git 中 | 换设备后的处理 |
| --- | --- | --- |
| HTML、CSS、JS、Python 后端、测试、背景图 | 是 | 从 GitHub clone 即可 |
| 浏览器 IndexedDB 中的 Tasks、Local Notes、暂存、待办、事件、模板、提醒、Radar 历史 | 否 | 旧设备 Settings 导出 JSON，新设备导入 |
| Memos 中的远端 Notes | 否，但数据在 Memos 服务器 | 新设备重新填写 Memos 地址和 Token 后读取 |
| Tavily、DeepSeek、Memos API Key | 否 | 新设备重新填写；不要提交到 Git |
| Windows 本地 `.env` | 否 | 如仍需要，使用安全渠道单独迁移，不要提交到 Git |
| 服务器 `server/data/radar.sqlite3` | 否，`server/data/` 已忽略 | 仍在原服务器则无需处理；迁移服务器时单独备份 |
| Nginx、systemd、证书配置 | 否，位于服务器系统目录 | 原服务器保留；更换服务器时单独迁移或重建 |

如果完全不导出浏览器 JSON，Local 数据不会出现在新设备。代码仍可完整拉取，Memos 远端笔记也仍在，但仅存在旧浏览器 IndexedDB 的内容将留在旧设备。

## 2. 产品命名与兼容边界

用户界面名称已经改为 **Toward the Sea**。

为避免历史数据失联，以下内部名称有意保留：

- GitHub 仓库和服务器目录：`TaskFlow`
- systemd 服务：`taskflow-radar.service`
- IndexedDB、localStorage、sessionStorage 的 `taskflow-*` 键
- Memos 元数据：`taskflow:meta:v1`
- 后端环境变量：`TASKFLOW_*`
- JavaScript 全局命名空间：`TaskFlow*`

不要只为统一名称而批量改动这些内部标识，除非同时设计并验证完整的数据迁移。

## 3. 新设备获取项目

### Windows 开发设备

```powershell
cd C:\Users\你的用户名\Desktop
git clone git@github.com:Seraphlet/TaskFlow.git
cd TaskFlow
git log -1 --oneline
```

应看到 `545f16c` 或更新提交。

前端基础功能可以直接双击 `index.html`。Playground 动态模块和真实 Radar/Life AI 建议通过 HTTP 启动：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8788
```

访问：`http://127.0.0.1:8788`

只检查静态前端时也可以：

```powershell
python -m http.server 4173
```

访问：`http://127.0.0.1:4173`

## 4. 现有服务器更新

当前服务器代码目录：`/var/www/html/TaskFlow`
当前 systemd 服务：`taskflow-radar.service`
当前网页路径：`https://memo.noahanna.online/taskflow/`

更新代码：

```bash
cd /var/www/html/TaskFlow
git status
git pull origin main
git log -1 --oneline
```

纯静态改动不要求重启 Nginx。包含 `server/` 后端修改时执行：

```bash
sudo systemctl restart taskflow-radar
sudo systemctl status taskflow-radar --no-pager
sudo journalctl -u taskflow-radar -n 50 --no-pager
```

检查站点：

```bash
curl -I https://memo.noahanna.online/taskflow/
```

浏览器使用 `Ctrl + Shift + R` 强制刷新版本化静态资源。

如需查看实际 systemd 配置位置和启动命令：

```bash
systemctl show taskflow-radar -p FragmentPath --value
sudo systemctl cat taskflow-radar
```

不要把服务名改成 `toward-the-sea`；界面名称变化不要求迁移 systemd 服务。

## 5. 当前架构

```text
index.html
├─ styles.css                         全站布局、首页、工作页和响应式样式
├─ js/app.js                          应用外壳、路由、页面渲染、事件委托
├─ js/storage.js                      IndexedDB 与 JSON 导入导出
├─ js/interaction-guards.js           编辑拖选防误触
├─ js/personal-workspace.js           暂存、待办、日历、提醒、模板领域规则
├─ js/notes.js                        Local / Memos Notes 与草稿
├─ js/classifications.js              内容类型与主题分类
├─ js/content-library.js              内容检索与展示
├─ js/radar.js                        Radar 凭证和前端 Provider
├─ js/playground/                     Music、Keyboard、Life Geometry
└─ server/app.py                      FastAPI、静态文件、Radar 与 Life API
```

前端无构建工具，主要使用传统 HTML、CSS、JavaScript 和 IndexedDB。后端是可选 FastAPI 服务。

## 6. 当前功能

- 首页 Bento 工作台与本地背景图
- Quick Capture 临时暂存、完成撤销、转个人待办
- 个人 To-do、日期、截止时间和提醒
- 月历、独立事件和到期提醒中心
- 本地模板中心、变量填充、搜索、分类、收藏和复制
- Task 管理、进度更新、Activity 和交接历史
- Local / Memos Notes、草稿恢复和标题为空正文兼容
- 内容分类、中文输入法兼容和稳定分类 ID
- Radar 的 Tavily / DeepSeek 联网发现、预算、缓存和历史
- Music、Keyboard、Life Geometry 数字艺术
- JSON V1–V7 合并导入与完整本地数据导出

左侧“个人管理”是默认折叠的 Accordion，包含暂存、待办、日历和模板。桌面端导航区独立滚动；“＋ 快速暂存”与本地状态卡片组成固定 Footer，不会因子菜单展开而移动。

Drawer 的遮罩关闭使用完整指针手势判断：只有 `pointerdown` 和 `pointerup` 都直接发生在遮罩层，才视为主动点击遮罩。由输入框开始的文字拖选即使在遮罩上松开，也不会关闭编辑器；关闭按钮仍保留未保存内容确认。

## 7. 本地数据与备份

IndexedDB 数据库版本为 V7。新增集合包括：

- `captures`
- `todos`
- `calendarEvents`
- `templates`
- `reminders`

原有 Tasks、Activity、Handoffs、Team、Notes、Notes Drafts 和 Radar 集合保持兼容。

JSON 导入按 ID 合并，相同 ID 保留当前本地数据，不覆盖。超过 24 小时的已完成暂存不会因为旧备份导入而恢复。

迁移浏览器数据：

1. 旧设备打开 Settings。
2. 点击“导出本地 JSON”。
3. 通过可信方式把 JSON 传到新设备。
4. 新设备打开 Settings，点击“导入 JSON”。
5. 检查 Tasks、Local Notes、暂存、待办、日历和模板。

API Key 不在 JSON 中，必须重新配置。

## 8. 后端运行数据与环境变量

默认 SQLite 路径：`server/data/radar.sqlite3`。目录被 `.gitignore` 排除。

常用环境变量：

- `TASKFLOW_RADAR_DATA_DIR`
- `TASKFLOW_IDENTITY_SECRET`
- `TASKFLOW_TAVILY_SEARCH_DEPTH`
- `TASKFLOW_TAVILY_MONTHLY_CREDIT_BUDGET`
- 兼容旧变量：`TASKFLOW_TAVILY_MONTHLY_BUDGET`

不要把真实 API Key、身份密钥、`.env` 或 SQLite 数据库提交到 GitHub。

## 9. 测试

Windows：

```powershell
$failed=$false
Get-ChildItem tests -Filter *.test.js | ForEach-Object {
  node $_.FullName
  if($LASTEXITCODE -ne 0){$failed=$true}
}
if($failed){exit 1}
.\.venv\Scripts\python.exe -m pytest -q
node --check js/app.js
git diff --check
```

当前基线结果：

- 17 组 JavaScript 测试通过
- Python：25 passed，4 个子测试通过
- 已知测试警告：Starlette TestClient 的 `httpx` 弃用提示，不影响当前通过结果

## 10. 最近关键提交

- `04f4469`：修复 Drawer 拖选释放到遮罩时意外关闭；固定侧边栏底部操作区
- `545f16c`：手风琴导航、编辑拖选防误触、Toward the Sea 显示名称
- `b074ab8`：增加设备迁移与开发交接文档
- `a5343b0`：个人暂存、待办、日历、提醒和模板中心
- `8960cdd`：仅标题 Notes 在 Memos 中不再显示为空
- `725a5c6`：Memos 分类元数据同步
- `4d6901c`：工作页面密度与 Notes 文字画布优化

## 11. 已知限制与人工验收

- 纯前端提醒只保证页面打开或重新打开后显示，不保证关闭网页时后台推送。
- Templates 仅本地保存，不同步 Memos。
- `file://` 下 Playground 动态模块和远端请求可能受浏览器安全策略限制。
- Memos 是否能从 `file://` 连接取决于服务器 CORS；正式使用建议 HTTPS 同源部署。
- 2026-10-25 已使用本机 Edge 桌面视口完成真实 Pointer 事件验收：从 Drawer 文本域按下、拖到遮罩松开后 Drawer 保持打开；取消放弃修改时保持打开；确认后关闭按钮正常关闭。
- 同次浏览器验收中，“个人管理”展开前后 Footer 顶部位置均为 `591.3125px`；导航区在 `488px` 可视高度内独立承载 `554px` 内容并滚动，Footer 底部保持在 `702px / 720px` 视口内。
- 后续若调整 Drawer、全局点击委托或侧边栏 Flex 结构，应重新执行 `tests/interaction_guards.test.js`、`tests/personal_workspace_ui_contract.test.js`，并复验上述真实拖选场景。

## 12. 当前阶段结论

截至 `04f4469`，本轮 Toward the Sea 功能开发与交互收口已完成，可以作为换设备后的稳定接手基线。后续工作应按新需求增量开展，不要重建项目、重置 IndexedDB 或批量重命名 `taskflow-*` 兼容标识。

## 13. 新任务接手建议

在新设备开始工作时先执行：

```bash
git status
git pull origin main
git log -5 --oneline
```

然后阅读：

1. 本交接文档
2. 根目录 `README.md`
3. 与任务直接相关的模块和测试

可以把下面文字直接发给新的开发 Agent：

> 请先阅读 `docs/Toward-the-Sea-Handoff-2026-10-25.md` 和 `README.md`，确认当前 Git 基线与工作区状态，再对 Toward the Sea 做增量修改。保留 `taskflow-*` 内部兼容标识，不重置 IndexedDB，不覆盖用户数据。修改后运行全部 JavaScript 和 Python 测试，并明确区分自动化验证与实际浏览器人工验收。
