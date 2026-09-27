'use strict';

/**
 * 判断某个端口上跑的到底是不是本项目的后台。
 *
 * 双击图标启动时，最常见的失败是「端口已被占用」。但光凭端口号分不出两种情况：
 *   1. 后台本来就在跑（用户只是把窗口关了）—— 应该把窗口调出来，而不是报错
 *   2. 别的程序占了同一个端口 —— 这时得说清楚，否则用户只会反复双击
 * 所以真去看一眼那个端口上返回的是不是本项目的页面。
 *
 * 认的是后台页面里的品牌字样「拾光筆記」，而不是「有没有响应」——
 * 任何 HTTP 服务都会有响应，那样等于没判断。
 */

const http = require('http');

/** 品牌标记。后台列表页与编辑页的标题栏都含它 */
const MARKER = '拾光筆記';
/** 页面可能很长，读到这么多字节足够覆盖 <title> 与页头 */
const MAX_BYTES = 8192;

/**
 * @param {number} port
 * @param {{timeout?: number}} [options]
 * @returns {Promise<boolean>} 是本项目后台返回 true；超时、拒绝连接、非 200、内容不符都返回 false
 */
function probeAdmin(port, { timeout = 900 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.get({ host: '127.0.0.1', port, path: '/admin', timeout }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // 不读走响应体，socket 不会释放
        return done(false);
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length >= MAX_BYTES) {
          res.destroy();
          done(body.includes(MARKER));
        }
      });
      res.on('end', () => done(body.includes(MARKER)));
      res.on('error', () => done(false));
    });

    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
    req.on('error', () => done(false));
  });
}

module.exports = { probeAdmin, MARKER };
