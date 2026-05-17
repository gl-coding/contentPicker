import type { SiteTemplate } from '../types/content';

const UNSAFE_CLASS_CHARS = /[()[\]{}@:/%,>~+!$^*=|\\]/;

function isValidClass(c: string): boolean {
  if (!c || c.startsWith('__cp_')) return false;
  if (/^[_a-f0-9]{6,}$/i.test(c)) return false;
  if (/^css-/.test(c)) return false;
  if (UNSAFE_CLASS_CHARS.test(c)) return false;
  return true;
}

function isSelectorValid(selector: string): boolean {
  try {
    document.querySelectorAll(selector);
    return true;
  } catch {
    return false;
  }
}

function generateSelector(el: Element): string {
  if (el.id && isSelectorValid(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  const tag = el.tagName.toLowerCase();
  const safeClasses = Array.from(el.classList).filter(isValidClass);

  if (safeClasses.length > 0) {
    const selector = `${tag}.${safeClasses.join('.')}`;
    if (isSelectorValid(selector)) return selector;
  }

  const dataAttrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith('data-') && a.value && a.value.length < 60)
    .slice(0, 2);
  if (dataAttrs.length > 0) {
    const selector = dataAttrs.map((a) => `${tag}[${a.name}="${CSS.escape(a.value)}"]`).join('');
    if (isSelectorValid(selector)) return selector;
  }

  const parent = el.parentElement;
  if (!parent || parent === document.body) return tag;

  const siblings = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
  if (siblings.length === 1) {
    return `${generateSelector(parent)} > ${tag}`;
  }
  const idx = siblings.indexOf(el) + 1;
  return `${generateSelector(parent)} > ${tag}:nth-of-type(${idx})`;
}

const PANEL_ID = '__cp_picker_panel__';

const CLS_HOVER = '__cp_highlight_hover';
const CLS_CONTENT = '__cp_highlight_content';
const CLS_EXCLUDE = '__cp_highlight_exclude';

let contentSelectors: Set<string> = new Set();
let excludeSelectors: Set<string> = new Set();
let hoverSelector: string | null = null;
let active = false;
let onSaveCallback: ((tpl: SiteTemplate | null) => void) | null = null;

function safeQueryAll(selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector)).filter(
      (el) => !el.closest(`#${PANEL_ID}`),
    );
  } catch { return []; }
}

function clearHighlight(cls: string) {
  document.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
}

function applyHighlight(selector: string, cls: string) {
  safeQueryAll(selector).forEach((el) => el.classList.add(cls));
}

function syncAllHighlights() {
  clearHighlight(CLS_CONTENT);
  clearHighlight(CLS_EXCLUDE);

  for (const sel of contentSelectors) applyHighlight(sel, CLS_CONTENT);
  for (const sel of excludeSelectors) applyHighlight(sel, CLS_EXCLUDE);
}

function countMatches(selector: string): number {
  return safeQueryAll(selector).length;
}

function injectStyles() {
  if (document.getElementById('__cp_picker_styles__')) return;
  const style = document.createElement('style');
  style.id = '__cp_picker_styles__';
  style.textContent = `
    .${CLS_HOVER} {
      outline: 2px dashed #3b82f6 !important;
      outline-offset: 2px !important;
      background: rgba(59,130,246,0.06) !important;
      cursor: crosshair !important;
    }
    .${CLS_CONTENT} {
      outline: 3px solid #10b981 !important;
      outline-offset: 2px !important;
      background: rgba(16,185,129,0.06) !important;
    }
    .${CLS_EXCLUDE} {
      outline: 3px solid #ef4444 !important;
      outline-offset: 2px !important;
      background: rgba(239,68,68,0.08) !important;
      opacity: 0.4 !important;
    }
    #${PANEL_ID} {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      width: 340px; max-height: 70vh; overflow-y: auto;
      background: #fff; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; color: #1e293b; line-height: 1.5;
    }
    #${PANEL_ID} * { box-sizing: border-box; margin: 0; padding: 0; }
    #${PANEL_ID} .cp-hd {
      padding: 14px 16px; border-bottom: 1px solid #e2e8f0;
      font-weight: 700; font-size: 14px;
      display: flex; justify-content: space-between; align-items: center;
    }
    #${PANEL_ID} .cp-bd { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
    #${PANEL_ID} .cp-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    #${PANEL_ID} .cp-sel {
      padding: 6px 10px; border-radius: 6px; font-size: 12px;
      font-family: 'SF Mono', Consolas, monospace; word-break: break-all;
    }
    #${PANEL_ID} .cp-sel-content { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    #${PANEL_ID} .cp-sel-exclude {
      background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
      display: flex; justify-content: space-between; align-items: center; margin-top: 4px;
    }
    #${PANEL_ID} .cp-sel-exclude button {
      background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px; padding: 0 4px; flex-shrink: 0;
    }
    #${PANEL_ID} .cp-count {
      font-size: 11px; font-weight: 600; color: #3b82f6; margin-left: 4px;
    }
    #${PANEL_ID} .cp-empty { color: #94a3b8; font-style: italic; font-size: 12px; }
    #${PANEL_ID} .cp-tip { font-size: 11px; color: #94a3b8; padding: 0 16px 8px; line-height: 1.6; }
    #${PANEL_ID} .cp-ft { padding: 12px 16px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; }
    #${PANEL_ID} .cp-btn {
      flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;
      font-size: 13px; font-weight: 600; cursor: pointer; text-align: center;
      transition: all 0.15s;
    }
    #${PANEL_ID} .cp-btn-save { background: #3b82f6; color: #fff; border-color: #3b82f6; }
    #${PANEL_ID} .cp-btn-save:hover { background: #2563eb; }
    #${PANEL_ID} .cp-btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
    #${PANEL_ID} .cp-btn-cancel { background: #fff; color: #64748b; }
    #${PANEL_ID} .cp-btn-cancel:hover { background: #f1f5f9; }
  `;
  document.head.appendChild(style);
}

function renderPanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    document.body.appendChild(panel);
  }

  const contentItems = Array.from(contentSelectors).map((sel) => ({
    selector: sel,
    count: countMatches(sel),
  }));
  const excludeItems = Array.from(excludeSelectors).map((sel) => ({
    selector: sel,
    count: countMatches(sel),
  }));

  panel.innerHTML = `
    <div class="cp-hd">
      <span>配置采集模版</span>
      <span style="font-size:11px;color:#94a3b8;font-weight:400">${location.hostname}</span>
    </div>
    <div class="cp-bd">
      <div>
        <div class="cp-label">内容区域（左键 / Ctrl+左键多选）</div>
        ${contentItems.length > 0
          ? contentItems.map((item, i) => `<div class="cp-sel cp-sel-content" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span>${item.selector}<span class="cp-count">×${item.count}</span></span><button data-rmc="${i}" title="移除" style="background:none;border:none;color:#10b981;cursor:pointer;font-size:14px;padding:0 4px;flex-shrink:0">✕</button></div>`).join('')
          : '<div class="cp-empty">点击页面中的主要内容区域</div>'}
      </div>
      <div>
        <div class="cp-label">排除区域（Shift+左键）</div>
        ${excludeItems.length > 0
          ? excludeItems.map((item, i) => `<div class="cp-sel cp-sel-exclude"><span>${item.selector}<span class="cp-count">×${item.count}</span></span><button data-rm="${i}" title="移除">✕</button></div>`).join('')
          : '<div class="cp-empty">Shift+点击排除不需要的部分</div>'}
      </div>
    </div>
    <div class="cp-tip">左键 = 替换内容区域 &nbsp; Ctrl+左键 = 追加内容区域<br>Shift+左键 = 排除元素 &nbsp; ESC = 取消</div>
    <div class="cp-ft">
      <button class="cp-btn cp-btn-cancel" id="__cp_cancel__">取消</button>
      <button class="cp-btn cp-btn-save" id="__cp_save__" ${contentSelectors.size === 0 ? 'disabled' : ''}>保存模版</button>
    </div>
  `;

  panel.querySelector('#__cp_cancel__')?.addEventListener('click', () => cleanup(null));
  panel.querySelector('#__cp_save__')?.addEventListener('click', handleSave);
  panel.querySelectorAll('[data-rmc]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number((e.currentTarget as HTMLElement).dataset.rmc);
      const arr = Array.from(contentSelectors);
      const sel = arr[idx];
      if (sel) { contentSelectors.delete(sel); syncAllHighlights(); renderPanel(); }
    });
  });
  panel.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number((e.currentTarget as HTMLElement).dataset.rm);
      const arr = Array.from(excludeSelectors);
      const sel = arr[idx];
      if (sel) { excludeSelectors.delete(sel); syncAllHighlights(); renderPanel(); }
    });
  });
}

function handleSave() {
  if (contentSelectors.size === 0) return;
  const tpl: SiteTemplate = {
    domain: location.hostname,
    name: document.title.slice(0, 50) || location.hostname,
    contentSelectors: Array.from(contentSelectors),
    excludeSelectors: Array.from(excludeSelectors),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  cleanup(tpl);
}

function onMouseMove(e: MouseEvent) {
  const panel = document.getElementById(PANEL_ID);
  if (panel?.contains(e.target as Node)) {
    clearHover();
    return;
  }

  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target || target === document.body || target === document.documentElement) return;
  updateHover(target as Element);
}

function clearHover() {
  if (hoverSelector) {
    clearHighlight(CLS_HOVER);
    hoverSelector = null;
  }
}

function updateHover(el: Element) {
  const panel = document.getElementById(PANEL_ID);
  if (panel?.contains(el)) return;

  const sel = generateSelector(el);
  if (sel === hoverSelector) return;

  clearHighlight(CLS_HOVER);
  hoverSelector = sel;

  safeQueryAll(sel).forEach((matched) => {
    if (!matched.classList.contains(CLS_CONTENT) && !matched.classList.contains(CLS_EXCLUDE)) {
      matched.classList.add(CLS_HOVER);
    }
  });
}

function onClick(e: MouseEvent) {
  const panel = document.getElementById(PANEL_ID);
  if (panel?.contains(e.target as Node)) return;

  e.preventDefault();
  e.stopPropagation();

  if (!hoverSelector) return;
  const sel = hoverSelector;

  clearHighlight(CLS_HOVER);
  hoverSelector = null;

  if (e.shiftKey) {
    if (excludeSelectors.has(sel)) {
      excludeSelectors.delete(sel);
    } else {
      excludeSelectors.add(sel);
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (contentSelectors.has(sel)) {
      contentSelectors.delete(sel);
    } else {
      contentSelectors.add(sel);
    }
  } else {
    contentSelectors.clear();
    contentSelectors.add(sel);
  }

  syncAllHighlights();
  renderPanel();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    cleanup(null);
  }
}

function cleanup(result: SiteTemplate | null) {
  active = false;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);

  clearHighlight(CLS_HOVER);
  clearHighlight(CLS_CONTENT);
  clearHighlight(CLS_EXCLUDE);

  hoverSelector = null;
  contentSelectors = new Set();
  excludeSelectors = new Set();

  document.getElementById(PANEL_ID)?.remove();
  document.getElementById('__cp_picker_styles__')?.remove();

  onSaveCallback?.(result);
  onSaveCallback = null;
}

export function startPicker(existingTemplate?: SiteTemplate | null): Promise<SiteTemplate | null> {
  if (active) return Promise.resolve(null);
  active = true;

  if (existingTemplate) {
    contentSelectors = new Set(existingTemplate.contentSelectors);
    excludeSelectors = new Set(existingTemplate.excludeSelectors);
  }

  return new Promise((resolve) => {
    onSaveCallback = resolve;

    injectStyles();
    syncAllHighlights();
    renderPanel();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

export function isPickerActive(): boolean {
  return active;
}
