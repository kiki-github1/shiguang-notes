---
title: Express 上线的安全检查清单
date: 2026-06-20
tags: [Express, 安全, Node.js, 后端]
category: 技术笔记
series: 服务端实战
summary: 每次上线前对着过一遍的清单。包含响应头、输入校验、会话、限流、依赖审计几个方面，附可直接用的 helmet 配置。
---

这份清单是我自己的上线前检查项，攒了两年多。每一条都对应过真实出问题（或者差点出问题）的场景。

## 一、关掉会泄露信息的响应头

Express 默认会带上 `X-Powered-By: Express`，等于告诉扫描器「这里跑的是 Node + Express，去查这个框架的已知漏洞吧」。

```js
app.disable('x-powered-by');
```

顺手再关掉 Express 的路由栈泄露（开发模式下 404 会返回调用栈）：

```js
process.env.NODE_ENV = 'production';  // 必须在 require('express') 之前设置
```

> 注意顺序：`NODE_ENV` 必须在引入 Express **之前**设置，否则内部的 `view cache` 等优化不会生效。

## 二、安全响应头

用 `helmet` 一把梭，但要按自己的实际情况调整 CSP，别直接用默认值然后发现样式全挂了。

```js
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],                    // 不给内联脚本留口子
      'style-src': ["'self'", "'unsafe-inline'"],  // 有内联主题变量，不得不放开
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"],               // 防点击劫持
    },
  },
  crossOriginEmbedderPolicy: false,                // 用外部图床时必须关，否则图片加载不出来
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

几个容易踩的坑：

- `upgrade-insecure-requests` 在**本地 http 开发**时会导致资源全部加载失败，本地环境要显式设成 `null` 关掉
- 一旦用了 CDN 上的字体或图标，`font-src` 和 `img-src` 必须加上对应域名
- CSP 配错的表现通常是「页面能打开但样式全无」，第一时间看浏览器控制台的 CSP 报错

## 三、输入永远不可信

Express 的 `req.query`、`req.body`、`req.params` 全是外部输入。

**路径参数必须校验**，尤其是会拼进文件路径或数据库查询的：

```js
const path = require('node:path');

app.get('/files/:name', (req, res) => {
  const safe = path.basename(req.params.name);      // 剥掉 ../ 等目录穿越
  const full = path.join(UPLOAD_DIR, safe);

  // 双保险：确认最终路径仍在允许的目录内
  if (!full.startsWith(UPLOAD_DIR + path.sep)) {
    return res.status(400).json({ error: '非法路径' });
  }
  res.sendFile(full);
});
```

**查询参数要限长、限类型**，避免有人用超长字符串打你的数据库：

```js
function sanitizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 100);
}
```

**永远不要拼接 SQL**。参数化查询不是可选项：

```js
// ❌ 注入
db.query(`SELECT * FROM users WHERE name = '${name}'`);

// ✅ 参数化
db.query('SELECT * FROM users WHERE name = ?', [name]);
```

## 四、会话与 Cookie

```js
app.use(session({
  name: 'sid',                        // 别用默认的 connect.sid
  secret: process.env.SESSION_SECRET, // 必须来自环境变量，不能硬编码
  resave: false,
  saveUninitialized: false,           // 未登录用户不建会话，省存储也少一个攻击面
  cookie: {
    httpOnly: true,                   // JS 读不到，防 XSS 窃取
    secure: true,                     // 仅 HTTPS
    sameSite: 'lax',                  // 防 CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
```

`sameSite: 'lax'` 是现在的主流选择：跨站 POST 不带 Cookie（挡掉 CSRF），但从外站点链接过来时仍然带着（不破坏体验）。

如果站点有修改类操作，再叠一层 CSRF token 更稳妥。

## 五、限流

任何**能被匿名调用**的接口都要限流，尤其是：登录、注册、发验证码、搜索、导出。

```js
const rateLimit = require('express-rate-limit');

// 全局宽松限制
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// 登录接口严格限制
app.use('/api/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '尝试过于频繁，请稍后再试' },
}));
```

**部署在反向代理后面时，一定要设 `app.set('trust proxy', 1)`**，否则所有请求的 IP 都是代理的地址，限流会把所有人一起限掉。

## 六、错误处理不要泄露内部信息

```js
app.use((err, req, res, next) => {
  req.log.error(err);                                  // 完整信息进日志

  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ error: '服务器内部错误' });   // 对外只给一句话
  } else {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
```

数据库报错的原文里经常带着**表名、字段名、甚至数据片段**，别直接返回给前端。

## 七、依赖审计

```bash
npm audit --production
npm outdated
```

`npm audit` 的输出噪音不少，我的处理原则：

- **高危 + 在运行时依赖链上** → 立即升级
- **中危 + 仅构建期依赖** → 排期处理
- **低危 / 无补丁** → 记录，评估是否真的可达

比漏洞更值得警惕的是**无人维护的依赖**：最后更新时间超过两年、issue 无人回复、下载量还在跌。这种包迟早会成为负担。

## 八、上线前跑一遍

```bash
# 1. 依赖漏洞
npm audit --production

# 2. 响应头检查
curl -sI https://example.com | grep -iE 'x-powered-by|content-security|strict-transport'

# 3. HTTPS 强制跳转是否生效
curl -sI http://example.com | head -3

# 4. 敏感路径是否暴露
for p in /.env /.git/config /package.json /node_modules; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://example.com$p"
done
```

最后一条特别容易出问题。用 `express.static` 指向项目根目录，就会把 `.env`、`package.json` 一起暴露出去。

**静态目录一定要指向专门的 `public/` 目录，不要指向项目根目录。**

## 附：完整清单

- [ ] 关闭 `x-powered-by`
- [ ] `NODE_ENV=production` 且在引入框架前设置
- [ ] helmet 配置完成，CSP 无控制台报错
- [ ] 所有路径参数经 `path.basename` + 前缀校验
- [ ] 所有 SQL 使用参数化查询
- [ ] 查询参数限长
- [ ] 会话密钥来自环境变量，Cookie 设 `httpOnly` / `secure` / `sameSite`
- [ ] 匿名可调用接口全部限流
- [ ] `trust proxy` 已按部署拓扑设置
- [ ] 生产环境错误响应不含堆栈
- [ ] `express.static` 未指向项目根目录
- [ ] `.env`、`.git` 等敏感路径返回 404
- [ ] 已跑 `npm audit --production`

> 这份清单不能保证安全，它只保证**不犯低级错误**。真正的安全需要针对具体业务的威胁建模，那是另一个话题了。
