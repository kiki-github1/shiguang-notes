/**
 * 主题初始化 —— 在 <head> 中同步执行，避免明暗切换时的闪白。
 * 读取优先级：localStorage 中的用户选择 > 服务端渲染的默认主题。
 */
(function () {
  try {
    var saved = window.localStorage.getItem('blog-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (err) {
    /* 隐私模式下 localStorage 不可用，忽略即可 */
  }
})();
