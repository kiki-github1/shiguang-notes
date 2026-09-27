'use strict';

/*
 * 后台管理交互脚本。
 * 全部放在外部文件里 —— 站点 CSP 是 `script-src 'self'`，不允许任何内联脚本。
 */

/* --------------------------------- 公共 --------------------------------- */

/** 跨模块共享的一点状态：编辑器里是否有未保存的改动（退出前要问一句） */
const appState = { dirty: false };

const toastEl = document.getElementById('toast');
let toastTimer = null;

function toast(message, kind) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast${kind ? ` toast--${kind}` : ''}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3800);
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({ ok: false, message: '响应解析失败' }));
  return { status: res.status, data };
}

/** 发布流程共用：调接口并把结果翻译成用户能看懂的话 */
async function runPublish(message) {
  const { data } = await postJSON('/admin/api/publish', { message });

  if (data.ok) {
    return { ok: true, text: '已推送到 GitHub，网站正在自动重新部署（约 1–3 分钟）' };
  }
  if (data.reason === 'NOTHING_TO_COMMIT') {
    return { ok: true, text: '内容没有变化，无需发布' };
  }
  // 服务端会把 git 的原始报错翻译成人话放在 hint 里，优先用它
  return { ok: false, text: data.hint || data.message || '发布失败' };
}

/* -------------------------------- 列表页 -------------------------------- */

function initList() {
  const statusEl = document.getElementById('git-status');

  async function refreshStatus() {
    if (!statusEl) return;
    try {
      const res = await fetch('/admin/api/status');
      const d = await res.json();
      if (!d.ok) {
        statusEl.textContent = '仓库状态读取失败';
        statusEl.className = 'admin-git is-error';
        return;
      }
      if (d.changed === 0 && d.ahead === 0) {
        statusEl.textContent = '已与线上同步';
        statusEl.className = 'admin-git is-ok';
      } else {
        statusEl.textContent = `${d.changed} 处改动待发布`;
        statusEl.className = 'admin-git is-dirty';
      }
    } catch {
      statusEl.textContent = '仓库状态读取失败';
      statusEl.className = 'admin-git is-error';
    }
  }

  refreshStatus();

  const publishBtn = document.getElementById('btn-publish-all');
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      publishBtn.disabled = true;
      const original = publishBtn.textContent;
      publishBtn.textContent = '发布中…';
      const result = await runPublish('post: 更新文章');
      toast(result.text, result.ok ? 'ok' : 'error');
      publishBtn.textContent = original;
      publishBtn.disabled = false;
      refreshStatus();
    });
  }

  /*
   * 「预览站点」交给服务端唤起系统默认浏览器。
   * 后台自身跑在应用窗口（--app=）里，没有标签页 —— 直接跳过去会把后台顶掉。
   */
  const viewSiteBtn = document.getElementById('btn-view-site');
  if (viewSiteBtn) {
    viewSiteBtn.addEventListener('click', async () => {
      const { data } = await postJSON('/admin/api/open-site', {});
      if (!data.ok) {
        toast(`没能唤起浏览器，请手动访问 ${window.location.origin}`, 'error');
      }
    });
  }

  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { delete: slug, title } = btn.dataset;
      const confirmed = window.confirm(
        `确定删除《${title}》？\n\n文件会从磁盘移除。删除后记得点「发布到线上」同步，若想反悔也可以用 git 找回。`
      );
      if (!confirmed) return;

      btn.disabled = true;
      const { data } = await postJSON('/admin/api/delete', { slug });
      if (data.ok) {
        const row = btn.closest('tr');
        if (row) row.remove();
        toast('已删除。记得点「发布到线上」同步。', 'ok');
        refreshStatus();
      } else {
        btn.disabled = false;
        toast(data.message || '删除失败', 'error');
      }
    });
  });
}

/* -------------------------------- 编辑页 -------------------------------- */

function initEditor() {
  const root = document.querySelector('.admin-main--editor');
  if (!root) return;

  const mode = root.dataset.mode;
  const el = {
    title: document.getElementById('f-title'),
    slug: document.getElementById('f-slug'),
    date: document.getElementById('f-date'),
    category: document.getElementById('f-category'),
    tags: document.getElementById('f-tags'),
    summary: document.getElementById('f-summary'),
    draft: document.getElementById('f-draft'),
    pinned: document.getElementById('f-pinned'),
    featured: document.getElementById('f-featured'),
    template: document.getElementById('f-template'),
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    saveState: document.getElementById('save-state'),
  };

  let dirty = false;

  function setState(text, kind) {
    if (!el.saveState) return;
    el.saveState.textContent = text;
    el.saveState.className = `admin-git${kind ? ` is-${kind}` : ''}`;
  }

  function markDirty() {
    dirty = true;
    appState.dirty = true;
    setState('未保存', 'dirty');
  }

  /* ---------------------------- 实时预览 ---------------------------- */

  let previewTimer = null;

  // 交给服务端渲染：与最终页面用的是同一套 markdown-it 配置，
  // 预览看到什么，发布后就是什么。
  async function renderPreview() {
    const { data } = await postJSON('/admin/api/preview', { content: el.editor.value });
    if (data.ok) el.preview.innerHTML = data.html;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 280);
  }

  /* ---------------------------- 正文插入 ---------------------------- */

  function insertText(text, { block = false } = {}) {
    const ta = el.editor;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);

    let payload = text;
    if (block && before && !before.endsWith('\n\n')) {
      payload = `${before.endsWith('\n') ? '\n' : '\n\n'}${text}`;
    }

    ta.value = `${before}${payload}${after}`;
    const caret = before.length + payload.length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    markDirty();
    schedulePreview();
  }

  el.editor.addEventListener('input', () => {
    markDirty();
    schedulePreview();
  });

  /* slug 只允许小写字母数字与连字符 —— 输入时就给反馈，别等到点保存才报错 */
  const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
  if (el.slug && !el.slug.readOnly) {
    el.slug.addEventListener('input', () => {
      const value = el.slug.value.trim();
      const invalid = value.length > 0 && !SLUG_PATTERN.test(value);
      el.slug.classList.toggle('is-invalid', invalid);
      el.slug.title = invalid ? '只能用小写字母、数字和连字符' : '';
    });
  }

  // Tab 插入两个空格而不是跳走焦点
  el.editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = el.editor;
    const start = ta.selectionStart;
    ta.value = `${ta.value.slice(0, start)}  ${ta.value.slice(ta.selectionEnd)}`;
    ta.setSelectionRange(start + 2, start + 2);
    markDirty();
  });

  /* ---------------------------- 图片上传 ---------------------------- */

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const MAX_SIZE = 8 * 1024 * 1024;

  async function uploadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('只能上传图片文件', 'error');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast(`图片超过 8 MB（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`, 'error');
      return;
    }

    const form = new FormData();
    form.append('image', file);

    dropZone.classList.add('is-busy');
    try {
      const res = await fetch('/admin/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.ok) {
        toast(data.message || '上传失败', 'error');
        return;
      }
      const alt = file.name.replace(/\.[^.]+$/, '');
      insertText(`![${alt}](${data.url})`, { block: true });
      toast('图片已上传并插入正文', 'ok');
    } catch (err) {
      toast(`上传失败：${err.message}`, 'error');
    } finally {
      dropZone.classList.remove('is-busy');
    }
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    uploadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-over');
    });
  });
  dropZone.addEventListener('drop', (e) => uploadFile(e.dataTransfer.files[0]));

  // 避免图片被拖到页面其他位置时浏览器直接打开它
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /* ---------------------------- 写作模板 ---------------------------- */

  /*
   * 模板内容放在服务端 content/templates/ 下，前端只负责「取回来、填进去」。
   * 因此想加一套新模板，丢一个 .md 进那个目录即可，不必碰这里的任何代码。
   */
  async function applyTemplate(name) {
    if (!name) return;

    const { data } = await postJSON('/admin/api/template', { name });
    if (!data.ok || !data.template) {
      toast(data.message || '模板读取失败', 'error');
      return;
    }

    const tpl = data.template;

    /*
     * 有的模板（比如生活随笔）只预设分类与标签、正文是空的。
     * 这种情况绝不能顺手把正文清掉 —— 那对用户来说是纯粹的破坏。
     */
    if (tpl.body) {
      // 覆盖正文不可撤销，正文非空时必须先问一句
      if (el.editor.value.trim()
        && !window.confirm(`正文里已经有内容，套用「${tpl.label}」会把它整段覆盖。\n\n确定继续？`)) {
        el.template.value = '';
        return;
      }
      el.editor.value = tpl.body;
    }

    // 分类与标签只在还没填时补上 —— 已有的输入是用户自己敲的，不该被模板顶掉
    if (tpl.category && !el.category.value.trim()) el.category.value = tpl.category;
    if (tpl.tags.length && !el.tags.value.trim()) el.tags.value = tpl.tags.join(', ');

    markDirty();
    schedulePreview();
    toast(`已套用模板：${tpl.label}`, 'ok');
  }

  if (el.template) {
    el.template.addEventListener('change', () => applyTemplate(el.template.value));
  }

  /* ---------------------------- 保存与发布 ---------------------------- */

  function collect() {
    return {
      slug: (el.slug.value || '').trim(),
      title: (el.title.value || '').trim(),
      date: (el.date.value || '').trim(),
      category: (el.category.value || '').trim(),
      tags: (el.tags.value || '').trim(),
      summary: (el.summary.value || '').trim(),
      draft: el.draft.checked,
      pinned: Boolean(el.pinned && el.pinned.checked),
      featured: Boolean(el.featured && el.featured.checked),
      content: el.editor.value,
    };
  }

  async function save() {
    const payload = collect();

    if (!payload.title) {
      toast('请先填写标题', 'error');
      el.title.focus();
      return null;
    }
    if (!payload.slug) {
      toast('请先填写 URL 标识（slug）', 'error');
      el.slug.focus();
      return null;
    }
    // 与后端的 SAFE_SLUG 保持一致，提前拦住，别等提交后才报错
    if (!SLUG_PATTERN.test(payload.slug)) {
      toast('URL 标识只能用小写字母、数字和连字符，例如 my-first-post', 'error');
      el.slug.focus();
      return null;
    }

    setState('保存中…');
    const { data } = await postJSON('/admin/api/save', payload);

    if (!data.ok) {
      setState('保存失败', 'error');
      toast(data.message || '保存失败', 'error');
      return null;
    }

    // 新建成功后立刻切到编辑态：否则再点一次保存会重复创建
    if (mode === 'create') {
      window.history.replaceState(null, '', `/admin/edit/${data.slug}`);
      root.dataset.mode = 'edit';
      el.slug.readOnly = true;
    }

    dirty = false;
    appState.dirty = false;
    setState('已保存');
    toast('已保存到本地文件', 'ok');
    return data;
  }

  async function saveAndPublish() {
    /*
     * 勾着「草稿」却点「保存并发布」是个高频误会：
     * 本地开发环境会照常显示草稿，线上却被整篇过滤掉，
     * 于是表现成「发布成功了，线上却找不到」，且毫无提示。
     * 与其让人对着线上页面反复刷新，不如在这里先问一句。
     */
    if (el.draft.checked
      && !window.confirm('这篇文章标着「草稿」，线上不会显示。\n\n仍要发布吗？')) {
      return;
    }

    const saved = await save();
    if (!saved) return;

    setState('发布中…');
    const result = await runPublish(`post: ${collect().title}`);
    setState(result.ok ? '已发布' : '发布失败', result.ok ? 'ok' : 'error');
    toast(result.text, result.ok ? 'ok' : 'error');
  }

  const saveBtn = document.getElementById('btn-save');
  const publishBtn = document.getElementById('btn-publish');
  if (saveBtn) saveBtn.addEventListener('click', save);
  if (publishBtn) publishBtn.addEventListener('click', saveAndPublish);

  // Ctrl/Cmd + S 保存，加 Shift 则保存并发布
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    if (e.shiftKey) saveAndPublish();
    else save();
  });

  // 窄屏下切换预览
  const previewBtn = document.getElementById('btn-preview');
  const panes = document.getElementById('panes');
  if (previewBtn && panes) {
    previewBtn.addEventListener('click', () => panes.classList.toggle('show-preview'));
  }

  // 有未保存改动时离开给个提示
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  renderPreview();
}

/* -------------------------------- 退出后台 -------------------------------- */

/*
 * 命令行窗口被藏起来之后，「退出后台」成了唯一正经的出口 ——
 * 没有它，用户只能去任务管理器里杀进程。
 *
 * 顺序上有意反过来：先把界面切到收尾页，再把请求发出去。
 * 服务器收到请求就准备退出了，连接必然会被掐断；若写成 await 之后再切界面，
 * 「退出成功」会表现成一句「请求失败」，反而让人以为没退掉。
 */
function showFarewell(lead) {
  const screen = document.getElementById('farewell');
  if (!screen) return;
  const leadEl = document.getElementById('farewell-lead');
  if (leadEl && lead) leadEl.textContent = lead;
  screen.hidden = false;
}

function initQuit() {
  const btn = document.getElementById('btn-quit');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const lines = ['退出后台？', '', '服务会停止，已经保存的文件不受影响。'];
    if (appState.dirty) {
      lines.push('', '⚠ 当前文章还有没保存的改动，退出后会丢失。');
    }
    if (!window.confirm(lines.join('\n'))) return;

    showFarewell(
      appState.dirty
        ? '服务已经停止。未保存的改动没有写入文件，其余内容都已保存。'
        : undefined
    );

    // 不 await：这个请求注定会被掐断，失败是预期内的
    postJSON('/admin/api/quit', {}).catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initList();
  initEditor();
  initQuit();
});
