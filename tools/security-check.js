'use strict';

/**
 * 安全自检脚本。
 *
 * 用原生 http/https 模块手工拼请求路径 —— 关键点：绝不用 fetch/axios 之类的客户端，
 * 因为它们会把 `..%2f..%2f` 这类编码规范化掉，导致穿越测试根本打不到服务端。
 *
 * 用法：node tools/security-check.js [baseUrl]
 *   node tools/security-check.js                                  # 本地 http://127.0.0.1:3000
 *   EXPECT_HSTS=1 node tools/security-check.js https://example.com
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = new URL(process.argv[2] || 'http://127.0.0.1:3000');

/*
 * 按 baseUrl 的协议选择传输层。
 *
 * 必须区分 http / https：若拿 http 模块去请求 https 站点，请求会以明文发出，
 * 被反向代理（Cloudflare / Nginx）301 重定向到 https，于是所有断言读到的
 * 都是那个重定向响应 —— 安全头「全部缺失」、限流「未生效」、状态码清一色 301，
 * 全是假警报。本脚本最初就踩过这个坑。
 */
const transport = BASE.protocol === 'https:' ? https : http;

let pass = 0;
let warn = 0;
let fail = 0;

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** 原始请求：path 原样下发，不做任何规范化 */
function request(method, rawPath, { headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const req = transport.request(
      {
        host: BASE.hostname,
        // URL 未显式写端口时 BASE.port 是空串，传 undefined 让模块用默认端口
        // （http 80 / https 443）
        port: BASE.port || undefined,
        method,
        path: rawPath,
        headers,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: buf.toString('utf8'),
            bytes: buf.length,
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: '', bytes: 0, timeout: true });
    });
    req.on('error', (err) => resolve({ status: 0, headers: {}, body: '', bytes: 0, error: err.code }));
    if (body) req.write(body);
    req.end();
  });
}

function report(level, title, detail) {
  if (level === 'PASS') {
    pass += 1;
    console.log(`${c.green('  ✓')} ${title}${detail ? c.dim(` — ${detail}`) : ''}`);
  } else if (level === 'WARN') {
    warn += 1;
    console.log(`${c.yellow('  !')} ${title}${detail ? c.dim(` — ${detail}`) : ''}`);
  } else {
    fail += 1;
    console.log(`${c.red('  ✗')} ${title}${detail ? c.dim(` — ${detail}`) : ''}`);
  }
}

function section(name) {
  console.log(`\n${c.bold(name)}`);
}

(async () => {
  console.log(c.bold(`\n安全自检 → ${BASE.origin}\n${'─'.repeat(52)}`));

  /* ─────────────── 0. 协议自检 ─────────────── */
  // 若首个请求就被 3xx 重定向，说明 baseUrl 的协议写错了（或站点强制跳转）。
  // 此时后续断言全部基于重定向响应得出结论，会产出一堆假警报，必须先拦下来。
  const probe = await request('GET', '/');
  if (probe.status >= 300 && probe.status < 400 && probe.headers.location) {
    console.log(c.yellow(`  ! 收到 ${probe.status} 重定向 → ${probe.headers.location}`));
    console.log(c.yellow(`    当前 baseUrl 协议为 ${BASE.protocol}，后续结果不可信。`));
    console.log(c.yellow('    请改用跳转目标的协议重跑。\n'));
  }

  /* ─────────────── 1. 敏感文件是否可被直接下载 ─────────────── */
  section('1. 敏感文件暴露');
  const sensitive = [
    '/.env',
    '/.env.local',
    '/package.json',
    '/package-lock.json',
    '/.gitignore',
    '/.git/config',
    '/.git/HEAD',
    '/server.js',
    '/src/config.js',
    '/src/lib/content.js',
    '/README.md',
    '/node_modules/express/package.json',
    '/.workbuddy-ai/memory/MEMORY.md',
  ];
  for (const p of sensitive) {
    const res = await request('GET', p);
    if (res.status === 200 && res.bytes > 0) {
      report('FAIL', `敏感文件可下载：${p}`, `${res.status}, ${res.bytes} bytes`);
    } else {
      report('PASS', `${p} → ${res.status}`);
    }
  }

  /* ─────────────── 2. 路径穿越（静态资源层） ─────────────── */
  section('2. 路径穿越 · 静态资源');
  const traversals = [
    '/../server.js',
    '/..%2fserver.js',
    '/..%2F..%2Fserver.js',
    '/%2e%2e%2fserver.js',
    '/%2e%2e/%2e%2e/server.js',
    '/css/../../server.js',
    '/css/..%2f..%2fserver.js',
    '/images/../../.env',
    '/images/%2e%2e/%2e%2e/.env',
    '/....//....//server.js',
    '/..%5cserver.js',
    '/css/%2e%2e%5c%2e%2e%5cserver.js',
  ];
  for (const p of traversals) {
    const res = await request('GET', p);
    const leaked = res.status === 200 && /require\(|module\.exports|node_modules/.test(res.body);
    if (leaked) {
      report('FAIL', `穿越成功：${p}`, `${res.status}, ${res.bytes} bytes`);
    } else {
      report('PASS', `${p} → ${res.status}`);
    }
  }

  /* ─────────────── 3. 路径穿越（业务路由层） ─────────────── */
  section('3. 路径穿越 · 业务路由');
  const routeTraversals = [
    '/post/..%2f..%2fserver',
    '/post/..%2f..%2f..%2fserver',
    '/tag/..%2f..%2fserver',
    '/category/..%2f..%2fserver',
    '/page/..%2f..%2fserver',
    '/post/%2e%2e%2f%2e%2e%2fpackage',
    '/tag/%2e%2e%2f%2e%2e%2f.env',
  ];
  for (const p of routeTraversals) {
    const res = await request('GET', p);
    const leaked = res.status === 200 && /require\(|module\.exports|"dependencies"|SECRET|APP_KEY/.test(res.body);
    if (leaked) {
      report('FAIL', `穿越成功：${p}`, `${res.status}, ${res.bytes} bytes`);
    } else {
      report('PASS', `${p} → ${res.status}`);
    }
  }

  /* ─────────────── 4. 反射型 XSS ─────────────── */
  section('4. 反射型 XSS');
  /**
   * 判定要点：payload 里不含 < > " ' & 时，原样出现在文本节点或属性值里
   * 根本不可执行（例如 `javascript:alert(1)` 落在 <strong> 里只是纯文本），
   * 上一版直接 includes 判断会产生误报。真正的命中条件是「未转义的标签被引入文档」。
   */
  function assessXss(payload, body, contentType) {
    if (!contentType.includes('text/html')) return { safe: true, note: '非 HTML 上下文' };
    if (!/[<>"'&]/.test(payload)) return { safe: true, note: '无 HTML 特殊字符，落点不可执行' };
    if (!body.includes(payload)) return { safe: true, note: '已转义' };
    const injected =
      /<script[\s>]/i.test(body) ||
      /<svg[\s>]/i.test(body) ||
      /<img[^>]*\son\w+\s*=/i.test(body) ||
      /<\/title>\s*</i.test(body) ||
      /on\w+\s*=\s*alert/i.test(body);
    return injected
      ? { safe: false, note: '未转义标签注入' }
      : { safe: true, note: '原样出现但落点为文本/属性值' };
  }

  const xssPayloads = [
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '</title><svg onload=alert(1)>',
    "' onmouseover='alert(1)",
    '<iframe src=javascript:alert(1)>',
  ];
  for (const payload of xssPayloads) {
    const enc = encodeURIComponent(payload);
    for (const path of [`/search?q=${enc}`, `/api/search?q=${enc}`]) {
      const res = await request('GET', path);
      const ctype = res.headers['content-type'] || '';
      const verdict = assessXss(payload, res.body, ctype);
      report(verdict.safe ? 'PASS' : 'FAIL', `${path}`, `${verdict.note} · ${ctype.split(';')[0]}`);
    }
  }

  /* ─────────────── 5. 资源耗尽 / 超长参数 ─────────────── */
  section('5. 超长参数与异常分页');
  const bigQ = 'A'.repeat(100000);
  let t0 = Date.now();
  let res = await request('GET', `/api/search?q=${bigQ}`);
  // status 0 表示连接被对端重置：Node 的 maxHeaderSize（默认 16KB）在解析请求行时就直接拒了，
  // 请求根本没进到业务逻辑。这是有效防御，不是缺陷。
  report([0, 400, 414, 431].includes(res.status) ? 'PASS' : 'WARN',
    `超长 q (100KB) → ${res.status === 0 ? '连接被拒（Node maxHeaderSize 兜底）' : res.status}`,
    `${Date.now() - t0}ms`);

  const bigPath = `/post/${'a'.repeat(60000)}`;
  t0 = Date.now();
  res = await request('GET', bigPath);
  report([0, 400, 404, 414, 431].includes(res.status) ? 'PASS' : 'WARN',
    `超长路径 (60KB) → ${res.status === 431 ? '431 请求头过大' : res.status}`,
    `${Date.now() - t0}ms`);

  const pageCases = [
    ['perPage=-1', '/api/posts?perPage=-1'],
    ['perPage=0', '/api/posts?perPage=0'],
    ['perPage=99999999', '/api/posts?perPage=99999999'],
    ['perPage=abc', '/api/posts?perPage=abc'],
    ['page=-5', '/api/posts?page=-5'],
    ['page=1e9', '/api/posts?page=1e9'],
    ['page=NaN', '/api/posts?page=NaN'],
  ];
  for (const [label, path] of pageCases) {
    const r = await request('GET', path);
    let count = null;
    try {
      count = JSON.parse(r.body).data.length;
    } catch (_) { /* ignore */ }
    const ok = r.status === 200 && count !== null && count >= 0 && count <= 100;
    report(ok ? 'PASS' : 'WARN', `${label} → ${r.status}`, `返回 ${count} 条`);
  }

  /* ─────────────── 6. 响应头基线 ─────────────── */
  section('6. 安全响应头');
  const home = await request('GET', '/');
  const h = home.headers;
  const expect = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': null,
    'referrer-policy': null,
    'content-security-policy': null,
    'cross-origin-opener-policy': null,
    'cross-origin-resource-policy': null,
  };
  for (const [key, want] of Object.entries(expect)) {
    const val = h[key];
    if (val === undefined) {
      report('WARN', `缺失响应头：${key}`);
    } else if (want && val !== want) {
      report('WARN', `${key} = ${val}（期望 ${want}）`);
    } else {
      report('PASS', `${key} = ${String(val).slice(0, 70)}`);
    }
  }
  if (h['x-powered-by']) {
    report('FAIL', `X-Powered-By 未移除：${h['x-powered-by']}`);
  } else {
    report('PASS', 'X-Powered-By 已移除');
  }

  // Server 头不应泄露技术栈
  if (h.server) report('WARN', `Server 头暴露：${h.server}`);
  else report('PASS', 'Server 头未下发');

  // HSTS：本地 http 环境绝不该下发，否则浏览器会把 localhost 记成强制 HTTPS 主机。
  // 若服务端是以 NODE_ENV=production 起的（本地验证生产行为），用 EXPECT_HSTS=1 声明预期。
  const expectHsts = process.env.EXPECT_HSTS === '1';
  const isLocal = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(BASE.hostname);
  const hsts = h['strict-transport-security'];
  if (hsts && isLocal && !expectHsts) {
    report('WARN', '本地 http 环境下发了 HSTS', '浏览器会把 localhost 记住并强制升级 HTTPS，导致后续访问失败');
  } else if (hsts) {
    report('PASS', `HSTS = ${hsts}`);
  } else {
    report(expectHsts ? 'FAIL' : isLocal ? 'PASS' : 'WARN',
      `HSTS 未下发${expectHsts ? '（已声明预期下发）' : isLocal ? '（本地开发，符合预期）' : '（生产环境应下发）'}`);
  }

  const csp = h['content-security-policy'] || '';
  const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
  const styleSrc = (csp.match(/style-src([^;]*)/) || [])[1] || '';
  report(!scriptSrc.includes('unsafe-inline') ? 'PASS' : 'FAIL', `script-src:${scriptSrc.trim()}`);
  report(!styleSrc.includes('unsafe-inline') ? 'PASS' : 'WARN', `style-src:${styleSrc.trim()}`);

  /* ─────────────── 7. HTTP 方法限制 ─────────────── */
  section('7. HTTP 方法');
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'OPTIONS', 'HEAD']) {
    const r = await request(m, '/');
    const ok = m === 'TRACE' ? r.status !== 200 : true;
    report(ok ? 'PASS' : 'FAIL', `${m} / → ${r.status}`);
  }
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await request(m, '/api/posts', { body: '{}', headers: { 'content-type': 'application/json' } });
    report(r.status !== 200 ? 'PASS' : 'WARN', `${m} /api/posts → ${r.status}`);
  }

  /* ─────────────── 8. 错误信息泄露 ─────────────── */
  section('8. 错误信息泄露');
  const errPaths = ['/api/posts/%00', '/post/%00', '/%00', '/api/nonexistent', '/api/../../etc/passwd'];
  for (const p of errPaths) {
    const r = await request('GET', p);
    const leak = /at Object\.|node:internal|\.js:\d+:\d+|ENOENT|C:\\|D:\\/.test(r.body);
    report(leak ? 'FAIL' : 'PASS', `${p} → ${r.status}`, leak ? '响应体含堆栈/路径' : '');
  }

  /* ─────────────── 9. 主机头注入 / 缓存投毒 ─────────────── */
  section('9. Host 头与缓存');
  const poison = await request('GET', '/', { headers: { Host: 'evil.example.com' } });
  if (/evil\.example\.com/.test(poison.body)) {
    report('WARN', 'Host 头被反射进页面（canonical/og:url 可能被污染）');
  } else {
    report('PASS', 'Host 头未被反射');
  }
  const acao = home.headers['access-control-allow-origin'];
  report(acao === undefined || acao !== '*' ? 'PASS' : 'WARN',
    `CORS: ${acao === undefined ? '未开启' : acao}`);

  /* ─────────────── 10. 缓存控制 ─────────────── */
  section('10. 缓存策略');
  const css = await request('GET', '/css/style.css');
  const cc = css.headers['cache-control'] || '';
  report(/max-age/.test(cc) ? 'PASS' : 'WARN', `静态资源 Cache-Control: ${cc || '(无)'}`);
  report(home.headers['cache-control'] === undefined || /no-store|no-cache/.test(home.headers['cache-control'] || '')
    ? 'PASS' : 'WARN', `页面 Cache-Control: ${home.headers['cache-control'] || '(无)'}`);

  /* ─────────────── 11. CSP nonce 与内联样式残留 ─────────────── */
  section('11. CSP nonce 与内联样式');
  const nonceFromHeader = (csp.match(/'nonce-([^']+)'/) || [])[1];
  const nonceFromHtml = (home.body.match(/<style nonce="([^"]+)"/) || [])[1];
  if (!nonceFromHeader) {
    report('FAIL', 'CSP 头里没有 nonce');
  } else if (nonceFromHeader === nonceFromHtml) {
    report('PASS', '响应头与页面 <style> 的 nonce 一致', `${nonceFromHeader.slice(0, 10)}…`);
  } else {
    report('FAIL', 'nonce 不一致', `header=${nonceFromHeader} html=${nonceFromHtml}`);
  }

  // nonce 必须逐请求变化，否则等同于固定值，失去意义
  const second = await request('GET', '/');
  const nonce2 = ((second.headers['content-security-policy'] || '').match(/'nonce-([^']+)'/) || [])[1];
  report(nonce2 && nonce2 !== nonceFromHeader ? 'PASS' : 'FAIL', 'nonce 逐请求随机');

  // 内联 style 属性应已全部提为 CSS 类
  let inlineStyleHits = 0;
  const styleScan = [];
  for (const p of ['/', '/about', '/tags', '/archive', '/tag/JavaScript']) {
    const r = await request('GET', p);
    const hits = (r.body.match(/\sstyle="/g) || []).length;
    if (hits) styleScan.push(`${p}(${hits})`);
    inlineStyleHits += hits;
  }
  report(inlineStyleHits === 0 ? 'PASS' : 'FAIL',
    '内联 style 属性残留',
    inlineStyleHits === 0 ? '0 处' : styleScan.join(', '));

  /* ─────────────── 12. 内容安全策略有效性 ─────────────── */
  section('12. 其它加固项');
  const apiSearch = await request('GET', '/api/search?q=%3Cscript%3E');
  report(apiSearch.headers['content-type'] && apiSearch.headers['content-type'].includes('application/json')
    ? 'PASS' : 'WARN', `API content-type: ${apiSearch.headers['content-type']}`);
  // json escape：< 应被转成 \u003c，即便被当 HTML 解析也成不了标签
  report(/\\u003c/i.test(apiSearch.body) ? 'PASS' : 'WARN',
    'JSON 响应已做 < 转义（json escape）', apiSearch.body.slice(0, 60));

  const pageCC = home.headers['cache-control'] || '';
  report(/no-cache|no-store/.test(pageCC) ? 'PASS' : 'WARN', `页面 Cache-Control: ${pageCC || '(无)'}`);

  /* ─────────────── 13. 限流（放最后，会耗尽配额） ─────────────── */
  section('13. 限流生效性');
  let attempts = 0;
  let hit429 = false;
  for (let i = 0; i < 60; i += 1) {
    attempts += 1;
    const r = await request('GET', '/api/search?q=probe');
    if (r.status === 429) {
      hit429 = true;
      const body = (() => {
        try { return JSON.parse(r.body).error; } catch (_) { return r.body.slice(0, 40); }
      })();
      report('PASS', `连续请求在第 ${attempts} 次收到 429`, `body=${body} · Retry-After=${r.headers['retry-after'] || '-'}`);
      break;
    }
  }
  if (!hit429) report('WARN', `连续 ${attempts} 次请求仍未触发限流`);
  const rlHeaders = (await request('GET', '/api/search?q=probe')).headers;
  report(rlHeaders['ratelimit'] || rlHeaders['ratelimit-limit'] ? 'PASS' : 'WARN',
    `限流响应头: ${rlHeaders.ratelimit || rlHeaders['ratelimit-limit'] || '(缺失)'}`);

  /* ─────────────── 汇总 ─────────────── */
  console.log(`\n${'─'.repeat(52)}`);
  console.log(
    `${c.bold('汇总')}  ${c.green(`通过 ${pass}`)}  ${c.yellow(`警告 ${warn}`)}  ${c.red(`失败 ${fail}`)}\n`
  );
  process.exit(fail > 0 ? 1 : 0);
})();
