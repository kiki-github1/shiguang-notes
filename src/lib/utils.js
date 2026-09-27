'use strict';

/**
 * 通用工具函数：日期、摘要、字数统计、slug 处理等。
 */

/** 中英文混排的字数统计：CJK 按字计，拉丁按词计 */
function countWords(text = '') {
  const plain = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_~\-|]/g, ' ');
  const cjk = (plain.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = (plain.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

/** 预估阅读时长，按中文 400 字/分钟 */
function readingTime(text = '') {
  return Math.max(1, Math.round(countWords(text) / 400));
}

/** 把任意标题转成可用作锚点的 slug，保留中文 */
function slugify(input = '') {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\u4e00-\u9fa5a-z0-9\-_.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

/** 生成纯文本摘要，用于列表页与 SEO description */
function makeExcerpt(markdown = '', limit = 150) {
  const plain = String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

/** 解析日期，兼容 Date 对象、ISO 字符串、YYYY-MM-DD */
function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().replace(/\//g, '-');
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** 稳定的文章排序：置顶优先，其次按日期倒序 */
function sortPosts(posts = []) {
  return [...posts].sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
    return b.dateObj - a.dateObj;
  });
}

/** 单页条数上限：perPage 来自查询串，必须收敛，否则可被用来一次性拉走全部数据 */
const MAX_PER_PAGE = 50;

/** 数组分页 */
function paginate(items = [], page = 1, perPage = 10) {
  const total = items.length;
  // 把 perPage 收敛到 [1, MAX_PER_PAGE]。
  // 原先不收敛：perPage=-1 会让 slice(0, -1) 静默吞掉最后一篇，perPage=1e9 则全量返回。
  const size = Math.min(Math.max(1, Math.floor(Number(perPage)) || 10), MAX_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    perPage: size,
    total,
    totalPages,
    hasPrev: current > 1,
    hasNext: current < totalPages,
    prevPage: current - 1,
    nextPage: current + 1,
  };
}

/** 转义 HTML，供 RSS 等纯文本场景使用 */
function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  countWords,
  readingTime,
  slugify,
  makeExcerpt,
  toDate,
  sortPosts,
  paginate,
  escapeXml,
};
