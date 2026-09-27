'use strict';

/*
 * 后台管理交互脚本。
 * 全部放在外部文件里 —— 站点 CSP 是 `script-src 'self'`，不允许任何内联脚本。
 */

/* --------------------------------- 公共 --------------------------------- */

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
    setState('已保存');
    toast('已保存到本地文件', 'ok');
    return data;
  }

  async function saveAndPublish() {
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

document.addEventListener('DOMContentLoaded', () => {
  initList();
  initEditor();
});
