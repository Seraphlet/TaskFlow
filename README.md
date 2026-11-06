# Toward the Sea V1

一个无构建依赖的本地优先个人工作台，包含 Home、临时暂存、个人待办、日历提醒、模板中心、边际价值、Radar、Notes、Categories、Tasks 和按需加载的 Playground。前端使用传统 HTML、CSS 和 JavaScript；首页只聚合已有本地数据，个人事项、边际价值记录、任务、笔记以及 Radar Demo 无需后端即可使用。真实联网 Radar 通过可选的 FastAPI 服务调用 Tavily 与 DeepSeek。

更换开发设备或重新接手项目时，请先阅读 [`docs/Toward-the-Sea-Handoff-2026-10-25.md`](docs/Toward-the-Sea-Handoff-2026-10-25.md)。

首页背景固定引用 `images/home-background.webp`。更换壁纸时直接覆盖同名文件即可，不需要修改源码。FastAPI 静态服务会返回 `Cache-Control: public, max-age=0, must-revalidate`，并通过 ETag / Last-Modified 复用未变化的图片。直接双击 `index.html` 的 `file://` 模式不具备 HTTP 条件缓存语义。

如果使用当前常见的 Nginx `/taskflow/` 静态路径部署，请把下面的精确匹配放在同一个 HTTPS `server` 中；路径不同时同步调整 URL 和文件位置：

```nginx
location = /taskflow/images/home-background.webp {
    alias /var/www/html/TaskFlow/images/home-background.webp;
    etag on;
    if_modified_since exact;
    add_header Cache-Control "public, max-age=0, must-revalidate" always;
}
```

## 运行

直接双击项目根目录中的 `index.html` 仍可使用原有工作台功能。Playground 的三个作品按任务要求使用 ES Module `import()`；Chrome、Edge 等浏览器会阻止 `file://` 页面加载本地模块，因此使用 Playground 时请启动下方任一 HTTP 服务。

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
js/app.js               应用外壳、首页与四个核心模块交互
js/storage.js           IndexedDB Local Adapter 与 Remote Adapter 边界
js/notifications.js     通知事件、纯文本格式与未配置适配器
js/classifications.js   内容类型与主题分类的稳定 ID、本地配置和兼容发现
js/notes.js             Local / Memos Notes 适配器、凭据策略与 API 版本兼容
js/content-library.js   内容类型兼容、组合检索、高亮与来源链接校验
js/radar.js             Radar Item 模型、演示 Provider 与生成边界
js/personal-workspace.js 暂存、待办、提醒、月历与模板变量的领域规则
js/labor-life.js         工资、加班、生活成本、储蓄预测与工作比较的纯计算规则
js/marginal-planning.js  基础事实、月度预算、安全线、事件和资金路径计算
js/evaluation-engine.js  选择评估的安全 JSON 公式解析、验证、计算与探索
js/playground/           按需加载的 Music、Keyboard 与 Life Geometry 独立作品及人生引擎
docs/                   Life Geometry JSON 契约说明
examples/               可直接导入的人物模板与固定故事 JSON
server/app.py           FastAPI 静态入口、Tavily 搜索、DeepSeek 生成及生命周期存储
server/security.py      模型 ID 校验、凭证身份与内容指纹
requirements.txt        可选 Radar 后端依赖
tests/                  凭证安全、模型校验和 API 边界测试
```

## Playground

进入“数字艺术”只显示作品列表，不请求作品模块。选择作品后，`app.js` 才通过动态 `import()` 加载对应模块；同时最多保留一个实例。每个作品都实现 `createArtwork(container)`，并返回 `start()`、`pause()`、`destroy()`。切换作品、返回列表或离开 Playground 时会取消动画帧、停止音频、移除键盘和页面可见性监听、断开观察器并释放大规模轨迹引用。

- Music Geometry《音乐的一生》恢复为用户确认过的一束主丝带和最多三束动态伴随丝带，不再单独绘制节拍线。音量、起音密度和频谱层次仍分别控制原有丝带的力度、细节与层次；标签页捕获、本地文件、演示、尾迹、连续视口和性能优化保持不变。
- Keyboard Art 仅在作品运行时监听 A–K，输入框和可编辑区域不会触发绘画；长按有节流，画面实体有硬上限。首次按键时才创建 Web Audio 上下文，通过振荡器合成八类轻量音效，并提供静音和音量控制；同时发声数有上限。
- Life Geometry《万千人生》V4 以统一世界时间承载每个人独立的出生、事件、关系和死亡。关系分段驱动相遇、陪伴、疏远、重联与终止；淡出只改变可见性，不删除人物数据，主角去世后其他在世人物仍会继续。AI 入口直接复用 Radar 的 DeepSeek 配置与同源后端，不新增密钥设置；人工 JSON 导入和离线规则生成继续可用。AI 输出必须通过 Pydantic 结构校验以及人物 ID、独立事件、出生/死亡、亲子代际、关系区间和关联事件校验，失败自动要求模型修复一次。三种入口最终都转为同一种 `life-result` 并在播放前完成轨迹与节点预计算；曲线、节点和点击命中共享坐标。可导入的完整群像示例位于 `examples/life-v4-ensemble-story.json`，格式契约见 `docs/life-geometry-json.md`。

标签页捕获依赖浏览器共享授权，不能静默启动。建议使用最新版桌面版 Chrome 或 Edge，并在共享选择器中选择浏览器标签页、勾选“共享标签页音频”。Firefox、Safari、移动端浏览器以及某些操作系统共享目标可能不提供音频轨道，此时使用演示或本地文件模式。

## 数据与兼容性

- Tasks、Team、Activity、Handoffs、Local Notes、Notes 草稿、Radar Profiles / Batches，以及 Captures、Todos、Calendar Events、Templates、Reminders 分别保存在当前浏览器的 IndexedDB 独立集合中。
- “边际价值”（原“劳动与生活”，内部路由和旧存储键保持兼容）采用“基础事实 + 加班价值 + 资金规划 + 选择评估”。工资、生活与旧职业比较记录继续保存在原集合中且可查看；V10 新增资金方案、自定义评估模板和评估历史三个集合。每条历史记录保存原始事实、公式/模板版本与计算快照，之后修改默认参数不会改写过去的判断。资金缺口不会自动减少储备计划或动用储备金；模板引擎不使用 `eval`，导入模板必须通过引用、循环、复杂度、范围和除零校验。详细契约见 [`docs/marginal-value-architecture.md`](docs/marginal-value-architecture.md)。
- 工资记录 V2 以月份为主键，实际总工时按“实际工作天数 × 每日工时 + 工作日额外加班小时”计算；周末和法定节假日天数用于工时分类与理论加班估算，不会再次叠加到实际总工时。旧版日期范围和 1.5 / 2 / 3 倍工时记录继续按原公式读取与编辑，不会被静默迁移或重算。
- 加班价值 V1 以 0.5 小时为离散步长，同时展示总加班收入、净现金收益、综合净价值及其离散变化率。打车、外卖、自定义消费和夜班补贴只在加班时长大于 0 时参与计算；正数自定义项表示新增支出，负数表示节省支出。旧版加班决策快照继续按原公式查看，主动编辑时会明确保留旧固定支出、每小时支出和通勤参数。
- 加班价值的“打印 / 保存 PDF”使用浏览器原生打印对话框与 A4 专用样式，直接读取当前未保存试算并复用矢量 SVG 曲线，不会自动创建历史记录。表单提交和直接写入操作使用按动作与记录 ID 隔离的运行期互斥锁；Notes 草稿仍使用原有修订队列与 Web Locks，Radar 探索仍使用原有前后端互斥。开发排查保存耗时时可在 URL 添加 `?saveTiming=1`，正常使用不会输出这些计时日志。
- 加班价值 V2 支持按实际时长或完整单位结算工资、达标一次性补贴和多档补贴（取最高已达档），并保留门槛跳变。收入、相对正常时薪的溢价、固定与随时长变化的额外成本、实际额外占用时间及净时薪均由确定性函数计算。用户可设置独立于正常时薪的“最低接受净时薪”，曲线按 0.5 小时有效节点标出现金回本、个人接受临界点和可接受区间；没有任何正时长满足要求时会明确保留“不加班”结果。疲劳与继续加班意愿以独立的 0～100 真实记录保存，未填写保持“未记录”，不会自动折算成金额；无 AI 时确定性计算和基础提示仍可完整使用。
- 临时暂存用于无结构的快速收集；待处理内容长期保留，完成内容可立即撤销并在 24 小时后自动清理。转为个人待办使用稳定来源关联，重复操作不会创建第二条待办。个人待办与可交接的 Task 是两套独立数据。
- 日历只聚合指定日期的个人待办与独立事件，不复制其正文。提醒引用待办或事件 ID，并记录已读/忽略状态；网页关闭时不承诺后台通知，重新打开后会补显已到期提醒。
- 模板中心只保存模板原文、分类与收藏状态；`{{变量}}` 在预览和复制时临时填充，空值继续保留占位符，不会修改模板原文。模板不会同步到 Memos。
- Notes 草稿按数据源与 Note ID 隔离并自动保存；刷新或关闭后会恢复上次打开的草稿。正式保存成功才清除草稿，失败仍保留。Web Locks 可用时使用单编辑锁，并始终以修订号阻止旧异步写入覆盖新内容。
- Categories 直接复用 Notes 数据，不维护独立分类数据库。Note 可增量保存 `contentType`、`purpose`、`sourceUrl` 与 `pinned`；内容类型和主题分类在 Settings 统一管理，使用稳定 ID 保持重命名兼容。两类分类可组合筛选，并支持多关键词、可自定义快捷标签、命中高亮、全文展开与复制。旧 Note 缺少新字段时默认作为“笔记”读取，存在 `companyName` 时继续兼容显示为 `Company`。
- Radar 的 Profile、当前 Batch 与探索历史分开保存。每个 Profile 独立恢复自己的当前批次和历史；切换方向不会覆盖其他方向。成功、无新内容、失败、中断及达到客户端限额都会留下历史记录。
- 内置 Provider 仍只有有限的演示 Radar Items。它不会循环三批内容，也不会把不匹配用户领域的固定内容伪装成生成结果；候选不足会在页面明确提示。
- DeepSeek Key 是真实联网的必需凭证，Tavily Key 可选。配置 Tavily 时优先使用 Tavily；未配置、月度 credits 不足、网络故障、限流或服务端错误时使用官方 DeepSeek Search。Tavily 凭证错误仍会明确提示。每次最多生成 3 组搜索查询，候选已足够时提前停止；缓存默认 24 小时，命中缓存不会新增外部请求。推荐历史默认保存 180 天，Inbox 最长保存 30 天。
- 联网探索最长等待 4 分钟；进行中前端会禁用重复操作并显示等待提示，后端也会按凭证身份拒绝并发探索。若浏览器曾提前断开但后端已经完成，下一次探索会从 Inbox 恢复尚未被该浏览器接收的批次。
- 客户端单日联网探索上限默认 3 次，可在 Settings 设置为 1–50；计数按当前设备的本地日期和浏览器数据计算，测试连接、演示探索、被互斥锁拒绝及达到限额的操作不消耗次数。
- Tavily 搜索深度默认 `basic`（官方计费 1 credit）；`advanced` 为 2 credits。可通过 `TASKFLOW_TAVILY_SEARCH_DEPTH=basic|advanced|fast|ultra-fast` 调整。月度硬预算默认每组凭证身份 1000 credits，通过 `TASKFLOW_TAVILY_MONTHLY_CREDIT_BUDGET` 调整（旧变量 `TASKFLOW_TAVILY_MONTHLY_BUDGET` 仍兼容）。请求发出前原子预留 credits，成功响应优先使用官方 `usage.credits` 结算；响应无法确认时保留保守预留并在历史中标记。预算、缓存和跨 Profile 去重使用不可逆 HMAC 身份隔离，SQLite 数据在服务重启后继续有效。
- 已退役的 `companies` / `comments` 仓库仅为旧数据库和备份结构兼容而保留，不再加载到应用状态，也不再提供查看、编辑或迁移入口。
- JSON 导入采用合并策略，不覆盖具有相同 ID 的现有记录；V1–V10 备份均可兼容导入。V7 备份包含个人暂存、待办、事件、模板和提醒，V8 增加原边际价值数据，V9 增加独立的加班状态记录，V10 增加资金方案、评估模板和评估历史；导入时已经超过保留期限的已完成暂存会被跳过。Memos 远端数据和访问令牌不会进入导出文件。
- `file://` 存储可能被不同浏览器或文件路径隔离。启动时若 IndexedDB 不可用，应用会明确报错而不是静默丢失数据。

## Memos（可选）

Notes 默认使用 Local。Settings 中可填写自己的 Memos 地址和 Personal Access Token，先执行真实连接测试，再显式 Connect。令牌默认仅保存在当前浏览器会话；只有主动勾选“记住令牌”才会持久化。

支持官方 Memos 26.10 / Latest 的 `/api` 与 0.30–0.31 的 `/api/v1`，并使用 Bearer Token。应用只读取和操作由 Toward the Sea 创建的远端 Memos，不会删除其他来源内容。为保持已有数据兼容，记录继续使用 `taskflow:meta:v1` 元数据标记；Toward the Sea 编辑和展示时会隐藏该块。旧版正文开头的 Base64 标记仍可读取，并会在下次保存时迁移。损坏或重复的新版标记不会被猜测性删除，正文内容、Markdown、普通 HTML 注释和换行会原样保留。

仅填写标题的远端 Note 会把标题同时作为 Memos 可见文本，并通过 `titleOnly` 元数据在 Toward the Sea 中恢复为“标题有值、正文为空”；后续增加或删除正文时会自动切换，不会重复追加标题。

分类配置本身保存在当前浏览器。尚未被笔记引用的自定义分类不会跨设备同步；被 Memos 笔记引用后，分类 ID 与名称会随该笔记元数据恢复。删除已有引用的分类时，界面会要求先选择迁移目标。

浏览器从 `file://` 访问远端 Memos 可能因 CORS 或 `Origin: null` 被拒绝。应用不会绕过浏览器安全策略，也不会把 Token 发送给第三方代理；遇到此情况可继续使用 Local，或将静态页面部署到 Memos 允许的受信任来源。

Memos Server URL 可以填写实例根地址，也可以粘贴设置页链接；应用会自动提取 HTTPS 站点 origin，避免请求到 `/setting/api/...` 等错误路径。

## Radar 联网配置（可选）

Settings 中可以配置必需的 DeepSeek API Key、可选的 Tavily API Key 和 DeepSeek Model ID。供应商固定为 DeepSeek，API Base URL 固定在后端，前端不能覆盖。默认模型 ID 为 `deepseek-flash`，当前该 ID 对应 DeepSeek V4.1 Flash；当前接口同时提供 `deepseek-v4-pro`。其他符合 `deepseek-*` 命名规则的模型仍会交由 DeepSeek 接口验证并返回明确错误。连接测试只验证模型，不调用 Tavily 或 DeepSeek Search，因此不消耗搜索额度；Tavily 在首次探索时验证。

Radar 的结构化 JSON 生成使用非思考模式，避免思考内容占用输出额度后截断最终 JSON；这不影响 DeepSeek Search 作为 Tavily 故障时的备用搜索能力。

API Key 默认写入 `sessionStorage`。只有用户主动勾选“长期保存在此设备”后才会写入 `localStorage`；取消勾选会立即清除持久化密钥并只保留当前会话副本，“清除配置”会同时清理两个位置。模型名称单独保存，不属于秘密。

Settings 输入的 Radar 密钥会即时保留在当前页面会话中，因此切换应用模块或刷新页面不会要求重复输入；关闭该页面会话后由浏览器清理。已有会话或长期密钥会以密码黑点回填，用户仍可用“显示/隐藏”按钮检查或修改。

密钥只通过同源 POST 请求 Body 发送，不进入 URL、Toward the Sea JSON 导入导出、后端数据库、推荐消息或日志。后端仅为调用 Tavily 与 DeepSeek 在请求生命周期内使用明文 Key。浏览器长期存储不能抵御共享设备访问、同源恶意脚本或 XSS，建议只在个人可信设备启用。

生产环境建议由 Nginx 将站点以及 `/api/radar/`、`/api/life/` 同源反向代理到 FastAPI，并启用 HTTPS。加班 AI 分析复用 `/api/radar/overtime/analyze`，不需要增加独立代理路径。不要把 FastAPI 数据目录、Git 仓库或其他服务器文件配置为公开静态目录。

## 改进方向｜加班必要支出记录与预测（未来版本，尚未实现）

**目标**：从真实加班经历中记录「相对于正常上下班方案，由加班额外触发的必要支出」，逐渐模拟不同加班时长、时段和条件下的成本曲线，辅助判断加班是否值得。此项为未来规划，不属于当前 V2 必须完成的功能。

### 记录真实增量成本

- 每次加班记录开始/结束时间、时长（以 0.5 小时为最小分析单位）、早班/晚班、费用类别、实际金额、正常情况下的基准金额、必要性及触发原因；必要时记录额外通勤/等待时间。
- 费用包括：因地铁尚未运营或末班车结束而打车、因延迟下班必须购买的餐食等。**新增成本 = 加班方案实际支出 − 不加班时对应支出**，避免把原本就要发生的通勤或餐费重复扣除。
- 同时保留原始事实、当时的规则与计算快照；区分实际观测值、手动估算值和模型预测值。可编辑和纠错，不因更新模型而改写历史记录。

### 成本规律与建模

- **固定触发成本**：例如早到导致地铁未运营，一旦选择该加班方案就产生额外打车费；0 小时不触发。
- **阶梯成本**：例如加班超过某个时长后必须点外卖，成本在门槛处跳变。
- **随时长变化的成本**：例如部分额外费用随时间增长，可尝试线性回归或分段线性回归。
- 不要默认「加班时长 → 支出」是一条直线。结合开始/结束时刻、交通运营时段、是否跨用餐时间、加班类型等条件，探索变量交互（耦合）对必要支出的影响；已知确定性规则优先于统计拟合。
- 从简单规则和相似历史记录统计起步；样本量、覆盖范围足够后再尝试离散采样、回归、分段模型及误差验证。相关性不等于因果性，样本不足时不输出虚假的精确预测。

### 预测与可视化

- 在每 0.5 小时的有效节点，模拟「预计额外必要支出」「加班净现金收益」「实际额外净时薪」及其边际变化；显示费用触发点、成本跳跃点、与个人最低接受回报的交点。
- 展示真实历史点与预测曲线的区别，并给出预测依据、适用条件及不确定性；允许用户覆盖预测费用进行情景比较。
- 始终以**不加班（0 小时）**为基准方案。若预测的新增支出和时间成本使所有候选时长均达不到用户设定的接受门槛，应允许得出「不加班更符合当前条件」的结论。

**实施顺序建议**：先稳定必要支出记录与基准差额 → 累积样本并验证触发规则 → 再引入统计拟合与条件预测 → 最后接入加班决策曲线。AI 仅可解释结构化计算结果，不负责金额计算或拟合数据的真实性判断。
