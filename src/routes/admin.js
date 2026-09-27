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

const content = require('../lib/content');
const { render } = require('../lib/markdown');

const router = express.Router();
const ROOT = path.resolve(__dirname, '..', '..');
const UPLOAD_DIR = path.join(ROOT, 'public', 'images', 'uploads');
const UPLOAD_URL_PREFIX = '/images/uploads';

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
      date: '',
      tags: '',
      category: '',
      summary: '',
      cover: '',
      draft: true,
      content: '',
    },
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
      content: source.content,
    },
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
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
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
      message: err.stderr || err.message || '发布失败',
      steps,
    });
  }
});

module.exports = router;
