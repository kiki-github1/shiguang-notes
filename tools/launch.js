'use strict';

/**
 * 双击 start-admin.bat 之后真正的入口。
 *
 * 为什么逻辑写在 Node 里而不是 bat 里：
 * cmd 在 UTF-8 代码页下解析 bat 的 `rem` 注释时，会把中文标点切断，
 * 后半段直接拿去当命令执行 —— 满屏 "is not recognized as an internal or
 * external command"，脚本却还在往下跑。`echo` 的中文没事，`rem` 的中文会炸。
 *
 * 所以 bat 里只留几行不含中文的骨架，所有需要说明的东西搬到这里来。
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHORTCUT_NAME = '拾光笔记 写作后台.lnk';

/**
 * 首次运行时在桌面放一个带图标的启动图标，已存在则跳过。
 *
 * Windows 的快捷方式（.lnk）是个 COM 对象，命令行里没有别的办法生成它，
 * 只能借 PowerShell 这一趟。
 */
function ensureDesktopShortcut() {
  if (process.env.SKIP_SHORTCUT === '1') return;

  const icon = path.join(ROOT, 'assets', 'app', 'icon.ico');
  const script = [
    "$d = [Environment]::GetFolderPath('Desktop')",
    `$p = Join-Path $d '${SHORTCUT_NAME}'`,
    'if (Test-Path $p) { exit 0 }',
    '$w = New-Object -ComObject WScript.Shell',
    '$s = $w.CreateShortcut($p)',
    `$s.TargetPath = '${path.join(ROOT, 'start-admin.bat')}'`,
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

require(path.join(ROOT, 'server.js'));
