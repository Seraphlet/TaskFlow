# TaskFlow Workspace V1

一个无构建依赖的本地优先网页工具，包含 TaskFlow、公司吐槽墙和 Settings。项目使用传统 HTML、CSS 和 JavaScript，不依赖 Python、Node.js 或前端构建工具。

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
```

V1 数据均存储在当前浏览器的 IndexedDB 中。JSON 导入采用合并策略，不覆盖具有相同 ID 的现有记录。
