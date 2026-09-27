'use strict';

/**
 * JSON API 层。
 * 与页面路由共用同一内容仓库，因此未来做前后端分离、小程序、移动端时可直接复用，
 * 不需要重写任何内容逻辑。挂载在 /api 前缀下。
 */
const express = require('express');

const config = require('../config');
const content = require('../lib/content');
const { paginate } = require('../lib/utils');

const router = express.Router();

/** 列表接口只返回必要字段，避免把全文一次性吐出去 */
const toSummary = (post) => ({
  slug: post.slug,
  title: post.title,
  date: post.date,
  tags: post.tags,
  category: post.category,
  summary: post.summary,
  cover: post.cover,
  pinned: post.pinned,
  featured: post.featured,
  minutes: post.minutes,
  words: post.words,
});

router.get('/site', (req, res) => {
  res.json({
    site: {
      title: config.site.title,
      subtitle: config.site.subtitle,
      description: config.site.description,
      author: config.site.author,
      nav: config.nav,
    },
    stats: content.getStats(),
  });
});

router.get('/posts', (req, res) => {
  const page = paginate(content.getAllPosts(), req.query.page, Number(req.query.perPage) || config.site.postsPerPage);
  res.json({
    data: page.items.map(toSummary),
    pagination: {
      page: page.page,
      perPage: page.perPage,
      total: page.total,
      totalPages: page.totalPages,
    },
  });
});

router.get('/posts/:slug', (req, res) => {
  const post = content.getPost(req.params.slug);
  if (!post) return res.status(404).json({ error: 'NOT_FOUND', message: '文章不存在' });
  return res.json({ data: { ...toSummary(post), html: post.html, toc: post.toc, markdown: post.markdown } });
});

router.get('/tags', (req, res) => {
  res.json({
    data: content.getTags().map((t) => ({ name: t.name, count: t.count, posts: t.posts.map((p) => p.slug) })),
  });
});

router.get('/categories', (req, res) => {
  res.json({
    data: content.getCategories().map((c) => ({ name: c.name, count: c.count, posts: c.posts.map((p) => p.slug) })),
  });
});

router.get('/archive', (req, res) => {
  res.json({
    data: content.getArchive().map((y) => ({ year: y.year, count: y.count, posts: y.posts.map(toSummary) })),
  });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json({ query: q, data: content.search(q).map(toSummary) });
});

router.get('/stats', (req, res) => {
  res.json({ data: content.getStats() });
});

module.exports = router;
