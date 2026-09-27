'use strict';

/**
 * 站点级配置 —— 全站唯一的事实来源。
 * 想改站名、作者、导航、分页数量、主题色，只改这里，其余代码无需变动。
 *
 * 少数几项允许用环境变量覆盖（SITE_URL / HOST / PORT / TRUST_PROXY），
 * 目的是让同一份代码在本地、预览、生产三种环境下都不用改文件。
 */
const isProd = process.env.NODE_ENV === 'production';

/** 去掉结尾的斜杠，避免拼出 `https://example.com//post/x` 这种双斜杠链接 */
function normalizeBaseUrl(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  // 只接受 http/https，防止被塞进 javascript: 之类的伪协议
  if (!/^https?:\/\//i.test(value)) return '';
  return value.replace(/\/+$/, '');
}

module.exports = {
  site: {
    // 站名与副标题使用繁体，与古风版式呼应；正文内容仍为简体，两者互不影响
    title: '拾光筆記',
    subtitle: '技術筆記 · 生活隨筆',
    description: '一名开发者的技术沉淀与生活记录：工程实践、踩坑复盘、读书与日常。',
    author: '博主',
    // 页脚落款印章上的四个字
    seal: ['拾', '光', '筆', '記'],
    // 首页大标题
    heroTitle: ['落筆為記', '拾取流光'],
    email: '',
    language: 'zh-CN',
    // 部署到线上后改成真实域名，用于生成绝对链接与 SEO（RSS、sitemap、canonical、分享链接）。
    // 部署时不必改这行代码，直接用环境变量覆盖即可：SITE_URL=https://example.com
    url: normalizeBaseUrl(process.env.SITE_URL) || 'http://localhost:3000',
    // 首页每页文章数
    postsPerPage: 6,
    // 页脚备案等信息，留空则不显示
    icp: '',
  },

  theme: {
    // 'dark'（墨夜）| 'light'（宣纸），用户在前端切换后会写入 localStorage
    default: 'light',
    // 主色：朱砂。宣纸模式稍深，墨夜模式稍亮，修改后全站配色跟随变化
    accent: '#a32e26',
    accentDark: '#c05442',
  },

  // 顶部导航
  nav: [
    { name: '首頁', path: '/' },
    { name: '歸檔', path: '/archive' },
    { name: '標籤', path: '/tags' },
    { name: '關於', path: '/about' },
  ],

  // 社交链接，留空数组则不渲染该区域
  social: [
    { name: 'GitHub', url: 'https://github.com', icon: 'github' },
    { name: 'RSS', url: '/rss.xml', icon: 'rss' },
  ],

  content: {
    postsDir: 'content/posts',
    pagesDir: 'content/pages',
    // 开发模式下显示 draft: true 的文章
    showDrafts: !isProd,
  },

  server: {
    port: Number(process.env.PORT) || 3000,
    /*
     * 本地开发只听回环地址，同一局域网内的其他机器访问不到你的开发实例；
     * 但云平台（Render / Railway / Fly / Docker）的容器**必须**监听 0.0.0.0，
     * 否则平台的外部健康检查连不进来，会判定部署失败或一直显示不可访问。
     * 因此这里按环境自动切换，省得每次手动加 HOST=0.0.0.0。
     */
    host: process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
    // 仅当部署在 Nginx / Caddy 等反向代理之后才置 true（环境变量 TRUST_PROXY=true）。
    // 无条件开启会让攻击者用 X-Forwarded-For 伪造来源 IP，从而绕过按 IP 的限流。
    trustProxy: process.env.TRUST_PROXY === 'true',
  },

  security: {
    // 全站动态请求限流（静态资源不计入，见 server.js 中间件顺序）
    global: { windowMs: 60 * 1000, limit: 300 },
    // 搜索更严：每次搜索都要遍历全部文章正文，是站内最昂贵的操作
    search: { windowMs: 60 * 1000, limit: 30 },
    // 单次搜索关键词上限，避免超长串把匹配过程拖慢
    maxSearchLength: 64,
    // HSTS 只在生产环境下发。本地 http 开发若下发 HSTS，
    // 浏览器会把 localhost 记成强制 HTTPS 主机，之后访问直接失败。
    hsts: isProd,
  },
};
