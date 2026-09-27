'use strict';

/**
 * 以「独立应用窗口」的方式打开后台。
 *
 * 做法是调用 Chrome / Edge 的 `--app=` 模式：窗口没有地址栏、没有标签页、
 * 没有书签栏，任务栏上是它自己的图标 —— 观感与真正的桌面应用一致，
 * 却不用引入 Electron 那一整套运行时。
 *
 * 找不到已知浏览器时退化成系统默认浏览器（普通标签页），
 * 功能不受影响，只是少了那层「应用感」。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** 常见安装位置，按「最可能命中」的顺序排。允许用 ADMIN_BROWSER_PATH 手动指定 */
function browserCandidates() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';

  return [
    process.env.ADMIN_BROWSER_PATH,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : '',
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // 权限等原因读不到就跳过，继续试下一个
    }
  }
  return null;
}

/** 打开 url。返回 { mode: 'app' | 'tab', browser }，供启动日志说明用了哪条路径 */
function openAsApp(url) {
  const browser = findBrowser();

  if (browser) {
    /*
     * 用一个固定的临时目录当 Chrome 用户配置目录，每次启动先清空再建。
     *
     * 复用默认配置目录会踩两个坑：
     *   1. 上一次 --app= 会话没退干净（崩溃 / 任务管理器强杀），下一次启动
     *      Chrome 会卡在「Profile is in use by another process」之类的恢复流程，
     *      新窗口就此一片空白、连 X 都按不动 —— 用户报告的就是这种状态
     *   2. 默认配置里累积的扩展、cookie 与磁盘缓存也会拖慢首屏
     * 本地写作后台不需要保留任何状态（无登录、无扩展、无 cookie），每次给一个
     * 干净的反倒最稳。
     *
     * 同步操作：服务进程就在这里停一下，相比异步 race 来说反而更确定。
     */
    const profileDir = path.join(os.tmpdir(), 'shiguang-admin-profile');
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // 清不掉的旧目录不影响这次启动，Chrome 还能自己建
    }
    fs.mkdirSync(profileDir, { recursive: true });

    spawn(
      browser,
      [
        `--app=${url}`,
        '--window-size=1400,920',
        `--user-data-dir=${profileDir}`,
        // 关掉「Chrome 是否要设为默认浏览器」的弹窗 —— 在 --app= 模式下那种弹窗
        // 会把用户唯一的视觉焦点挡住，体验极差
        '--no-default-browser-check',
        // 关掉「上次的 Chrome 崩溃了，要恢复吗」的提示条，避免窗口一片空白
        '--disable-session-crashed-bubble',
      ],
      {
        // detached + unref：浏览器独立于本进程，关掉服务不会连带把它杀掉，
        // 用户仍能看到页面上的「无法连接」提示，而不是窗口凭空消失。
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }
    ).unref();
    return { mode: 'app', browser };
  }

  return openInBrowser(url);
}

/**
 * 交给系统默认浏览器打开（普通标签页）。
 *
 * 用途是「预览站点」这类要跳出后台的跳转：应用窗口没有标签页，
 * 直接跳过去会把后台页面顶掉，用户还得按后退才能回来。
 * Windows 下 `start` 的第一个参数是窗口标题，必须传一个空串占位，
 * 否则带引号的 URL 会被当成标题吃掉。
 */
function openInBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  return { mode: 'tab', browser: null };
}

module.exports = { openAsApp, openInBrowser, findBrowser };
