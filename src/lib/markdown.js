'use strict';

/**
 * Markdown 渲染层。
 * 基于 markdown-it，附加：代码高亮、标题锚点、目录提取、外链安全属性、图片懒加载。
 */
const MarkdownIt = require('markdown-it');
const markdownItAnchor = require('markdown-it-anchor');
const hljs = require('highlight.js');
const { slugify } = require('./utils');

const md = new MarkdownIt({
  html: true,        // 允许文章内嵌少量 HTML（表格、折叠块等）
  linkify: true,     // 裸链接自动转 <a>
  typographer: true, // 中英文标点美化
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${md.utils.escapeHtml(lang)}">${html}</code></pre>`;
      } catch (_) {
        /* 落到下方兜底 */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

// 标题锚点：让目录跳转和分享定位可用
md.use(markdownItAnchor, {
  slugify,
  permalink: markdownItAnchor.permalink.linkInsideHeader({
    symbol: '#',
    placement: 'after',
    class: 'heading-anchor',
    ariaHidden: true,
  }),
});

// 外链加安全属性，图片懒加载
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer nofollow');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy');
  tokens[idx].attrSet('decoding', 'async');
  return defaultImage(tokens, idx, options, env, self);
};

/** 渲染 Markdown 为 HTML */
function render(markdown = '') {
  return md.render(String(markdown));
}

/** 渲染行内 Markdown（不产生 <p> 包裹），用于标题、摘要等 */
function renderInline(markdown = '') {
  return md.renderInline(String(markdown));
}

/**
 * 从 Markdown 源码中提取目录（h2/h3 两级，可按需扩展）。
 * 直接复用渲染器的 slugify，保证锚点与正文 id 完全一致。
 */
function extractToc(markdown = '') {
  const tokens = md.parse(String(markdown), {});
  const toc = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;
    const level = Number(token.tag.slice(1));
    if (level < 2 || level > 3) continue;
    const inline = tokens[i + 1];
    const text = inline && inline.type === 'inline' ? inline.content.trim() : '';
    if (!text) continue;
    toc.push({ level, text, slug: slugify(text) });
  }
  return toc;
}

module.exports = { md, render, renderInline, extractToc };
