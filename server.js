'use strict';

/**
 * 应用入口。
 *
 * 中间件顺序：nonce → 安全响应头 → 压缩 → 静态资源 → 请求体解析
 *            → 全局模板变量 → 限流 → 业务路由 → 404 → 错误兜底。
 *
 * 顺序上有四处是刻意安排的，改动时务必留意：
 * 1. nonce 必须早于 helmet —— CSP 头的构造要用到 res.locals.nonce。
 * 2. 静态资源必须早于限流 —— 否则一个页面几十个静态资源会瞬间吃掉配额。
 * 3. 限流必须晚于全局模板变量 —— 触发限流时要渲染 429 页面，模板依赖 res.locals。
 * 4. 限流必须早于路由 —— 越早拒绝越省资源。
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const content = require('./src/lib/content');
const { openAsApp } = require('./src/lib/open-app');
const pagesRouter = require('./src/routes/pages');
const apiRouter = require('./src/routes/api');
const adminRouter = require('./src/routes/admin');

const app = express();
const ROOT = __dirname;
const { security } = config;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// 让 JSON 响应里的 < > & 转成 \u003c 等，即使被当作 HTML 解析也注入不出标签
app.set('json escape', true);
// trust proxy 由 config 显式控制：只有真在反代后面才开，
// 否则攻击者能用 X-Forwarded-For 伪造来源 IP 绕过限流
app.set('trust proxy', config.server.trustProxy);

/* --------------------- 每请求 nonce（用于 CSP 放行内联样式） --------------------- */
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

/* ------------------------------ 安全响应头 ------------------------------ */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // 站内脚本全部走外部文件，一个内联脚本都没有，因此不需要 unsafe-inline
        'script-src': ["'self'"],
        // 唯一的样式内联点（主题色注入）走 nonce；内联 style 属性已全部提为 CSS 类
        'style-src': ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
        'img-src': ["'self'", 'data:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        // 本地 http 开发必须显式关掉，否则浏览器会把资源请求升级到 https 而全部失败
        'upgrade-insecure-requests': null,
      },
    },
    // HSTS 只在生产下发：本地 http 若收到 HSTS，浏览器会把 localhost 记成强制 HTTPS 主机
    strictTransportSecurity: security.hsts
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

app.use(compression());

/* ------------------------------ 静态资源 ------------------------------ */
// 只暴露 public/ 目录；express.static 自身会规范化路径，拒绝越界与点文件
app.use(
  express.static(path.join(ROOT, 'public'), {
    maxAge: isProd ? '7d' : 0,
    etag: true,
    index: false,
    dotfiles: 'ignore',
  })
);

/* ---------------------------- 请求体解析 ---------------------------- */
/*
 * 后台要提交整篇正文，必须**先于**全局解析器挂载。
 * express.json 见到已解析的 body 会跳过，但**先执行的那个**会先抛
 * PayloadTooLargeError —— 若让 64kb 的全局解析器先跑，长文章就存不进去。
 */
if (!isProd) {
  app.use('/admin', express.json({ limit: '2mb' }));
}

// 其余接口目前没有写入路径，属预防性配置：限定体积，避免将来加接口时被大包打爆
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

/* ---------------------------- 全局模板变量 ---------------------------- */
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

app.use((req, res, next) => {
  res.locals.site = config.site;
  res.locals.nav = config.nav;
  res.locals.social = config.social;
  res.locals.theme = config.theme;
  res.locals.currentPath = req.path;
  res.locals.stats = content.getStats();
  res.locals.currentYear = new Date().getFullYear();
  res.locals.activePath = '';
  res.locals.title = null;
  res.locals.description = null;
  res.locals.bodyClass = '';
  // 动态页面不缓存：内容靠文件指纹热更新，缓存住会让改动看不到
  if (!req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-cache');
  }
  next();
});

/* -------------------------------- 限流 -------------------------------- */
/*
 * 必须排在「全局模板变量」之后：触发限流时要渲染 429 页面，
 * 而模板依赖 res.locals.site 等变量。早于它挂载会导致 404.ejs 抛 ReferenceError。
 */
const onRateLimited = (req, res, next, options) => {
  res.status(429);
  res.set('Retry-After', String(Math.ceil((options.windowMs || 60000) / 1000)));
  // 挂在 ['/search','/api/search'] 这类数组路径上时，Express 会把命中的前缀
  // 从 req.path 里剥掉，因此这里必须用 originalUrl 判断是否为 API 请求
  if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/admin/api/')) {
    return res.json({ ok: false, error: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' });
  }
  return res.render('404', {
    title: '請求過於頻繁',
    description: '訪問頻率超出限制，請稍後再試',
    suggestions: [],
    activePath: '',
  });
};

const limiterOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: onRateLimited,
};

// 全站宽松限流：只作用于动态路由（静态资源在上面已被处理，不会走到这里）
app.use(
  rateLimit({
    ...limiterOptions,
    windowMs: security.global.windowMs,
    limit: security.global.limit,
  })
);

// 搜索单独收紧：每次搜索都要遍历全部文章正文，是站内最昂贵的操作
app.use(
  ['/search', '/api/search'],
  rateLimit({
    ...limiterOptions,
    windowMs: security.search.windowMs,
    limit: security.search.limit,
  })
);

/* -------------------------------- 路由 -------------------------------- */

/*
 * 后台管理：⚠️ 只在非生产环境挂载。
 *
 * 线上站点因此根本不存在 /admin 入口 —— 用部署环境做隔离，比在页面上
 * 挂个密码框更安全，也少一整类攻击面（弱口令、会话固定、CSRF…）。
 * 改动这段判断前请务必想清楚后果。
 */
if (!isProd) {
  // 请求体解析器已在上方「请求体解析」段提前挂载 —— 必须早于全局的 64kb 上限
  app.use('/admin', adminRouter);
}

app.use('/api', apiRouter);
app.use('/', pagesRouter);

/* ------------------------------- 404 兜底 ------------------------------ */
app.use((req, res) => {
  res.status(404);
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.json({ ok: false, error: 'NOT_FOUND', message: '接口不存在' });
  }
  return res.render('404', {
    title: '页面走丢了',
    description: '未找到该页面',
    suggestions: content.getAllPosts().slice(0, 4),
    activePath: '',
  });
});

/* ------------------------------ 错误兜底 ------------------------------ */
// 只向客户端返回笼统文案，堆栈仅落在服务端日志里，避免泄露路径与依赖版本
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500);

  /*
   * API 请求一律回 JSON，绝不渲染模板。
   *
   * 路径判断必须带上 `/admin/api` —— 后台的 API 不以 `/api/` 开头。
   * 更要紧的是：若落到下面的 res.render，在「请求体解析阶段」就出错的场景
   * （例如 body 超过上限）会因为 res.locals.site 尚未初始化而二次抛错，
   * 用户只会看到一个空白错误页，连报错原因都拿不到。
   */
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    const tooLarge = err.type === 'entity.too.large';
    return res.json({
      ok: false,
      error: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'SERVER_ERROR',
      message: tooLarge ? '内容太大了，单次提交上限 2 MB' : '服务异常',
    });
  }

  return res.render('404', {
    title: '服务异常',
    description: '服务器内部错误',
    suggestions: [],
    activePath: '',
  });
});

/* -------------------------------- 启动 -------------------------------- */
const { port, host } = config.server;
const server = app.listen(port, host, () => {
  const stats = content.getStats();
  console.log(`\n  ${config.site.title} · ${config.site.subtitle}`);
  console.log(`  已加载 ${stats.postCount} 篇文章 / ${stats.tagCount} 个标签 / ${stats.categoryCount} 个分类`);
  console.log(`  本地访问： http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`  限流：全站 ${security.global.limit} 次/分，搜索 ${security.search.limit} 次/分`);
  console.log(`  HSTS：${security.hsts ? '已开启' : '已关闭（本地开发）'}`);
  console.log(`  trust proxy：${config.server.trustProxy ? '开启' : '关闭'}\n`);

  /*
   * 生产环境没配 SITE_URL 是个静默故障：RSS / sitemap / robots.txt 里的
   * 链接会全变成 http://localhost:3000，页面本身看起来却完全正常，
   * 不主动检查根本发现不了。这里在启动时就把它喊出来。
   */
  if (isProd && !process.env.SITE_URL) {
    console.warn(
      '  ⚠️  未设置 SITE_URL —— RSS / sitemap / robots.txt 里的链接会是 localhost:3000。\n' +
      '     在托管平台的「环境变量」里加一条 SITE_URL=https://你的域名 即可。\n'
    );
  }

  /*
   * ADMIN_APP=1 由 start-admin.bat 设置，表示「这是双击图标启动的后台」。
   *
   * 开窗口这件事必须放在这里 —— 服务真正 listen 成功之后。
   * 不能在 bat 里写成「启动服务 → 等两秒 → 打开浏览器」：首次启动要加载
   * 依赖、构建内容索引，两秒往往不够，用户会先撞上一张「无法访问」的白页。
   */
  if (process.env.ADMIN_APP === '1') {
    const url = `http://127.0.0.1:${port}/admin`;
    const { mode } = openAsApp(url);
    console.log(
      mode === 'app'
        ? `  ✓ 已用应用窗口打开后台： ${url}\n`
        : `  ✓ 已用默认浏览器打开后台： ${url}\n` +
          '     （想让它以独立窗口打开、更像桌面应用？装一个 Chrome 或 Edge 即可）\n'
    );
  }
});

/* 端口被占用是双击启动时最常见的失败，单独给一句人话，别甩一堆堆栈 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${port} 已被占用，后台可能已经在运行了。`);
    console.error('    先找找有没有已经打开的后台窗口，或者关掉那个还留着的');
    console.error('    「拾光笔记 · 本地后台」命令行窗口，再双击图标重试。\n');
    process.exit(1);
  }
  throw err;
});

// 连接层加固：缩短头部/请求超时，压制 Slowloris 这类慢速耗尽攻击
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 65000;
server.maxHeadersCount = 100;

// 优雅退出，避免端口占用残留
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

module.exports = app;
