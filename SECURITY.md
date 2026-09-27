# 安全测试与加固报告

> 测试日期：2026-09-27 · 站点：拾光筆記（Express + EJS 服务端渲染）
> 自检脚本：`tools/security-check.js`

---

## 一、结论

| 环境 | 结果 |
|---|---|
| 开发模式（`NODE_ENV=development`） | **93 通过 / 0 警告 / 0 失败** |
| 生产模式（`NODE_ENV=production`） | **93 通过 / 0 警告 / 0 失败** |
| 浏览器端（10 个页面，Playwright + 系统 Chrome） | **0 CSP 违规 / 0 控制台错误 / 0 横向溢出** |
| CSP 反向对照（主动注入内联样式与脚本） | **3/3 全部被拦截** |

过程中发现并修复了 **3 个真实缺陷**（见第四节），其中 1 个是会导致安全功能静默失效的中间件顺序错误。

---

## 二、测试方法

自检脚本用**原生 `http` 模块手工拼请求路径**下发请求。

这一点是整个测试有效性的前提：`fetch` / `axios` / `curl` 都会规范化 URL，把 `..%2f..%2f` 解码还原成 `../../`，**路径穿越测试根本打不到服务端**，会得到一片"全部 404，很安全"的假象。

```bash
node tools/security-check.js                              # 默认 http://127.0.0.1:3000
node tools/security-check.js http://127.0.0.1:3100        # 指定地址
EXPECT_HSTS=1 node tools/security-check.js http://127.0.0.1:3100   # 声明生产环境预期
```

覆盖 13 个检查组：

| # | 检查组 | 项数 | 内容 |
|---|---|---|---|
| 1 | 敏感文件暴露 | 13 | `.env` / `.git/config` / `package.json` / `server.js` / `src/*` / `node_modules/*` |
| 2 | 路径穿越 · 静态资源 | 12 | `..%2f` `%2e%2e%2f` `..%5c` `....//` `/%2e%2e/%2e%2e/` 等编码变体 |
| 3 | 路径穿越 · 业务路由 | 7 | `/post/..%2f..%2fserver`、`/tag/..%2f..%2f.env` 等 |
| 4 | 反射型 XSS | 14 | 7 种 payload × 页面/API 两个端点 |
| 5 | 超长参数与异常分页 | 9 | 100KB query、60KB path、`perPage=-1/0/1e9/abc`、`page=-5/1e9/NaN` |
| 6 | 安全响应头 | 11 | CSP、`X-Content-Type-Options`、HSTS 条件化、`X-Powered-By`、`Server` |
| 7 | HTTP 方法 | 10 | `POST/PUT/DELETE/PATCH/TRACE/OPTIONS/HEAD` |
| 8 | 错误信息泄露 | 5 | 响应体不得含堆栈、`node:internal`、绝对路径 |
| 9 | Host 头注入 | 2 | `Host: evil.example.com` 是否被反射进 canonical / `og:url` |
| 10 | 缓存策略 | 2 | 静态资源 `max-age`、动态页面 `no-cache` |
| 11 | CSP nonce 与内联样式 | 3 | nonce 一致性、逐请求随机性、内联 style 属性残留 |
| 12 | 其它加固项 | 3 | `json escape`、API content-type |
| 13 | 限流生效性 | 2 | 连打至 429、`Retry-After`、限流响应头 |

> 第 13 组刻意放在最后 —— 它会耗尽限流配额，放在前面会把后续用例全打成 429。

---

## 三、加固清单

| 项 | 加固前 | 加固后 |
|---|---|---|
| **CSP** | `style-src` 含 `'unsafe-inline'` | `script-src 'self'`；`style-src 'self' + 每请求随机 nonce`；**完全无 `unsafe-inline`** |
| **内联样式** | 5 处内联 `style="..."` 属性 | 全部提为 CSS 类；封面从内联 `background-image` 改为 `<img>`（顺带获得懒加载） |
| **限流** | 无 | 全站 300 次/分；`/search` + `/api/search` 单独 30 次/分；429 + `Retry-After` |
| **HSTS** | 无条件下发 | **仅生产环境**下发（本地 http 若收到 HSTS，浏览器会把 localhost 记成强制 HTTPS 主机） |
| **trust proxy** | 硬编码 `true` | 改为环境变量 `TRUST_PROXY`，默认关闭（无条件开启会让 `X-Forwarded-For` 伪造 IP 绕过限流） |
| **路径穿越** | `path.join(PAGES_DIR, name + '.md')` 直拼 | 白名单正则 + 解析后路径二次校验 |
| **参数收敛** | `perPage` 无限制 | 收敛到 `[1, 50]`；搜索关键词截断到 64 字符 |
| **搜索性能** | 每次搜索对全部正文重复 `toLowerCase` | 小写副本懒计算，挂为不可枚举属性 |
| **JSON 输出** | 原样输出 | `app.set('json escape', true)`，`<` 转 `\u003c` |
| **连接层** | Node 默认超时 | `headersTimeout=20s`、`requestTimeout=30s`、`maxHeadersCount=100` |
| **静态资源** | — | `dotfiles: 'ignore'`、`index: false` |
| **请求体** | 未限制 | `json` / `urlencoded` 均限 64kb |
| **缓存** | 动态页面无 Cache-Control | `no-cache`，保证改完 Markdown 刷新即见 |

另外，`helmet` 自动补上了 `script-src-attr 'none'`（禁止内联事件处理器），是个额外收获。

---

## 四、发现并修复的缺陷

### 1. 限流触发时返回 500 而非 429（中间件顺序错误）

**症状**：连续请求 `/api/search`，响应头显示 `RateLimit: limit=30, remaining=0`（配额已耗尽），但状态码始终是 **500**，从不返回 429。粗看会误判为"限流没生效"。

**根因**：限流中间件挂在「全局模板变量」中间件**之前**。触发限流时 handler 调用 `res.render('404')`，而此时 `res.locals.site` 尚未赋值，EJS 抛 `ReferenceError` → 落到错误兜底 → 500。

**次生问题**：限流挂在 `['/search', '/api/search']` 这种数组路径上时，Express 会把命中的前缀从 `req.path` 里剥掉，导致 handler 里 `req.path.startsWith('/api/')` 永远为 false。

**修复**：
- 限流移至「全局模板变量」**之后**、路由**之前**
- handler 改用 `req.originalUrl` 判断是否 API 请求
- 补充 `Retry-After` 响应头

### 2. `readPage()` 路径穿越隐患（当前不可达）

**症状**：`readPage(name)` 直接 `path.join(PAGES_DIR, \`${name}.md\`)`，未做任何校验。传入 `../../server` 即可读到项目根下的任意 `.md` 文件。

**风险评级**：当前**不可利用** —— 该函数只被 `/about` 路由以硬编码常量 `'about'` 调用，用户输入不可达。但这是颗定时炸弹：一旦将来加 `/page/:name` 这类路由，立即成为真实漏洞。

**修复**：白名单正则 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` + 解析后路径二次校验（要求仍在 `PAGES_DIR` 内）。

### 3. `perPage=-1` 静默吞掉最后一条记录

**症状**：`/api/posts?perPage=-1` 返回 9 条（共 10 篇）。原因是 `slice(start, start + perPage)` → `slice(0, -1)`，JS 语义是"截到倒数第二个"，不报错，只是少一条。

**修复**：`perPage` 收敛到 `[1, 50]`，非数字/0/负数/超大值统一归位。

---

## 五、浏览器端验证

自检脚本只看 HTTP 层，看不到「CSP 收紧有没有把页面搞坏」，也**无法证明 CSP 真的在拦截**（配置写了 ≠ 生效）。因此另跑一轮 Playwright 验证。

### 正向：10 个页面视觉与交互

| 页面 | 主题 | 控制台消息 | CSP 违规 | 横向溢出 |
|---|---|---|---|---|
| 首页 / 文章 / 标签 / 标签详情 / 归档 / 分类 / 关于 / 搜索 | light | 0 | 0 | 无 |
| 首页 / 关于 | dark | 0 | 0 | 无 |

- 主题切换正常：light `--accent=#a32e26` / dark `--accent=#c05442`
- 提类改造生效：`.page-head.is-centered` → `text-align: center`；`.page-desc.is-centered` → `margin-left: 185.5px`；`.section.is-spaced` → `margin-top: 56px`
- 封面 CSS 规则命中：`object-fit: cover` + `overflow: hidden`

### 反向对照：证明 CSP 真的在拦

主动注入三类内联内容，全部应被拦截：

| 注入内容 | 预期 | 实测 |
|---|---|---|
| 无 nonce 的内联 `<style>` | 被拦 | ✓ 变量值为空，未生效 |
| 内联 `style="..."` 属性 | 被拦 | ✓ 变量值为空，未生效 |
| 内联 `<script>` | 被拦 | ✓ 未执行 |

### 生产模式差异确认

| 项 | 开发 | 生产 |
|---|---|---|
| HSTS | 未下发 ✓ | `max-age=31536000; includeSubDomains` ✓ |
| 草稿文章 | 10 篇 | 9 篇（已过滤）✓ |
| 静态资源缓存 | `max-age=0` | `max-age=604800`（7 天）✓ |

---

## 六、已知边界与后续建议

### 需要留意的配置

**Markdown 渲染开启了 `html: true`**，允许正文内嵌少量 HTML。当前内容全部由站长本人撰写，风险可控。

但**一旦引入评论、多人协作或外部内容导入，它就是存储型 XSS 的入口**。届时必须补上 HTML 白名单净化（如 `sanitize-html`）。

### 部署注意

```bash
NODE_ENV=production TRUST_PROXY=true SITE_URL=https://example.com npm start
```

- `TRUST_PROXY` **只在确实位于 Nginx / Caddy / 云平台负载均衡之后时才设为 true**
- `SITE_URL` 设为真实域名，影响 RSS、sitemap、canonical 与社交分享的绝对链接。
  支持环境变量覆盖后无需改代码；取值会做校验，非 `http(s)://` 开头的一律回退到默认值，
  结尾多余的斜杠会自动去掉（避免拼出双斜杠链接）
- `NODE_ENV=production` 同时会隐藏 `draft: true` 的文章并开启 HSTS

### 本次未覆盖的范围

以下不在本次测试范围内，若后续引入需要单独评估：

- 认证与授权（当前站点无登录态）
- 文件上传（当前无上传接口）
- 依赖漏洞扫描（建议接入 `npm audit` 或 Dependabot 做持续监控）
- 生产环境 HTTPS 配置与证书（属部署层，由反向代理负责）
