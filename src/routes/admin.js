'use strict';

/**
 * 后台管理路由。
 *
 * ⚠️ 本路由**只在非生产环境挂载**（见 server.js 的挂载判断）。
 * 线上站点根本不存在 /admin 入口，因此这里不需要自研一套登录认证 ——
 * 用部署环境做隔离，比在页面上加个密码框更安全，也少一堆攻击面。
 *
 * 因此：任何情况下都不要把本路由无条件挂到主应用上。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const multer = require('multer');

const config = require('../config');
const content = require('../lib/content');
const { render } = require('../lib/markdown');
const { openInBrowser } = require('../lib/open-app');

const router = express.Router();
const ROOT = path.resolve(__dirname, '..', '..');
const UPLOAD_DIR = path.join(ROOT, 'public', 'images', 'uploads');
const UPLOAD_URL_PREFIX = '/images/uploads';

/** 本地时区的今天（YYYY-MM-DD）。toISOString 走的是 UTC，跨时区会差一天 */
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ------------------------------ 后台静态资源 ------------------------------ */
/*
 * 刻意**不**放进 public/：那样 express.static 在生产环境照样会把文件发出去，
 * 等于对外宣告「这里有个后台」。放在项目根的 assets/ 下由本路由托管，
 * 生产环境本路由不挂载，资源自然也访问不到。
 */
router.use(
  '/assets',
  express.static(path.join(ROOT, 'assets', 'admin'), { index: false, maxAge: '1h' })
);

/* -------------------------------- 图片上传 -------------------------------- */

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename(req, file, cb) {
      // 绝不使用 originalname：只取扩展名并要求在白名单内，文件名完全由服务端生成。
      // 这样即便上传者把文件名写成 `../../evil.js` 也无从生效。
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ALLOWED_EXT.has(ext) ? ext : '.png';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/^image\//i.test(file.mimetype || '')) {
      return cb(new Error('只允许上传图片文件'));
    }
    return cb(null, true);
  },
});

/* --------------------------------- git --------------------------------- */

/**
 * 用 execFile + 数组参数调用 git —— 不经过 shell，
 * 因此 commit message 里的引号、分号、反引号都不可能变成命令注入。
 */
function git(args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = String(stdout || '');
        err.stderr = String(stderr || '');
        return reject(err);
      }
      return resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * 把 git 的原始报错翻译成能直接照做的提示。
 * git 的错误信息对不熟悉命令行的人几乎没有可操作性，这里补一层人话。
 *
 * ⚠️ 判断顺序有讲究：ssh 的报错经常同时命中多个模式。
 * 例如 known_hosts 读不了时，stderr 里既有 `hostkeys_foreach failed`
 * 也有 `Host key verification failed` —— 必须先判具体的那一个，
 * 否则会给出「执行一次 git push 完成校验」这种完全无效的建议。
 */
function explainGitError(err) {
  const raw = `${err.stderr || ''} ${err.message || ''}`;

  // 先判密钥被拒：这条也含 "Permission denied"，必须排在权限判断之前
  if (/Permission denied \(publickey\)/i.test(raw)) {
    return 'SSH 密钥未被 GitHub 接受。检查 ~/.ssh/config 里的 IdentityFile 是否指向已添加到 GitHub 账号的那把密钥。';
  }
  // known_hosts 读不了（权限/属主不对）—— 不是「指纹缺失」，重跑 push 没用
  if (/hostkeys_foreach failed|known_hosts.*(Permission denied|denied)/i.test(raw)) {
    return 'ssh 读不到 ~/.ssh/known_hosts（文件权限或属主不对）。在 Git Bash 里执行 chmod 600 ~/.ssh/known_hosts 后重试。';
  }
  // 指纹确实不在 known_hosts 里：手动推一次、回答 yes 即可
  if (/Host key verification failed|known_hosts/i.test(raw)) {
    return 'SSH 主机校验没通过。在终端里手动执行一次 git push 完成校验，之后就能正常发布了。';
  }
  if (/Could not resolve host|Connection timed out|Network is unreachable|Failed to connect/i.test(raw)) {
    return '连不上 GitHub。检查网络或代理设置。';
  }
  if (/non-fast-forward|\[rejected\]|fetch first/i.test(raw)) {
    return '远端有本地没有的提交，推送被拒。在终端执行 git pull --rebase 后再试。';
  }
  if (/not a git repository/i.test(raw)) {
    return '当前目录不是 git 仓库。';
  }
  return '';
}

/* --------------------------------- 页面 --------------------------------- */

/** 文章列表 */
router.get('/', (req, res) => {
  const posts = content.getAllPosts().map((p) => ({
    slug: p.slug,
    title: p.title,
    date: p.date,
    draft: p.draft,
    category: p.category,
    tags: p.tags,
    words: p.words,
    minutes: p.minutes,
    file: p.file,
  }));

  res.render('admin/list', {
    pageTitle: '内容管理',
    posts,
    stats: content.getStats(),
  });
});

/** 新建文章 */
router.get('/new', (req, res) => {
  res.render('admin/edit', {
    pageTitle: '写新文章',
    mode: 'create',
    post: {
      slug: '',
      title: '',
      date: today(),
      tags: '',
      category: '',
      summary: '',
      cover: '',
      /*
       * 默认**不勾**草稿。
       * 这里原先默认 true，结果是个陷阱：按钮写着「保存并发布」，存下去的却是草稿，
       * 本地因为 showDrafts 为真照样能看见，线上却被 readPost 整篇过滤掉 ——
       * 表现就是「我明明发布了，线上却没有」，且毫无提示。
       * 默认值与按钮语义一致，才符合直觉。
       */
      draft: false,
      pinned: false,
      featured: false,
      content: '',
    },
    templates: content.listTemplates(),
    allTags: content.getTags().map((t) => t.name),
    allCategories: content.getCategories().map((c) => c.name),
  });
});

/** 编辑已有文章 */
router.get('/edit/:slug', (req, res) => {
  const source = content.getPostSource(req.params.slug);
  if (!source) {
    return res.status(404).render('admin/edit', {
      pageTitle: '文章不存在',
      mode: 'missing',
      post: null,
      templates: [],
      allTags: [],
      allCategories: [],
    });
  }

  const data = source.data || {};
  return res.render('admin/edit', {
    pageTitle: `编辑 · ${data.title || source.slug}`,
    mode: 'edit',
    post: {
      slug: source.slug,
      title: String(data.title || ''),
      // frontmatter 里的 date 可能被 YAML 解析成 Date 对象，统一裁成 YYYY-MM-DD
      date: data.date ? String(data.date instanceof Date
        ? new Date(data.date.getTime() - data.date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
        : data.date).slice(0, 10) : '',
      tags: Array.isArray(data.tags) ? data.tags.join(', ') : String(data.tags || ''),
      category: String(data.category || ''),
      summary: String(data.summary || ''),
      cover: String(data.cover || ''),
      draft: data.draft === true,
      pinned: data.pinned === true,
      featured: data.featured === true,
      content: source.content,
    },
    templates: content.listTemplates(),
    allTags: content.getTags().map((t) => t.name),
    allCategories: content.getCategories().map((c) => c.name),
  });
});

/* --------------------------------- API --------------------------------- */

/** Markdown 预览：复用站点同一套渲染配置，保证预览与最终输出完全一致 */
router.post('/api/preview', (req, res) => {
  const markdown = String((req.body && req.body.content) || '');
  res.json({ ok: true, html: render(markdown) });
});

/** 保存文章（新建或覆盖） */
router.post('/api/save', (req, res, next) => {
  try {
    const body = req.body || {};
    const result = content.savePost({
      slug: body.slug,
      title: body.title,
      date: body.date,
      tags: body.tags,
      category: body.category,
      summary: body.summary,
      cover: body.cover,
      content: body.content,
      draft: body.draft === true || body.draft === 'true',
      pinned: body.pinned === true || body.pinned === 'true',
      featured: body.featured === true || body.featured === 'true',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * 读取写作模板。
 * 模板内容留在服务端的 content/templates/ 里，前端只拿名字来换内容 ——
 * 这样加模板是丢一个 .md 文件的事，不用碰任何 JS。
 */
router.post('/api/template', (req, res) => {
  const name = String((req.body && req.body.name) || '');
  const template = content.getTemplate(name);
  if (!template) {
    return res.status(404).json({ ok: false, message: '模板不存在' });
  }
  return res.json({ ok: true, template });
});

/**
 * 在系统默认浏览器里打开站点前台。
 *
 * 后台平时是以 `--app=` 模式跑的，那个窗口没有地址栏也没有标签页，
 * 直接点站内链接会把后台页面顶掉，用户还得按后退才能回来。
 * 绕一圈交给外部浏览器，后台窗口原地不动。
 *
 * 注意 url 由服务端自己拼，不接受任何客户端输入 —— 这层没有注入面。
 */
router.post('/api/open-site', (req, res) => {
  const url = `http://127.0.0.1:${config.server.port}/`;
  openInBrowser(url);
  res.json({ ok: true, url });
});

/** 删除文章 */
router.post('/api/delete', (req, res, next) => {
  try {
    const slug = String((req.body && req.body.slug) || '');
    const ok = content.deletePost(slug);
    res.json({ ok, message: ok ? '已删除' : '未找到该文章' });
  } catch (err) {
    next(err);
  }
});

/** 图片上传：返回可直接写进 Markdown 的路径 */
router.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, message: '没有收到文件' });
    }
    return res.json({
      ok: true,
      url: `${UPLOAD_URL_PREFIX}/${req.file.filename}`,
      name: req.file.filename,
      size: req.file.size,
    });
  });
});

/** 查看仓库当前状态：有多少改动、领先远端多少提交 */
router.get('/api/status', async (req, res) => {
  try {
    const { stdout } = await git(['status', '--porcelain']);
    const lines = stdout.split('\n').filter(Boolean);

    let ahead = 0;
    try {
      const { stdout: count } = await git(['rev-list', '--count', '@{u}..HEAD']);
      ahead = Number(count.trim()) || 0;
    } catch {
      // 没有配置上游分支时忽略，不影响主流程
    }

    res.json({ ok: true, changed: lines.length, ahead, files: lines.slice(0, 50) });
  } catch (err) {
    res.json({ ok: false, message: err.stderr || err.message });
  }
});

/** 发布：提交并推送，Render 收到后自动重新部署 */
router.post('/api/publish', async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim() || 'post: 更新内容';
  const steps = [];

  try {
    await git(['add', '-A']);
    steps.push('git add');

    // 没有改动时 commit 必然失败，这属于正常情况，友好返回而不是抛错
    const status = await git(['status', '--porcelain']);
    if (!status.stdout.trim()) {
      return res.json({
        ok: false,
        reason: 'NOTHING_TO_COMMIT',
        message: '没有需要提交的改动',
        steps,
      });
    }

    await git(['commit', '-m', message]);
    steps.push('git commit');

    const push = await git(['push'], { timeout: 120000 });
    steps.push('git push');

    return res.json({
      ok: true,
      message: '已发布，网站正在自动重新部署',
      steps,
      // git 把进度信息写在 stderr，这是正常行为，不是错误
      output: (push.stderr || push.stdout || '').trim(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: (err.stderr || err.message || '发布失败').trim(),
      hint: explainGitError(err),
      steps,
    });
  }
});

/* -------------------------------- 错误处理 -------------------------------- */
/*
 * 后台的 API 必须自己兜住错误。
 *
 * 全局错误处理只认 `/api/` 前缀，会把 `/admin/api/*` 的错误渲染成 HTML 页面，
 * 前端 res.json() 直接解析失败，用户只看到一句「响应解析失败」——
 * 既不知道发生了什么，也不知道该怎么办。
 */
router.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const tooLarge = err.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : err.status || 500).json({
      ok: false,
      message: tooLarge ? '内容太大了，单次提交上限 2 MB' : err.message || '服务异常',
    });
  }
  return next(err);
});

module.exports = router;
