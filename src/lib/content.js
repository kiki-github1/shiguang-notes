'use strict';

/**
 * 内容仓库（Content Repository）。
 *
 * 设计要点：
 * 1. 文章以 Markdown 文件存储 —— 天然可版本管理、可迁移、不怕数据库损坏，符合数据安全诉求。
 * 2. 本模块是唯一的读取入口，未来换成数据库 / 远程 CMS，只需替换这一层的实现，路由与模板无需改动。
 * 3. 通过文件指纹（名称 + mtime + size）做缓存失效，开发时改完 Markdown 刷新页面即生效。
 */
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const dayjs = require('dayjs');

const config = require('../config');
const { render, extractToc } = require('./markdown');
const {
  countWords,
  readingTime,
  makeExcerpt,
  toDate,
  sortPosts,
} = require('./utils');

const ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(ROOT, config.content.postsDir);
const PAGES_DIR = path.join(ROOT, config.content.pagesDir);

/** 解析结果缓存 */
let cache = null;
let cacheSignature = '';

/** 读取目录下所有 .md 文件（含子目录） */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 生成内容指纹，用于判断是否需要重建缓存 */
function buildSignature(files) {
  return files
    .map((file) => {
      const stat = fs.statSync(file);
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    })
    .join('|');
}

/** 把 frontmatter 里的各种写法统一成数组 */
function toArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，;；]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/** 从文件名推导 slug，兼容 `2024-05-01-标题.md` 这类带日期前缀的命名 */
function slugFromFile(file) {
  const base = path.basename(file).replace(/\.(md|markdown)$/i, '');
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_]/, '').trim() || base;
}

/** 读取并规范化一篇文章 */
function readPost(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data = {}, content = '' } = matter(raw);
  if (data.draft === true && !config.content.showDrafts) return null;

  const slug = String(data.slug || slugFromFile(file)).trim();
  const dateObj = toDate(data.date) || toDate(fs.statSync(file).mtime) || new Date();
  const tags = toArray(data.tags || data.tag);
  const category = String(data.category || (toArray(data.categories)[0] ?? '') || '未分类').trim();
  const summary = String(data.summary || data.description || data.excerpt || '').trim()
    || makeExcerpt(content);

  return {
    slug,
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    title: String(data.title || slug).trim(),
    date: dayjs(dateObj).format('YYYY-MM-DD'),
    dateObj: dateObj.getTime(),
    dateLabel: dayjs(dateObj).format('YYYY 年 M 月 D 日'),
    updated: data.updated ? dayjs(toDate(data.updated) || dateObj).format('YYYY-MM-DD') : '',
    year: dayjs(dateObj).format('YYYY'),
    month: dayjs(dateObj).format('YYYY-MM'),
    tags,
    category,
    summary,
    cover: String(data.cover || '').trim(),
    draft: data.draft === true,
    pinned: data.pinned === true,
    featured: data.featured === true,
    series: String(data.series || '').trim(),
    layout: String(data.layout || '').trim(),
    markdown: content,
    html: render(content),
    toc: extractToc(content),
    words: countWords(content),
    minutes: readingTime(content),
  };
}

/**
 * 页面名白名单。
 * readPage 是唯一一处把外部输入拼进文件路径的地方，必须从源头掐断穿越：
 * 允许字母数字开头的 1~64 位 [A-Za-z0-9_-]，`../`、`/`、`\`、`.` 全部被拒。
 */
const SAFE_PAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** 读取 about 等独立页面 */
function readPage(name) {
  const key = String(name == null ? '' : name).trim();
  if (!SAFE_PAGE_NAME.test(key)) return null;

  const file = path.join(PAGES_DIR, `${key}.md`);
  // 双保险：即便白名单将来被改宽，也要求解析后的真实路径仍在 PAGES_DIR 之内
  if (!path.resolve(file).startsWith(path.resolve(PAGES_DIR) + path.sep)) return null;
  if (!fs.existsSync(file)) return null;

  const { data = {}, content = '' } = matter(fs.readFileSync(file, 'utf8'));
  return {
    name: key,
    title: String(data.title || name).trim(),
    description: String(data.description || '').trim(),
    updated: data.updated ? dayjs(toDate(data.updated) || new Date()).format('YYYY-MM-DD') : '',
    markdown: content,
    html: render(content),
    toc: extractToc(content),
  };
}

/* ------------------------------ 写作模板 ------------------------------ */
/*
 * 模板是「写作脚手架」而非内容：它们放在 content/templates/ 下，
 * 但**不参与**文章索引（walk 只扫 content/posts 与 content/pages），
 * 因此写模板文件永远不会被当成文章发布出去。
 *
 * 模板以 Markdown 文件承载，理由与文章一致 —— 想加一套自己的模板，
 * 直接丢一个 .md 进目录即可，不需要改代码。
 */

const TEMPLATES_DIR = path.join(ROOT, 'content', 'templates');

/*
 * 模板名白名单。与 readPage 同理：模板名会被拼进文件路径，
 * 必须从源头掐断 `../`、`/`、`\`、`.` 这类穿越写法。
 */
const SAFE_TEMPLATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** 列出全部模板。目录不存在时返回空数组，前端据此隐藏模板下拉 */
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];

  return walk(TEMPLATES_DIR)
    .map((file) => {
      const name = path.basename(file).replace(/\.(md|markdown)$/i, '');
      if (!SAFE_TEMPLATE_NAME.test(name)) return null;

      const { data = {} } = matter(fs.readFileSync(file, 'utf8'));
      return {
        name,
        label: String(data.label || name).trim(),
        description: String(data.description || '').trim(),
        order: Number(data.order) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'));
}

/** 读取单个模板的完整内容（建议的分类、标签与正文骨架） */
function getTemplate(name) {
  const key = String(name == null ? '' : name).trim();
  if (!SAFE_TEMPLATE_NAME.test(key)) return null;

  const file = path.join(TEMPLATES_DIR, `${key}.md`);
  // 双保险：即便白名单将来被改宽，也要求解析后的真实路径仍在 TEMPLATES_DIR 之内
  if (!path.resolve(file).startsWith(path.resolve(TEMPLATES_DIR) + path.sep)) return null;
  if (!fs.existsSync(file)) return null;

  const { data = {}, content = '' } = matter(fs.readFileSync(file, 'utf8'));
  return {
    name: key,
    label: String(data.label || key).trim(),
    category: String(data.category || '').trim(),
    tags: toArray(data.tags || data.tag),
    body: content.replace(/^\s*\n/, ''),
  };
}

/** 重建全部索引 */
function build() {
  const files = walk(POSTS_DIR);
  const signature = buildSignature(files);
  if (cache && signature === cacheSignature) return cache;

  const posts = sortPosts(files.map(readPost).filter(Boolean));

  // 标签索引
  const tagMap = new Map();
  const categoryMap = new Map();
  const archiveMap = new Map();
  let totalWords = 0;

  for (const post of posts) {
    totalWords += post.words;

    for (const tag of post.tags) {
      const item = tagMap.get(tag) || { name: tag, slug: tag, count: 0, posts: [] };
      item.count += 1;
      item.posts.push(post);
      tagMap.set(tag, item);
    }

    const cat = categoryMap.get(post.category) || { name: post.category, slug: post.category, count: 0, posts: [] };
    cat.count += 1;
    cat.posts.push(post);
    categoryMap.set(post.category, cat);

    const yearItem = archiveMap.get(post.year) || { year: post.year, count: 0, posts: [] };
    yearItem.count += 1;
    yearItem.posts.push(post);
    archiveMap.set(post.year, yearItem);
  }

  // 为每篇文章补上上一篇 / 下一篇（按时间倒序：index-1 是更新的，index+1 是更早的）
  posts.forEach((post, index) => {
    post.newer = index > 0 ? { slug: posts[index - 1].slug, title: posts[index - 1].title } : null;
    post.older = index < posts.length - 1
      ? { slug: posts[index + 1].slug, title: posts[index + 1].title }
      : null;
  });

  const tags = [...tagMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  const categories = [...categoryMap.values()].sort((a, b) => b.count - a.count);
  const archive = [...archiveMap.values()].sort((a, b) => Number(b.year) - Number(a.year));
  const series = [...new Set(posts.map((p) => p.series).filter(Boolean))]
    .map((name) => ({ name, posts: posts.filter((p) => p.series === name) }));

  const allTags = [...tagMap.keys()];

  cache = {
    posts,
    bySlug: new Map(posts.map((p) => [p.slug, p])),
    tags,
    tagMap,
    categories,
    archive,
    series,
    allTags,
    stats: {
      postCount: posts.length,
      tagCount: tags.length,
      categoryCount: categories.length,
      totalWords,
      /*
       * 取真正的最新日期，而不是「排序后第一篇」的日期。
       * sortPosts 会把置顶文章顶到最前，若直接取 posts[0].date，
       * 首页「最近更新」会长期显示那篇置顶旧文的日期 —— 置顶一篇，
       * 整个站点的更新时间就永远停在那天，与实际严重不符。
       * date 是 YYYY-MM-DD，字典序比较即等价于日期比较。
       */
      lastUpdated: posts.reduce((latest, p) => (p.date > latest ? p.date : latest), ''),
      firstYear: archive.length ? archive[archive.length - 1].year : '',
    },
  };
  cacheSignature = signature;
  return cache;
}

/* ------------------------------ 对外查询接口 ------------------------------ */

const getAllPosts = () => build().posts;
const getPost = (slug) => build().bySlug.get(String(slug)) || null;
const getTags = () => build().tags;
const getTag = (name) => build().tagMap.get(String(name)) || null;
const getCategories = () => build().categories;
const getCategory = (name) => build().categories.find((c) => c.name === String(name)) || null;
const getArchive = () => build().archive;
const getSeries = () => build().series;
const getStats = () => build().stats;
const getPage = (name) => readPage(name);

/** 相关文章：按共享标签数量打分 */
function getRelated(slug, limit = 3) {
  const target = getPost(slug);
  if (!target) return [];
  return getAllPosts()
    .filter((p) => p.slug !== slug)
    .map((p) => {
      const shared = p.tags.filter((t) => target.tags.includes(t)).length;
      const sameCategory = p.category === target.category ? 1 : 0;
      return { post: p, score: shared * 2 + sameCategory };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.post.dateObj - a.post.dateObj)
    .slice(0, limit)
    .map((item) => item.post);
}

/**
 * 正文匹配用的全小写副本，懒计算后挂在文章对象上。
 * 原先每次搜索都对每篇全文重复 toLowerCase，属于可被放大的重复开销；
 * 挂成不可枚举属性，因此不会污染 JSON 序列化与模板输出。
 */
function lowerIndex(post) {
  if (!post._lower) {
    Object.defineProperty(post, '_lower', {
      value: {
        title: post.title.toLowerCase(),
        summary: post.summary.toLowerCase(),
        tags: post.tags.join(' ').toLowerCase(),
        body: post.markdown.toLowerCase(),
      },
      enumerable: false,
      configurable: true,
    });
  }
  return post._lower;
}

/** 站内搜索：标题 / 摘要 / 标签 / 正文加权匹配 */
function search(keyword = '') {
  // 截断到上限：超长串既无检索意义，又会让 includes 匹配成本线性膨胀
  const q = String(keyword).slice(0, config.security.maxSearchLength).trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  return getAllPosts()
    .map((post) => {
      const idx = lowerIndex(post);
      let score = 0;
      for (const term of terms) {
        if (idx.title.includes(term)) score += 10;
        if (idx.tags.includes(term)) score += 6;
        if (idx.summary.includes(term)) score += 3;
        if (idx.body.includes(term)) score += 1;
      }
      return { post, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.post.dateObj - a.post.dateObj)
    .map((item) => item.post);
}

/** 强制清空缓存（后台写入后调用） */
function invalidate() {
  cache = null;
  cacheSignature = '';
}

/* ------------------------ 写入接口（后台管理专用） ------------------------ */

/*
 * slug 白名单。与 readPage 同理：这是把外部输入拼进文件路径的地方，
 * 必须从源头掐断穿越 —— 只允许小写字母数字与连字符，`../`、`/`、`\`、`.` 全部被拒。
 */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** 按 slug 定位磁盘上的实际文件（兼容 `2026-09-20-标题.md` 这类带日期前缀的命名） */
function findPostFile(slug) {
  return walk(POSTS_DIR).find((file) => slugFromFile(file) === slug) || null;
}

/** 读取文章原始源码，保留完整 frontmatter（编辑器需要原样回填） */
function getPostSource(slug) {
  const key = String(slug == null ? '' : slug).trim();
  if (!SAFE_SLUG.test(key)) return null;

  const file = findPostFile(key);
  if (!file) return null;

  const { data = {}, content = '' } = matter(fs.readFileSync(file, 'utf8'));
  return {
    slug: key,
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    data,
    content,
  };
}

/**
 * 保存文章（新建或覆盖）。
 * 写操作同样收敛在内容层，路由不直接碰文件系统 —— 将来换存储只需改这里。
 * 编辑已有文章时写回原文件；新建时按 `日期-slug.md` 命名，与既有风格一致。
 */
function savePost(input = {}) {
  const slug = String(input.slug || '').trim();
  if (!SAFE_SLUG.test(slug)) {
    const err = new Error('slug 只能由小写字母、数字和连字符组成，且以字母或数字开头');
    err.status = 400;
    throw err;
  }

  const existing = findPostFile(slug);
  const date = String(input.date || '').trim() || dayjs().format('YYYY-MM-DD');
  const target = existing || path.join(POSTS_DIR, `${date}-${slug}.md`);

  // 双保险：即便白名单将来被改宽，也要求解析后的真实路径仍在 POSTS_DIR 之内
  if (!path.resolve(target).startsWith(path.resolve(POSTS_DIR) + path.sep)) {
    const err = new Error('目标路径越界');
    err.status = 400;
    throw err;
  }

  const data = { title: String(input.title || slug).trim(), date };
  const tags = toArray(input.tags);
  if (tags.length) data.tags = tags;

  for (const [key, value] of [
    ['category', input.category],
    ['summary', input.summary],
    ['cover', input.cover],
    ['series', input.series],
  ]) {
    const text = String(value == null ? '' : value).trim();
    if (text) data[key] = text;
  }

  data.draft = input.draft === true;
  // 置顶 / 精选只在勾选时写入。取消勾选就删掉该键，而不是写成 `pinned: false`——
  // 后者会让每个文件都多一行无用字段，把 frontmatter 弄脏。
  if (input.pinned === true) data.pinned = true;
  if (input.featured === true) data.featured = true;

  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(target, matter.stringify(String(input.content || ''), data), 'utf8');
  invalidate();

  return { slug, file: path.relative(ROOT, target).replace(/\\/g, '/'), created: !existing };
}

/** 删除文章，返回是否真的删掉了文件 */
function deletePost(slug) {
  const key = String(slug == null ? '' : slug).trim();
  if (!SAFE_SLUG.test(key)) {
    const err = new Error('slug 不合法');
    err.status = 400;
    throw err;
  }

  const file = findPostFile(key);
  if (!file) return false;

  if (!path.resolve(file).startsWith(path.resolve(POSTS_DIR) + path.sep)) {
    const err = new Error('目标路径越界');
    err.status = 400;
    throw err;
  }

  fs.unlinkSync(file);
  invalidate();
  return true;
}

module.exports = {
  getAllPosts,
  getPost,
  getTags,
  getTag,
  getCategories,
  getCategory,
  getArchive,
  getSeries,
  getStats,
  getPage,
  listTemplates,
  getTemplate,
  getRelated,
  search,
  invalidate,
  getPostSource,
  savePost,
  deletePost,
};
