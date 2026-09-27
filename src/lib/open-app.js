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

/**
 * 常见安装位置，按优先级排。允许用 ADMIN_BROWSER_PATH 手动指定。
 *
 * Edge 排在 Chrome 前面，是刻意的，不是随手写的顺序：
 *   1. 拿用户天天在用的 Chrome 去冒充一个窗口，它会把「设为默认浏览器」
 *      「登录同步」「新版功能」这些面向真人的推广一起带出来 —— 那些气泡
 *      在 --app= 这种没有地址栏的小窗里没有地方安放，只会糊在主内容上。
 *      Edge 是 Windows 自带的系统组件，不带这套推广逻辑
 *   2. 任务栏上 Edge 的图标与用户自己开的 Chrome 不一样，一眼能认出
 *      「这是我的写作后台」；用 Chrome 开则两个窗口图标相同，容易点错
 *
 * 两者都是 Chromium 内核，`--app=` 的表现与下面那些开关完全一致，
 * 换过去没有任何功能损失。机器上没装 Edge 时自动退回 Chrome。
 */
function browserCandidates() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';

  return [
    process.env.ADMIN_BROWSER_PATH,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : '',
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

/*
 * 每次启动用哪个目录当浏览器配置目录。
 * 放在临时目录里，与系统里真正在用的那份浏览器配置彻底隔开。
 */
function profileDirPath() {
  return path.join(os.tmpdir(), 'shiguang-admin-profile');
}

/*
 * 把配置目录铺成一份「已经用过很久」的样子。
 *
 * 这一步是必要的，不是锦上添花：目录每次都是全新的，而浏览器见到空目录
 * 就会当自己是「刚装好」，走完整套首次运行流程 —— 欢迎页、要不要设成默认
 * 浏览器、要不要登录同步、新版功能介绍，一条接一条往外弹。在 --app= 那种
 * 没有地址栏的小窗里，这些气泡没有地方安放，只会糊在主内容上。
 *
 * 所以这里先替它把答案写好：这些我都选过了，别再问。
 *
 *   1. `First Run` 空文件 —— 浏览器用它在磁盘上标记「首次运行已完成」，
 *      存在就跳过一整条首次运行分支（历史上就靠这个文件，至今仍生效）
 *   2. `Default/Preferences` —— profile 级开关。其中 `profile.exit_type`
 *      与 `exited_cleanly` 两条是「上次没有正确关闭，要恢复吗」那根提示条
 *      的判断依据；`signin.allowed = false` 掐掉登录气泡；`sync.suppress_start`
 *      掐掉同步引导；`whats_new.last_version` 给到天上，让「新版介绍」永远
 *      认为已经看过了
 *   3. `Local State` —— 进程级状态，同样写 exited_cleanly 兜住崩溃判断
 *
 * 字段写多了没有坏处：浏览器忽略不认识的键。写少了才会漏掉某一条弹窗。
 */
function prepareProfile(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 清不掉的旧目录不影响这次启动，浏览器还能自己建
  }
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'First Run'), '');

  fs.writeFileSync(
    path.join(dir, 'Default', 'Preferences'),
    JSON.stringify({
      browser: {
        check_default_browser: false,
        has_seen_welcome_page: true,
        first_run_tabs_migrated: true,
        show_home_button: false,
        confirm_to_quit: false,
      },
      // 一关同步，那条「登录以同步书签」的气泡就再也没有理由出现
      signin: { allowed: false, allowed_on_next_startup: false },
      sync: { suppress_start: true, has_setup_completed: true },
      // 4 = 启动时开空白新标签页，不要恢复上次会话
      session: { restore_on_startup: 4 },
      // 「上次没有正常退出」就看这两个键
      profile: { exit_type: 'Normal', exited_cleanly: true },
      user_education: { test_screen_views: [] },
      in_product_help: { snoozed_feature_badges: [], snoozed_iphs: [] },
      whats_new: { last_version: '999.0.0.0' },
      distribution: { suppress_first_run_bubble: true, suppress_welcome_page: true },
      default_apps: { installed_by_default_apps_cleaner: true },
      extensions: { settings: {} },
    })
  );

  fs.writeFileSync(
    path.join(dir, 'Local State'),
    JSON.stringify({
      browser: { first_run_finished: true, enabled_labs_experiments: [] },
      user_experience_metrics: {
        reporting_enabled: false,
        stability: { exited_cleanly: true },
      },
    })
  );
}

/** 打开 url。返回 { mode: 'app' | 'tab', browser }，供启动日志说明用了哪条路径 */
function openAsApp(url) {
  // 兜底开关：ADMIN_APP_MODE=tab 时直接用系统默认浏览器开普通标签页。
  // 万一哪台机器上的浏览器怎么都拦不住弹窗，这是个一劳永逸的退路。
  if (process.env.ADMIN_APP_MODE === 'tab') return openInBrowser(url);

  const browser = findBrowser();

  if (browser) {
    /*
     * 用一个固定的临时目录当配置目录，每次启动先清空再重建。
     *
     * 复用默认配置目录会踩两个坑：
     *   1. 上一次 --app= 会话没退干净（崩溃 / 任务管理器强杀），下一次启动
     *      会卡在「Profile is in use by another process」之类的恢复流程，
     *      新窗口就此一片空白、连 X 都按不动 —— 用户报告的就是这种状态
     *   2. 默认配置里累积的扩展、cookie 与磁盘缓存也会拖慢首屏
     * 本地写作后台不需要保留任何状态（无登录、无扩展、无 cookie），每次给一个
     * 干净的反倒最稳。清空带来的副作用（每次都被当成首次运行）由 prepareProfile
     * 兜住。
     *
     * 同步操作：服务进程就在这里停一下，相比异步 race 来说反而更确定。
     */
    const profileDir = profileDirPath();
    prepareProfile(profileDir);

    spawn(
      browser,
      [
        `--app=${url}`,
        '--window-size=1400,920',
        `--user-data-dir=${profileDir}`,
        // 跳过首次运行流程（与预置的 First Run 标记是两道保险）
        '--no-first-run',
        // 别问「要不要把它设为默认浏览器」
        '--no-default-browser-check',
        // 关掉同步，也就没有登录引导；关掉翻译 / 新版介绍 / 登录推广等一串气泡
        '--disable-sync',
        '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,ChromeWhatsNewUI,ChromeTipsInMainMenu,SignInPromo,SigninPromo,InterestFeedContentSuggestions,PrivacySandboxSettings4',
        // 关掉「上次崩溃了，要恢复吗」的提示条，避免窗口一片空白
        '--disable-session-crashed-bubble',
        // 欧盟 DMA 的搜索引擎选择屏。国内不会触发，加上无害
        '--disable-search-engine-choice-screen',
        // 新配置冷启动时后台联网与组件更新也会拖慢首屏，一并关掉
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--disable-client-side-phishing-detection',
        '--disable-breakpad',
        '--disable-default-apps',
        '--no-pings',
        '--metrics-recording-only',
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
