# 拾光笔记

一个自建的个人博客：技术笔记与生活随笔。

不用现成模板，内容以纯 Markdown 文件承载，服务端渲染直出 HTML。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 18+ | 无构建步骤，`node server.js` 即可运行 |
| Web 框架 | Express 4 | 成熟稳定，中间件生态完整 |
| 模板引擎 | EJS | 服务端渲染，SEO 友好，首屏不依赖 JS |
| 内容层 | Markdown + gray-matter | 文章即文件，可版本管理、可迁移 |
| 渲染 | markdown-it + highlight.js | 代码高亮、标题锚点、目录提取 |
| 安全 | helmet + CSP | 严格响应头策略，无内联脚本 |

## 快速开始

```bash
npm install
npm start                        # 启动，默认 http://127.0.0.1:3000
npm run dev                      # 同上，但改代码自动重启

NODE_ENV=production npm start    # 生产模式：隐藏草稿、开启 HSTS、监听 0.0.0.0
```

环境变量（完整模板见 `.env.example`，部署细节见「部署」章节）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口，云平台通常自动注入 |
| `HOST` | 生产 `0.0.0.0` / 开发 `127.0.0.1` | 监听地址。容器必须 `0.0.0.0`，否则外部连不进来 |
| `NODE_ENV` | — | 设为 `production` 时隐藏草稿、开启 HSTS |
| `SITE_URL` | `http://localhost:3000` | RSS / sitemap / canonical / 分享链接的绝对前缀 |
| `TRUST_PROXY` | `false` | **仅在反向代理之后**才设为 `true` |

## 写一篇新文章

在 `content/posts/` 下新建 `.md` 文件即可，**无需重启服务**，刷新页面就能看到。

文件名会成为 URL：`content/posts/my-post.md` → `/post/my-post`。
带日期前缀的文件名会自动剥离，`2026-09-27-my-post.md` → `/post/my-post`。

### Frontmatter 字段

```markdown
---
title: 文章标题                    # 必填，缺省时用文件名
date: 2026-09-27                   # 发布日期
updated: 2026-09-28                # 可选，更新时间
tags: [Node.js, 性能优化]           # 标签，支持数组或逗号分隔字符串
category: 技术笔记                  # 分类，缺省为「未分类」
series: 服务端实战                  # 可选，系列名，会在归档页聚合
summary: 一句话摘要                 # 可选，缺省时自动从正文截取
cover: /images/xxx.jpg             # 可选，列表卡片封面图
pinned: true                       # 可选，置顶
featured: true                     # 可选，进首页「精选」区
draft: true                        # 可选，草稿，生产模式下不显示
slug: custom-url                   # 可选，覆盖从文件名推导的 URL
---

正文从这里开始，正常写 Markdown 即可。
```

支持标题、列表、任务列表、表格、引用、脚注、代码块（自动高亮）、图片、内联 HTML 等。
正文中的 `##` 和 `###` 标题会自动生成右侧目录。

## 后台管理（本地）

不想每次都手动建文件、敲 git 命令，可以开图形化后台。

**双击 `start-admin.bat` 即可**（首次运行会顺手在桌面创建一个带图标的快捷方式，
以后直接双击桌面上的「拾光笔记 写作后台」）。服务就绪后会自动弹出一个
**独立应用窗口**，没有地址栏和标签页 —— 观感与桌面应用一致，靠的是
Chrome / Edge 的 `--app=` 模式，不需要引入 Electron。

关掉那个命令行窗口就是退出后台。

> 手动跑也行：`npm run dev`，然后浏览器打开 `http://127.0.0.1:3000/admin`。
> 但这样开出来的是普通标签页，少了「应用窗口」那层体验。

界面提供：

- **文章列表** —— 所有文章（含草稿，带「草稿」标记），显示日期、分类、标签、字数
- **Markdown 编辑器** —— 左侧写、右侧实时预览。预览走服务端**同一套 markdown-it 配置**渲染，所以所见即所得
- **写作模板** —— 从 `content/templates/` 下拉套用，自动填正文骨架与分类标签。
  想加自己的模板，往那个目录丢一个 `.md` 即可，不用改代码
- **展示开关** —— 草稿 / 置顶 / 精选三个勾选项，分别对应 frontmatter 的 `draft` / `pinned` / `featured`
- **图片上传** —— 拖拽或点击选择，自动存到 `public/images/uploads/` 并插入 Markdown 链接
- **一键发布** —— 自动执行 `git add / commit / push`，GitHub 收到后 Render 自动重新部署

快捷键：`Ctrl/Cmd + S` 保存，`Ctrl/Cmd + Shift + S` 保存并发布。

### 首页展示规则

- **「精選」区** —— 勾了「精選」的文章优先，不足 3 篇时用日期最新的文章补足。
  补位的卡片边框会退后一档，与手动挑过的区分开
- **「最新文章」列表** —— 勾了「置顶」的永远排最前（带「置頂」标记），其余按日期倒序
- 首页「最近更新」取的是**真正的最新日期**，不受置顶影响

### 应用图标

站点图标是 `public/favicon.svg`（朱砂方印 + 「拾」字），前台、后台共用一份。
Windows 快捷方式用的 `assets/app/icon.ico` 由它生成：

```bash
NODE_PATH="<隔离工作区>/node_modules" node tools/make-icons.js
```

该脚本借系统 Chrome 把 SVG 渲染成 16/32/48/64/128/256 六种尺寸再打包成 ICO ——
多尺寸是必要的，只嵌一张的话系统会拉伸去凑其余尺寸，笔画会糊。

### ⚠️ 后台只在本地存在，这是刻意设计

`/admin` 路由**只在 `NODE_ENV !== 'production'` 时挂载**（见 `server.js` 的路由段）。线上部署的站点访问 `/admin` 一律 404，连后台的 CSS/JS 也一样取不到。

**用部署环境做隔离，替代自研一套登录认证** —— 少一整套攻击面（弱口令、会话固定、CSRF…）。因此：

- 不要为了「随时随地能写」而把它改成无条件挂载
- 真需要线上编辑，正确做法是**通过 GitHub API 提交**（内容进仓库，不依赖服务器文件系统），而不是让服务器直接写文件 —— Render 的文件系统是临时的，重启即丢
- 后台静态资源刻意放在 `assets/admin/`（不在 `public/`），由 admin 路由托管，这样生产环境同样访问不到

## 关于页面

编辑 `content/pages/about.md`，同样支持 frontmatter 和完整 Markdown。

## 站点配置

改 `src/config.js` 即可，不需要动其他文件：

- 站名、副标题、描述、作者
- 导航菜单
- 社交链接
- 每页文章数
- 默认主题（`dark` / `light`）与主色调
- 部署域名（影响 RSS 与 sitemap 中的绝对链接）

## 视觉系统

整体取「宣纸墨色」的文人书房意象，不使用圆角卡片 + 渐变的通用现代模板语言。

| 元素 | 做法 |
| --- | --- |
| 底色 | 陈年宣纸的暖黄 `#f0e5c6`（浅色）/ 墨夜暖黑 `#14110d`（深色），叠一层 SVG 噪点模拟纸纤维 |
| 主色 | 朱砂 `#a32e26`，深色模式自动提亮为 `#c05442` |
| 辅色 | 泥金，浅色 `#9c7a38` / 深色 `#b08d4f`，用于标题渐变与装饰 |
| 字体 | 标题与正文用宋体（衬线），元信息与装饰用楷体 |
| 装饰 | 印章（单字小印 / 四字方印）、菱形花饰分隔、中文数字章节号、竖排题签 |
| 正文 | 首字下沉、朱砂菱形列表符、楷体引用块、文末落款钤印 |

> **纸色的关键是拉开 R>G>B 的梯度。** 浅色底 `#f0e5c6` 的 R-G=11、G-B=31，读起来才是「纸黄」；
> 若 R≈G、B 只低十来点（旧值 `#f5f2e8` 就是如此），观感只会是「灰白」。

### 山水长卷底纹

`public/images/art/landscape.svg` 是一幅 1600×900 的连续山水长卷，作为固定背景层。
自下而上依次为：高层云气 → 雁阵 → 卷云钩线 → 远山 → 云带 → 中景山（含皴笔、松林）
→ 水面波纹 → 远帆 → 沙洲 → 近景坡岸（松、江亭）→ 前景坡与水痕。

画稿是**纯黑透明稿**，通过 CSS `mask-image` 取形、`background-color` 上色 ——
同一套稿子在宣纸与墨夜两种模式下自动换墨，不必为深色另画一套，
也不要用 `filter: invert()`（会把朱砂等彩色一起翻转）。

画稿内部用 `<mask>` + `linearGradient` 做横向渐隐（版心处略减）与山体竖向淡出（山脚化入云气），因此整体没有硬边。

> **贴边元素的山脊线必须画到 viewBox 边界再闭合。**
> 若中途收笔就 `v300` 垂直下坠、`H0` 回左边闭合，收笔处会留下一条垂直硬边 ——
> 右边空白、左边有山，看起来就是「画被裁掉一块」。

强度经像素级实测标定（文章页正文列 x190–930）：

| 主题 | 版心峰值差 | 均值差 | 有底纹的正文对比度 |
| --- | --- | --- | --- |
| 宣纸 light | 74 | 29.62 | 8.99:1 |
| 墨夜 dark | 83 | 33.28 | 9.81:1 |

两者均远超 WCAG AA（4.5:1），并达到 AAA（7:1）。

调整浓淡只需改 `public/css/style.css` 顶部：

```css
--ink-landscape-op: 0.16;   /* 浅色主题的底纹浓度；深色为 0.155 */
--ink-art: #2f2a22;         /* 画稿上色；深色主题为 #e8e0cf */
```

移动端（≤720px）底纹层高度降为 `max(100vh, 560px)`。

### 关于繁体

站名、导航、章节号、页脚等**界面文字用繁体**以贴合古风，文章正文仍为简体。若想统一为简体，改 `src/config.js` 里的 `title` / `subtitle` / `nav`，以及各模板中的界面文案即可，正文无需改动。

## 路由一览

| 路径 | 说明 |
| --- | --- |
| `/` | 首页，精选 + 文章列表（分页 `?page=2`） |
| `/post/:slug` | 文章详情，含目录、上下篇、相关文章 |
| `/tags` | 全部标签 |
| `/tag/:name` | 单个标签下的文章 |
| `/categories` | 全部分类 |
| `/category/:name` | 单个分类下的文章 |
| `/archive` | 归档，按年份时间线 + 系列聚合 |
| `/search?q=` | 站内搜索，匹配标题/标签/摘要/正文 |
| `/about` | 关于页 |
| `/rss.xml` | RSS 订阅 |
| `/sitemap.xml` | 站点地图 |

### JSON API

页面路由与 API 共用同一内容层，方便未来做前后端分离或小程序端：

```
GET /api/site                 站点信息与统计
GET /api/posts?page=1         文章列表（分页）
GET /api/posts/:slug          文章详情（含 HTML 与目录）
GET /api/tags                 标签及归属文章
GET /api/categories           分类及归属文章
GET /api/archive              按年份归档
GET /api/search?q=关键词       搜索
GET /api/stats                站点统计
```

## 目录结构

```
├── server.js                应用入口：安全头、静态资源、路由挂载、错误兜底
├── src/
│   ├── config.js            站点配置（唯一事实来源）
│   ├── lib/
│   │   ├── content.js       内容仓库：扫描、解析、索引、缓存、查询
│   │   ├── markdown.js      Markdown 渲染：高亮、锚点、目录提取
│   │   ├── open-app.js      以应用窗口打开后台 / 交给系统浏览器打开链接
│   │   └── utils.js         日期、摘要、字数、分页等工具
│   └── routes/
│       ├── pages.js         页面路由
│       ├── api.js           JSON API
│       └── admin.js         后台管理（仅非生产环境挂载）
├── views/                   EJS 模板
│   ├── partials/            head / header / footer / 卡片 / 分页
│   ├── admin/               后台界面模板（partials/icon.ejs 为图标集）
│   └── *.ejs                各页面模板
├── content/
│   ├── posts/               文章（Markdown）
│   ├── pages/               独立页面（如 about.md）
│   └── templates/           写作模板（不参与文章索引）
├── public/
│   ├── css/                 样式系统与代码高亮主题
│   ├── js/                  主题初始化与交互脚本
│   ├── favicon.svg          站点图标（前台与后台共用）
│   └── images/
│       ├── art/             山水长卷底纹稿（landscape.svg，纯黑透明稿 + CSS mask 上色）
│       ├── uploads/         后台上传的图片（运行时生成）
│       └── *.svg            文章插图
├── assets/
│   ├── admin/               后台的 CSS/JS（刻意放在 public 之外，生产环境不可达）
│   └── app/icon.ico         Windows 快捷方式图标（由 tools/make-icons.js 生成）
├── tools/
│   ├── security-check.js    安全自检脚本（敏感文件 / 穿越 / XSS / 限流 / 响应头）
│   ├── make-icons.js        从 favicon.svg 生成多尺寸 .ico
│   └── launch.js            双击启动的入口（建桌面图标 + 起服务）
└── start-admin.bat          双击启动本地后台（并弹出应用窗口）
```

## 扩展方向

架构上为这些事情留好了口子：

- **加评论**：`content.js` 已集中管理内容读写，新增 `comments` 数据层即可，路由与模板不用改
- **后台编辑**：`content.invalidate()` 可在写入后主动清缓存
- **换存储**：只要保持 `src/lib/content.js` 的导出接口不变，内部换成 SQLite 或远程 CMS 都行
- **加全文检索**：内容层已提供 `search()`，替换为 SQLite FTS5 即可（参见站内文章《用 SQLite 做站内搜索》）

## 部署

### 先分清两件事：GitHub Pages 跑不了这个站

本站是 **Express 服务端渲染应用**，不是静态站点：

- 页面 HTML 由 EJS 模板在服务端实时渲染，不是预先写好的文件
- Markdown 由 `markdown-it` 在服务端解析
- 站内搜索在服务端遍历全部文章正文
- CSP nonce、限流、安全响应头全在服务端中间件里
- `package.json` 只有 `start` / `dev`，**没有 `build`** —— 本来就没有静态产物可发布

GitHub Pages 只能托管静态文件、无法运行 Node 进程。把仓库推上去，网站也不会亮。
**结论：GitHub 用来存代码，网站另找支持 Node 的平台。**

（若确实想用 GitHub Pages，需要把内容层改成构建时预渲染（SSG），代价是失去站内搜索、
限流等纯服务端能力。属于另一套架构，本仓库未采用。）

### 推到 GitHub

```bash
git init -b main
git add .
git commit -m "chore: 初始化项目"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules/`、`.env`、`.env.*`（保留 `.env.example`），
不会把依赖和密钥推上去。

### 推荐路径：GitHub 存代码 + Render 上线

仓库根目录带了 `render.yaml` 蓝图，一键即可部署：

1. 打开 Render 控制台 → **New > Blueprint** → 选中本仓库
2. Render 自动读取 `render.yaml`，构建与启动命令无需手填
3. 部署完成后到 **Environment** 面板把 `SITE_URL` 填成真实域名
4. 此后每次 push 到 `main` 都会自动重新部署

免费档已含自动签发的 HTTPS 证书，不用自己买服务器。其他同类平台（Railway / Fly.io /
Zeabur 等）配置方式类似，认准「Node 运行时 + 设置 `NODE_ENV=production`」即可。

### 自建服务器

```bash
NODE_ENV=production npm start
```

生产模式下会自动隐藏草稿、开启 HSTS、监听 `0.0.0.0`。另建议：

- 用 Nginx 或 Caddy 做反向代理并终结 HTTPS，**此时才**设 `TRUST_PROXY=true`
- 用 pm2 / systemd 做进程守护
- 把 `content/` 目录纳入 Git，文章即版本历史

### 部署前检查清单

- [ ] `SITE_URL` 指向真实域名 —— 否则 RSS、sitemap、canonical 里全是 `localhost`
- [ ] `NODE_ENV=production` —— 否则 `draft: true` 的文章会被公开访问
- [ ] `TRUST_PROXY` 只在反代之后才开 —— 无条件开启会让限流被伪造 IP 绕过
- [ ] 上线后复验一次安全基线：`node tools/security-check.js https://你的域名`

## 安全说明

### 已实施的加固

| 项 | 做法 |
|---|---|
| 安全响应头 | `helmet` 统一下发 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、CORP/COOP，并移除 `X-Powered-By` |
| **CSP 无 `unsafe-inline`** | 脚本全走外部文件；唯一的样式内联点（主题色注入）改用**每请求随机 nonce** 放行，内联 `style` 属性已全部提为 CSS 类 |
| 限流 | 全站 300 次/分；`/search`、`/api/search` 单独收紧到 30 次/分（搜索要遍历全部正文，是站内最贵的操作），超限返回 429 + `Retry-After` |
| 路径穿越 | `express.static` 限定 `public/`；`readPage()` 用白名单正则 + 解析后路径二次校验，双重拦截 |
| XSS | EJS 模板全量转义；`json escape` 把 JSON 响应里的 `<` 转成 `\u003c`；外链自动加 `rel="noopener noreferrer nofollow"` |
| 参数收敛 | `perPage` 收敛到 `[1, 50]`，搜索关键词截断到 64 字符，杜绝超大值一次性拉走全部数据 |
| 信息泄露 | 500 只回笼统文案，堆栈仅进服务端日志；`dotfiles: 'ignore'` 屏蔽点文件 |
| 连接层 | 缩短 `headersTimeout` / `requestTimeout`，限制 `maxHeadersCount`，压制 Slowloris 类慢速攻击 |
| HSTS | **仅生产环境下发**。本地 http 若收到 HSTS，浏览器会把 localhost 记成强制 HTTPS 主机，导致后续访问直接失败 |
| 缓存 | 动态页面 `no-cache`，保证改完 Markdown 刷新即见 |

### 关于 `TRUST_PROXY`

默认关闭。只有确实部署在 Nginx / Caddy 之后才通过环境变量打开：

```bash
NODE_ENV=production TRUST_PROXY=true npm start
```

**不要无条件开启** —— 那会让任何人都能用 `X-Forwarded-For` 头伪造来源 IP，从而绕过按 IP 的限流。

### 自检

仓库自带一份安全自检脚本，覆盖敏感文件暴露、路径穿越、反射型 XSS、超长参数、异常分页、响应头基线、HTTP 方法、错误信息泄露、Host 头注入、CSP nonce 一致性与限流生效性：

```bash
node tools/security-check.js              # 默认 http://127.0.0.1:3000
node tools/security-check.js http://example.com
```

脚本用原生 `http` 模块手工拼请求路径 —— 这一点很关键：`fetch` / `axios` 会把 `..%2f..%2f` 这类编码规范化掉，穿越测试根本打不到服务端。

### 已知边界

- Markdown 渲染开启了 `html: true`（允许正文内嵌少量 HTML）。当前内容全部由站长本人撰写，风险可控；**若将来引入评论、多人协作或外部导入内容，必须加上 HTML 白名单净化（如 `sanitize-html`）**，否则会变成存储型 XSS 的入口。
- 无用户输入写入路径、无数据库，攻击面本身很小。

## License

MIT
