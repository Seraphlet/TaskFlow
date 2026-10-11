# TaskFlow Workspace V1

一个无构建依赖的本地优先网页工具，包含 TaskFlow、Notes、Company Watch 和 Settings。项目使用传统 HTML、CSS 和 JavaScript，不依赖 Python、Node.js 或前端构建工具。

## 运行

直接双击项目根目录中的 `index.html` 即可运行，无需启动服务。

也可以选择通过任意静态 HTTP 服务器访问，例如：

```powershell
python -m http.server 4173
```

浏览器访问 `http://127.0.0.1:4173`。

## 结构

```text
index.html              应用入口
styles.css              公共布局、组件与响应式样式
js/app.js               应用外壳、TaskFlow、公司墙及交互
js/storage.js           IndexedDB Local Adapter 与 Remote Adapter 边界
js/notifications.js     通知事件、纯文本格式与未配置适配器
js/notes.js             Local / Memos Notes 适配器、凭据策略与 API 版本兼容
```

## 数据与兼容性

- Tasks、Team、Activity、Handoffs、Local Notes 与旧版公司墙数据保存在当前浏览器的 IndexedDB 中。
- Company Watch 直接聚合 Notes 中填写了 `companyName` 的记录，不另建重复数据库。
- 原 `companies` / `comments` 数据结构仍保留，可在 Settings 中显式复制到 Local Notes；迁移不删除旧数据并按固定 ID 去重。
- JSON 导入采用合并策略，不覆盖具有相同 ID 的现有记录；V1 备份仍可导入。Memos 远端数据和访问令牌不会进入导出文件。
- `file://` 存储可能被不同浏览器或文件路径隔离。启动时若 IndexedDB 不可用，应用会明确报错而不是静默丢失数据。

## Memos（可选）

Notes 默认使用 Local。Settings 中可填写自己的 Memos 地址和 Personal Access Token，先执行真实连接测试，再显式 Connect。令牌默认仅保存在当前浏览器会话；只有主动勾选“记住令牌”才会持久化。

支持官方 Memos 26.10 / Latest 的 `/api` 与 0.30–0.31 的 `/api/v1`，并使用 Bearer Token。应用只读取和操作带有 TaskFlow 标记的远端 Memos，不会删除其他来源内容。

浏览器从 `file://` 访问远端 Memos 可能因 CORS 或 `Origin: null` 被拒绝。应用不会绕过浏览器安全策略，也不会把 Token 发送给第三方代理；遇到此情况可继续使用 Local，或将静态页面部署到 Memos 允许的受信任来源。

Memos Server URL 可以填写实例根地址，也可以粘贴设置页链接；应用会自动提取 HTTPS 站点 origin，避免请求到 `/setting/api/...` 等错误路径。
