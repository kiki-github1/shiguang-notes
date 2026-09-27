'use strict';

/**
 * 页面路由 —— 服务端渲染。
 * 服务端直出 HTML 的好处：SEO 友好、首屏无需等 JS、内容不依赖客户端脚本。
 */
const express = require('express');

const config = require('../config');
const content = require('../lib/content');
const { paginate, escapeXml } = require('../lib/utils');

const router = express.Router();

/* -------------------------------- 首页 -------------------------------- */
router.get('/', (req, res) => {
  const page = paginate(content.getAllPosts(), req.query.page, config.site.postsPerPage);
  const featured = content.getAllPosts().filter((p) => p.featured).slice(0, 3);
  const highlight = page.page === 1 ? (featured.length ? featured : page.items.slice(0, 1)) : [];

  res.render('index', {
    title: null,
    page,
    highlight,
    tags: content.getTags().slice(0, 12),
    activePath: '/',
  });
});

/* ------------------------------ 文章详情 ------------------------------ */
router.get('/post/:slug', (req, res, next) => {
  const post = content.getPost(req.params.slug);
  if (!post) return next();

  res.render('post', {
    title: post.title,
    description: post.summary,
    post,
    related: content.getRelated(post.slug, 3),
    activePath: '',
  });
});

/* ------------------------------ 标签列表 ------------------------------ */
router.get('/tags', (req, res) => {
  res.render('tags', {
    title: '标签',
    description: '按标签浏览全部文章',
    tags: content.getTags(),
    categories: content.getCategories(),
    activePath: '/tags',
  });
});

/* ---------------------------- 单个标签页 ----------------------------- */
router.get('/tag/:name', (req, res, next) => {
  const tag = content.getTag(req.params.name);
  if (!tag) return next();

  res.render('tag', {
    title: `标签：${tag.name}`,
    description: `标签「${tag.name}」下的全部文章，共 ${tag.count} 篇`,
    tag,
    posts: tag.posts,
    siblingTags: content.getTags().filter((t) => t.name !== tag.name).slice(0, 10),
    activePath: '/tags',
  });
});

/* ------------------------------ 分类列表 ------------------------------ */
router.get('/categories', (req, res) => {
  res.render('categories', {
    title: '分类',
    description: '按分类浏览全部文章',
    categories: content.getCategories(),
    activePath: '/categories',
  });
});

router.get('/category/:name', (req, res, next) => {
  const category = content.getCategory(req.params.name);
  if (!category) return next();

  res.render('tag', {
    title: `分类：${category.name}`,
    description: `分类「${category.name}」下的全部文章，共 ${category.count} 篇`,
    tag: { ...category, kind: '分類' },
    posts: category.posts,
    siblingTags: content.getCategories().filter((c) => c.name !== category.name).slice(0, 10),
    activePath: '/categories',
  });
});

/* -------------------------------- 归档 -------------------------------- */
router.get('/archive', (req, res) => {
  res.render('archive', {
    title: '归档',
    description: '按时间浏览全部文章',
    archive: content.getArchive(),
    series: content.getSeries(),
    activePath: '/archive',
  });
});

/* -------------------------------- 搜索 -------------------------------- */
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const results = q ? content.search(q) : [];

  res.render('search', {
    title: q ? `搜索：${q}` : '搜索',
    description: '站内搜索',
    query: q,
    results,
    activePath: '',
  });
});

/* -------------------------------- 关于 -------------------------------- */
router.get('/about', (req, res) => {
  const page = content.getPage('about');
  res.render('about', {
    title: page ? page.title : '关于',
    description: page ? page.description : '关于本站',
    page,
    stats: content.getStats(),
    tags: content.getTags().slice(0, 16),
    activePath: '/about',
  });
});

/* ------------------------------ RSS 订阅 ------------------------------ */
router.get('/rss.xml', (req, res) => {
  const site = config.site;
  const posts = content.getAllPosts().slice(0, 20);
  const items = posts
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${site.url}/post/${encodeURIComponent(post.slug)}</link>
      <guid isPermaLink="true">${site.url}/post/${encodeURIComponent(post.slug)}</guid>
      <pubDate>${new Date(post.dateObj).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary)}</description>
    </item>`
    )
    .join('\n');

  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.title)}</title>
    <link>${site.url}</link>
    <description>${escapeXml(site.description)}</description>
    <language>${site.language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`);
});

/* ---------------------------- sitemap.xml ---------------------------- */
router.get('/sitemap.xml', (req, res) => {
  const site = config.site;
  const urls = [
    { loc: `${site.url}/`, lastmod: content.getStats().lastUpdated },
    { loc: `${site.url}/archive` },
    { loc: `${site.url}/tags` },
    { loc: `${site.url}/about` },
    ...content.getAllPosts().map((p) => ({
      loc: `${site.url}/post/${encodeURIComponent(p.slug)}`,
      lastmod: p.updated || p.date,
    })),
  ];

  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
  .join('\n')}
</urlset>`);
});

module.exports = router;
