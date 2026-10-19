# TaskFlow Workspace V1

一个无构建依赖的本地优先个人工作台，包含 Radar、Notes、Categories 和 Tasks。前端使用传统 HTML、CSS 和 JavaScript；任务、笔记以及 Radar Demo 无需后端即可使用。真实联网 Radar 通过可选的 FastAPI 服务调用 Tavily 与 DeepSeek。

## 运行

直接双击项目根目录中的 `index.html` 即可运行，无需启动服务。

双击模式下 Radar 使用内置 Demo Provider。要使用真实联网推荐，请安装 Python 3.11+ 并启动同源服务：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8788
```

浏览器访问 `http://127.0.0.1:8788`。HTTP 仅允许可信的 localhost 开发环境；正式部署必须使用 HTTPS。

也可以选择通过任意静态 HTTP 服务器访问，例如：

```powershell
python -m http.server 4173
```

浏览器访问 `http://127.0.0.1:4173`。

## 结构

```text
index.html              应用入口
styles.css              公共布局、组件与响应式样式
js/app.js               应用外壳、四个核心模块及交互
js/storage.js           IndexedDB Local Adapter 与 Remote Adapter 边界
js/notifications.js     通知事件、纯文本格式与未配置适配器
js/notes.js             Local / Memos Notes 适配器、凭据策略与 API 版本兼容
js/radar.js             Radar Item 模型、演示 Provider 与生成边界
server/app.py           FastAPI 静态入口、Tavily 搜索、DeepSeek 生成及生命周期存储
server/security.py      模型 ID 校验、凭证身份与内容指纹
requirements.txt        可选 Radar 后端依赖
tests/                  凭证安全、模型校验和 API 边界测试
```

## 数据与兼容性

- Tasks、Team、Activity、Handoffs、Local Notes 与 Radar Profiles / Batches 保存在当前浏览器的 IndexedDB 中。
- Categories 直接聚合 Note 的 `category` 字段，不维护独立分类数据库。旧 Note 中存在 `companyName` 时会兼容显示为 `Company`。
- Radar 的 Profile、当前 Batch 与探索历史分开保存。每个 Profile 独立恢复自己的当前批次和历史；切换方向不会覆盖其他方向。成功、无新内容、失败、中断及达到客户端限额都会留下历史记录。
- 内置 Provider 仍只有有限的演示 Radar Items。它不会循环三批内容，也不会把不匹配用户领域的固定内容伪装成生成结果；候选不足会在页面明确提示。
- 配置 Tavily 与 DeepSeek 凭证后，`Explore New` 会改用真实 Provider。每次最多生成 3 组搜索查询并优先使用 Tavily；仅在 Tavily 网络故障、限流或服务端错误时使用 DeepSeek Search 作为备用，Tavily 凭证错误仍会明确提示。缓存默认 24 小时；推荐历史默认保存 180 天，Inbox 最长保存 30 天。
- 联网探索最长等待 4 分钟；进行中前端会禁用重复操作并显示等待提示，后端也会按凭证身份拒绝并发探索。若浏览器曾提前断开但后端已经完成，下一次探索会从 Inbox 恢复尚未被该浏览器接收的批次。
- 客户端单日联网探索上限默认 3 次，可在 Settings 设置为 1–50；计数按当前设备的本地日期和浏览器数据计算，测试连接、演示探索、被互斥锁拒绝及达到限额的操作不消耗次数。
- 月度 Tavily 硬预算默认每组凭证身份 1000 次，可通过服务端 `TASKFLOW_TAVILY_MONTHLY_BUDGET` 调整。预算、缓存和跨 Profile 去重使用不可逆 HMAC 身份隔离，SQLite 数据在服务重启后继续有效。
- 已退役的 `companies` / `comments` 仓库仅为旧数据库和备份结构兼容而保留，不再加载到应用状态，也不再提供查看、编辑或迁移入口。
- JSON 导入采用合并策略，不覆盖具有相同 ID 的现有记录；V1–V5 备份均可兼容导入。Memos 远端数据和访问令牌不会进入导出文件。
- `file://` 存储可能被不同浏览器或文件路径隔离。启动时若 IndexedDB 不可用，应用会明确报错而不是静默丢失数据。

## Memos（可选）

Notes 默认使用 Local。Settings 中可填写自己的 Memos 地址和 Personal Access Token，先执行真实连接测试，再显式 Connect。令牌默认仅保存在当前浏览器会话；只有主动勾选“记住令牌”才会持久化。

支持官方 Memos 26.10 / Latest 的 `/api` 与 0.30–0.31 的 `/api/v1`，并使用 Bearer Token。应用只读取和操作带有 TaskFlow 标记的远端 Memos，不会删除其他来源内容。

浏览器从 `file://` 访问远端 Memos 可能因 CORS 或 `Origin: null` 被拒绝。应用不会绕过浏览器安全策略，也不会把 Token 发送给第三方代理；遇到此情况可继续使用 Local，或将静态页面部署到 Memos 允许的受信任来源。

Memos Server URL 可以填写实例根地址，也可以粘贴设置页链接；应用会自动提取 HTTPS 站点 origin，避免请求到 `/setting/api/...` 等错误路径。

## Radar 联网配置（可选）

Settings 中可以配置 Tavily API Key、DeepSeek API Key 和 DeepSeek Model ID。供应商固定为 DeepSeek，API Base URL 固定在后端，前端不能覆盖。默认模型 ID 为 `deepseek-flash`，当前该 ID 对应 DeepSeek V4.1 Flash；当前接口同时提供 `deepseek-v4-pro`。其他符合 `deepseek-*` 命名规则的模型仍会交由 DeepSeek 接口验证并返回明确错误。

Radar 的结构化 JSON 生成使用非思考模式，避免思考内容占用输出额度后截断最终 JSON；这不影响 DeepSeek Search 作为 Tavily 故障时的备用搜索能力。

API Key 默认写入 `sessionStorage`。只有用户主动勾选“长期保存在此设备”后才会写入 `localStorage`；取消勾选会立即清除持久化密钥并只保留当前会话副本，“清除配置”会同时清理两个位置。模型名称单独保存，不属于秘密。

Settings 输入的 Radar 密钥会即时保留在当前页面会话中，因此切换应用模块或刷新页面不会要求重复输入；关闭该页面会话后由浏览器清理。已有会话或长期密钥会以密码黑点回填，用户仍可用“显示/隐藏”按钮检查或修改。

密钥只通过同源 POST 请求 Body 发送，不进入 URL、TaskFlow JSON 导入导出、后端数据库、推荐消息或日志。后端仅为调用 Tavily 与 DeepSeek 在请求生命周期内使用明文 Key。浏览器长期存储不能抵御共享设备访问、同源恶意脚本或 XSS，建议只在个人可信设备启用。

生产环境建议由 Nginx 将站点与 `/api/radar/` 同源反向代理到 FastAPI，并启用 HTTPS。不要把 FastAPI 数据目录、Git 仓库或其他服务器文件配置为公开静态目录。
