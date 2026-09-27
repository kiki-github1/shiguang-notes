'use strict';

/**
 * 双击桌面图标之后真正的入口（由 tools/launch-hidden.vbs 以隐藏窗口方式调起）。
 *
 * 为什么逻辑写在 Node 里而不是 bat 里：
 * cmd 在 UTF-8 代码页下解析 bat 的 `rem` 注释时，会把中文标点切断，
 * 后半段直接拿去当命令执行 —— 满屏 "is not recognized as an internal or
 * external command"，脚本却还在往下跑。`echo` 的中文没事，`rem` 的中文会炸。
 *
 * 所以 bat 里只留几行不含中文的骨架，所有需要说明的东西搬到这里来。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHORTCUT_NAME = '拾光笔记 写作后台.lnk';
/** 桌面图标指向这个文件，而不是 start-admin.bat —— 它负责把黑框藏起来 */
const LAUNCHER = path.join(ROOT, 'tools', 'launch-hidden.vbs');

/**
 * 补几个常见的可执行文件目录到 PATH。
 *
 * 双击桌面图标启动时，进程继承的是 Explorer 的环境变量，而 Explorer 只在
 * 登录时读一次 PATH —— 装完 Node.js / Git 之后不重启资源管理器，PATH 里就
 * 一直看不到它们。表现是「终端里跑得好好的，双击图标就报找不到 node」。
 * 这里把几个标准安装位置补进去，让两条路径行为一致。
 *
 * 只补「确实存在且原本不在 PATH 里」的目录，不改动其余顺序。
 */
function repairPath() {
  const candidates = [
    path.dirname(process.execPath),
    'C:\\Program Files\\nodejs',
    // Git for Windows 两种装法：安装版放 cmd\，便携版放 mingw64\bin\
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files\\Git\\mingw64\\bin',
    'C:\\Program Files (x86)\\Git\\cmd',
    'C:\\Program Files (x86)\\Git\\mingw64\\bin',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd')
      : '',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'mingw64', 'bin')
      : '',
  ].filter(Boolean);

  const parts = (process.env.PATH || '').split(path.delimiter);
  const known = new Set(parts.map((p) => p.toLowerCase().replace(/\\+$/, '')));
  const missing = candidates.filter(
    (dir) => fs.existsSync(dir) && !known.has(dir.toLowerCase().replace(/\\+$/, ''))
  );

  if (missing.length) {
    process.env.PATH = missing.concat(parts).join(path.delimiter);
  }
}

repairPath();

/**
 * 在桌面放一个带图标的启动图标。
 *
 * Windows 的快捷方式（.lnk）是个 COM 对象，命令行里没有别的办法生成它，
 * 只能借 PowerShell 这一趟。
 *
 * ⚠️ 这里是**每次启动都重建**，不做「已存在就跳过」。
 * 早期版本跳过已存在的图标，结果目标从 start-admin.bat 改成 vbs 之后，
 * 老用户桌面上那个旧图标永远不会升级，双击还是弹出黑框 —— 修了等于没修。
 * 重建只会改写桌面上的那个 .lnk，不影响用户「固定到任务栏」的副本。
 *
 * 创建失败（策略限制、PowerShell 不可用）只是没有桌面图标，不该挡住启动。
 */
function ensureDesktopShortcut() {
  if (process.env.SKIP_SHORTCUT === '1') return;

  const icon = path.join(ROOT, 'assets', 'app', 'icon.ico');
  const script = [
    "$d = [Environment]::GetFolderPath('Desktop')",
    `$p = Join-Path $d '${SHORTCUT_NAME}'`,
    '$w = New-Object -ComObject WScript.Shell',
    '$s = $w.CreateShortcut($p)',
    `$s.TargetPath = '${LAUNCHER}'`,
    `$s.WorkingDirectory = '${ROOT}'`,
    `$s.IconLocation = '${icon},0'`,
    "$s.Description = '拾光笔记 本地写作后台'",
    '$s.Save()',
  ].join('; ');

  try {
    spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: 'ignore', windowsHide: true, timeout: 15000 }
    );
  } catch {
    // 桌面图标只是个便利，建不出来也不该挡住启动
  }
}

ensureDesktopShortcut();

// server.js 在 listen 回调里读这个变量，就绪后把后台窗口弹出来
process.env.ADMIN_APP = process.env.ADMIN_APP || '1';

// ADMIN_APP_MODE=tab 改成普通标签页模式（不开 --app= 独立窗口）。
// 兜底用：万一哪台机器上的浏览器怎么都拦不住气泡，把这一行临时启用即可。
if (process.env.ADMIN_APP_MODE === 'tab') {
  console.log('  · ADMIN_APP_MODE=tab 已开启，将以普通标签页模式打开后台');
}

require(path.join(ROOT, 'server.js'));
