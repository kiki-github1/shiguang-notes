/**
 * 站点交互脚本。
 * 全部逻辑走外部文件，不依赖任何第三方库，也不使用内联脚本（配合 CSP）。
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------ 主题切换 ------------------------------ */
  function initTheme() {
    var toggle = $('#themeToggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { window.localStorage.setItem('blog-theme', next); } catch (err) { /* ignore */ }
    });
  }

  /* ------------------------------ 顶栏状态 ------------------------------ */
  function initHeader() {
    var header = $('#siteHeader');
    var toTop = $('#toTop');
    var bar = $('#progressBar');

    var onScroll = function () {
      var y = window.scrollY || document.documentElement.scrollTop;
      if (header) header.classList.toggle('is-scrolled', y > 8);
      if (toTop) toTop.classList.toggle('is-visible', y > 600);
      if (bar) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  /* ------------------------------ 移动端导航 ------------------------------ */
  function initNav() {
    var toggle = $('#navToggle');
    var nav = $('#primaryNav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ------------------------------- 搜索面板 ------------------------------- */
  function initSearch() {
    var toggle = $('#searchToggle');
    var panel = $('#searchPanel');
    if (!toggle || !panel) return;
    var input = $('#searchInput');

    var setOpen = function (open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open && input) {
        window.requestAnimationFrame(function () { input.focus(); });
      }
    };

    toggle.addEventListener('click', function () { setOpen(panel.hidden); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        toggle.focus();
        return;
      }
      // 输入框内不劫持按键
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setOpen(true);
      }
    });
  }

  /* -------------------------------- 轻提示 -------------------------------- */
  var toastTimer = null;
  function toast(message) {
    var el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    window.requestAnimationFrame(function () { el.classList.add('is-visible'); });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove('is-visible'); }, 2000);
  }

  /* ------------------------------- 分享按钮 ------------------------------- */
  function initShare() {
    $$('[data-share="copy"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var url = window.location.href;
        var done = function () { toast('链接已复制'); };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
        } else {
          fallbackCopy(url, done);
        }
      });
    });
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast('复制失败，请手动复制'); }
    document.body.removeChild(ta);
  }

  /* ------------------------------ 目录滚动高亮 ------------------------------ */
  function initToc() {
    var content = $('#articleContent');
    var toc = $('#toc');
    if (!content || !toc) return;

    var links = $$('a', toc);
    if (!links.length) return;

    var map = {};
    var headings = [];
    links.forEach(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var el = document.getElementById(id);
      if (!el) return;
      map[id] = link;
      headings.push(el);
    });
    if (!headings.length) return;

    var setActive = function (id) {
      links.forEach(function (l) { l.parentElement.classList.remove('is-active'); });
      var link = map[id];
      if (link) link.parentElement.classList.add('is-active');
    };

    var ticking = false;
    var update = function () {
      ticking = false;
      var threshold = 120;
      var current = headings[0];
      for (var i = 0; i < headings.length; i += 1) {
        if (headings[i].getBoundingClientRect().top <= threshold) current = headings[i];
        else break;
      }
      if (current) setActive(current.id);
    };

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });

    update();
  }

  /* -------------------------------- 图片缩放 -------------------------------- */
  function initImages() {
    var content = $('#articleContent');
    if (!content) return;
    $$('img', content).forEach(function (img) {
      img.addEventListener('click', function () {
        window.open(img.currentSrc || img.src, '_blank', 'noopener');
      });
      img.style.cursor = 'zoom-in';
    });
  }

  /* -------------------------------- 初始化 -------------------------------- */
  function boot() {
    initTheme();
    initHeader();
    initNav();
    initSearch();
    initShare();
    initToc();
    initImages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
