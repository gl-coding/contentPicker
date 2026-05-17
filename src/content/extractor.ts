import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ExtractedContent, ExtractedBlock, MarkdownPayload, SiteTemplate } from '../types/content';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

turndownService.use(gfm);

function extractCodeText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (clone.innerText || clone.textContent || '').replace(/^\n+|\n+$/g, '');
}

turndownService.addRule('codeBlockWrapper', {
  filter: (node) => {
    if (node.nodeName !== 'DIV') return false;
    const el = node as HTMLElement;
    const children = Array.from(el.children);
    if (children.length < 2 || children.length > 4) return false;
    const hasPre = children.some((c) => c.tagName === 'PRE' || c.querySelector(':scope > pre'));
    if (!hasPre) return false;
    const hasNonPreChild = children.some((c) => c.tagName !== 'PRE' && !c.querySelector('pre'));
    return hasNonPreChild;
  },
  replacement(_content, node) {
    const el = node as HTMLElement;
    const pre = Array.from(el.children).find((c) => c.tagName === 'PRE' || c.querySelector('pre'));
    const preEl = pre?.tagName === 'PRE' ? pre : pre?.querySelector('pre');
    if (!preEl) return _content;
    const code = preEl.querySelector('code') as HTMLElement;
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
    const text = extractCodeText((code || preEl) as HTMLElement);
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
  },
});

turndownService.addRule('preformatted', {
  filter: (node) => node.nodeName === 'PRE',
  replacement(_content, node) {
    const el = node as HTMLElement;
    const code = el.querySelector('code') as HTMLElement;
    const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
    const text = extractCodeText(code || el);
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
  },
});

function extractMetadata(): ExtractedContent['metadata'] {
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? document.title;
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ??
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    '';
  const author =
    document.querySelector('meta[name="author"]')?.getAttribute('content') ??
    document.querySelector('meta[property="article:author"]')?.getAttribute('content') ??
    undefined;
  const publishedAt =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
    document.querySelector('time[datetime]')?.getAttribute('datetime') ??
    undefined;

  return {
    title,
    url: location.href,
    author,
    publishedAt,
    description,
  };
}

function mapNodeToBlock(node: Element): ExtractedBlock | null {
  const tag = node.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    return {
      type: 'heading',
      level: Number(tag.charAt(1)),
      content: node.textContent?.trim() ?? '',
    };
  }

  if (tag === 'p') {
    return {
      type: 'paragraph',
      content: node.textContent?.trim() ?? '',
    };
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.querySelectorAll('li')).map((li) => li.textContent?.trim() ?? '');
    return {
      type: 'list',
      content: items.join('\n'),
    };
  }

  if (tag === 'blockquote') {
    return {
      type: 'quote',
      content: node.textContent?.trim() ?? '',
    };
  }

  if (tag === 'pre') {
    const code = node.querySelector('code');
    return {
      type: 'code',
      content: code?.textContent ?? node.textContent ?? '',
      language: code?.className.replace('language-', '') ?? undefined,
    };
  }

  if (tag === 'img') {
    const img = node as HTMLImageElement;
    if (!img.src) return null;
    return {
      type: 'image',
      content: '',
      src: img.src,
      alt: img.alt,
    };
  }

  if (tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children)
        .map((cell) => cell.textContent?.trim() ?? '')
        .join(' | '),
    );
    return {
      type: 'table',
      content: rows.join('\n'),
    };
  }

  if (tag === 'a') {
    const anchor = node as HTMLAnchorElement;
    const href = anchor.href;
    if (!href || href.startsWith('javascript:') || href === '#') return null;
    const text = anchor.textContent?.trim() ?? '';
    if (!text) return null;
    return {
      type: 'link',
      content: text,
      href,
    };
  }

  return null;
}

// ===== 模版驱动的提取 =====

const NOISE_SELECTORS = 'script, style, noscript, iframe, svg';

function removeNestedElements(elements: Element[]): Element[] {
  const result: Element[] = [];
  for (const el of elements) {
    const isNested = elements.some((other) => other !== el && other.contains(el));
    if (!isNested) result.push(el);
  }
  return result;
}

function findAllContentRoots(template: SiteTemplate): Element[] {
  const set = new Set<Element>();
  for (const sel of template.contentSelectors) {
    try { document.querySelectorAll(sel).forEach((el) => set.add(el)); } catch { /* skip invalid */ }
  }
  if (set.size === 0) return [document.body];

  const deduped = removeNestedElements(Array.from(set));

  return deduped.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function cleanElement(el: Element, template: SiteTemplate): Element {
  const clone = el.cloneNode(true) as Element;
  if (template.excludeSelectors.length) {
    const combined = template.excludeSelectors.join(', ');
    try { clone.querySelectorAll(combined).forEach((n) => n.remove()); } catch { /* invalid selector */ }
  }
  clone.querySelectorAll(NOISE_SELECTORS).forEach((n) => n.remove());
  return clone;
}

function extractBlocks(template: SiteTemplate): ExtractedBlock[] {
  const roots = findAllContentRoots(template);
  const blocks: ExtractedBlock[] = [];

  for (const root of roots) {
    const nodes = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, img, table, a[href]');
    if (nodes.length > 0) {
      nodes.forEach((node) => {
        const block = mapNodeToBlock(node);
        if (block && block.content !== '') blocks.push(block);
      });
    } else {
      const text = root.textContent?.trim();
      if (text) blocks.push({ type: 'paragraph', content: text });
    }
  }

  return blocks;
}

// ===== 模版加载 =====

let cachedTemplate: SiteTemplate | null | undefined;

export function loadTemplate(): SiteTemplate | null {
  if (cachedTemplate !== undefined) return cachedTemplate;
  return null;
}

export function setTemplate(tpl: SiteTemplate | null) {
  cachedTemplate = tpl;
}

function migrateTemplate(raw: Record<string, unknown>): SiteTemplate {
  const tpl = raw as SiteTemplate & { contentSelector?: string };
  if (!tpl.contentSelectors && tpl.contentSelector) {
    tpl.contentSelectors = [tpl.contentSelector];
    delete tpl.contentSelector;
  }
  if (!Array.isArray(tpl.contentSelectors)) {
    tpl.contentSelectors = [];
  }
  return tpl;
}

export function initTemplateFromStorage(): Promise<void> {
  return new Promise((resolve) => {
    const domain = location.hostname;
    chrome.storage.local.get('siteTemplates', (result) => {
      const templates: Record<string, Record<string, unknown>> = result.siteTemplates ?? {};
      const raw = templates[domain];
      cachedTemplate = raw ? migrateTemplate(raw) : null;
      if (cachedTemplate) {
        console.info(`[ContentPicker] 已加载站点模版: ${domain}`);
      }
      resolve();
    });
  });
}

// ===== 滚动采集（应对虚拟滚动） =====

function findScrollParent(el: Element): Element {
  let current: Element | null = el.parentElement;
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    const overflow = style.overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight + 50) {
      return current;
    }
    current = current.parentElement;
  }
  return document.documentElement;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function contentFingerprint(el: Element): string {
  const text = el.textContent?.trim() ?? '';
  if (text.length <= 300) return text;
  return text.slice(0, 150) + '||' + text.slice(-150);
}

function findVisibleRoots(template: SiteTemplate, scrollEl: Element): Element[] {
  const all: Element[] = [];
  for (const sel of template.contentSelectors) {
    try { document.querySelectorAll(sel).forEach((el) => all.push(el)); } catch { /* skip */ }
  }
  if (all.length === 0) return [];

  const deduped = removeNestedElements(all);

  const containerRect = scrollEl === document.documentElement
    ? { top: 0, bottom: window.innerHeight }
    : scrollEl.getBoundingClientRect();

  const buffer = containerRect.bottom - containerRect.top;
  const visTop = containerRect.top - buffer * 0.3;
  const visBot = containerRect.bottom + buffer * 0.3;

  return deduped
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > visTop && r.top < visBot && r.height > 0;
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

async function scrollToForceRender(scrollEl: Element): Promise<void> {
  const step = Math.max(scrollEl.clientHeight, 400);
  const maxIter = Math.ceil(scrollEl.scrollHeight / step) + 5;
  let stableCount = 0;

  scrollEl.scrollTop = 0;
  await wait(300);

  for (let i = 0; i < maxIter; i++) {
    const prevTop = scrollEl.scrollTop;
    scrollEl.scrollTop += step;
    await wait(80);

    if (Math.abs(scrollEl.scrollTop - prevTop) < 2) {
      stableCount++;
      if (stableCount >= 2) break;
      await wait(100);
      continue;
    }
    stableCount = 0;
  }
}

function queryAllRootsByVisualOrder(template: SiteTemplate): Element[] {
  const set = new Set<Element>();
  for (const sel of template.contentSelectors) {
    try { document.querySelectorAll(sel).forEach((el) => set.add(el)); } catch { /* skip */ }
  }
  const deduped = removeNestedElements(Array.from(set));
  return deduped.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top;
  });
}

async function scrollAndCollect(template: SiteTemplate): Promise<string[]> {
  const firstEl = queryAllRootsByVisualOrder(template)[0];
  if (!firstEl) return [];

  const scrollEl = findScrollParent(firstEl);
  const isLongContent = scrollEl !== document.documentElement && scrollEl.scrollHeight > scrollEl.clientHeight * 2;
  if (!isLongContent) return [];

  const originalTop = scrollEl.scrollTop;
  const step = Math.max(scrollEl.clientHeight * 0.5, 300);
  const collectedOrder: string[] = [];
  const seenFp = new Set<string>();

  function captureCurrentVisible() {
    const roots = findVisibleRoots(template, scrollEl);
    for (const root of roots) {
      const fp = contentFingerprint(root);
      if (fp && !seenFp.has(fp)) {
        seenFp.add(fp);
        const clean = cleanElement(root, template);
        const md = turndownService.turndown(clean.innerHTML).trim();
        if (md) collectedOrder.push(md);
      }
    }
  }

  scrollEl.scrollTop = 0;
  await wait(400);
  captureCurrentVisible();

  const maxIter = Math.ceil(scrollEl.scrollHeight / step) + 10;
  let stableCount = 0;

  for (let i = 0; i < maxIter; i++) {
    const prevTop = scrollEl.scrollTop;
    scrollEl.scrollTop += step;
    await wait(120);

    if (Math.abs(scrollEl.scrollTop - prevTop) < 2) {
      stableCount++;
      if (stableCount >= 2) break;
      await wait(150);
      continue;
    }
    stableCount = 0;
    captureCurrentVisible();
  }

  captureCurrentVisible();
  console.info(`[ContentPicker] scroll collect: ${collectedOrder.length} items captured`);

  scrollEl.scrollTop = originalTop;
  return collectedOrder;
}

// ===== 入口 =====

export async function buildMarkdownPayload(includeFrontMatter = true): Promise<MarkdownPayload> {
  const template = loadTemplate();
  if (!template) {
    throw new Error('NO_TEMPLATE');
  }

  const metadata = extractMetadata();

  const scrollParts = await scrollAndCollect(template);

  let markdownBody: string;
  let blocks: ExtractedBlock[];

  if (scrollParts.length > 0) {
    markdownBody = scrollParts.join('\n\n---\n\n');
    blocks = extractBlocks(template);
  } else {
    const roots = findAllContentRoots(template);
    const parts = roots.map((root) => {
      const clean = cleanElement(root, template);
      return turndownService.turndown(clean.innerHTML).trim();
    }).filter(Boolean);
    markdownBody = parts.join('\n\n---\n\n');
    blocks = extractBlocks(template);
  }

  let markdownOutput = markdownBody;

  if (includeFrontMatter) {
    const frontMatter = ['---',
      `title: "${metadata.title}"`,
      `url: "${metadata.url}"`,
      metadata.author ? `author: "${metadata.author}"` : undefined,
      metadata.publishedAt ? `publishedAt: "${metadata.publishedAt}"` : undefined,
      metadata.description ? `description: "${metadata.description}"` : undefined,
      `template: "${template.domain}"`,
      '---',
      '',
    ]
      .filter(Boolean)
      .join('\n');
    markdownOutput = `${frontMatter}${markdownBody}`;
  }

  return {
    markdown: markdownOutput,
    raw: {
      metadata,
      blocks,
    },
  };
}

export async function dumpDebugInfo(): Promise<string> {
  const template = loadTemplate();
  const lines: string[] = [];

  lines.push('=== ContentPicker Debug ===');
  lines.push(`URL: ${location.href}`);
  lines.push(`Domain: ${location.hostname}`);
  lines.push(`Time: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('=== Template ===');
  if (template) {
    lines.push(JSON.stringify(template, null, 2));
  } else {
    lines.push('(no template)');
  }
  lines.push('');

  let scrollEl: Element | null = null;
  let isVirtualized = false;

  if (template) {
    const scrollRoot = findAllContentRoots(template)[0];
    if (scrollRoot && scrollRoot !== document.body) {
      let p: Element | null = scrollRoot.parentElement;
      while (p && p !== document.documentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 50) {
          scrollEl = p;
          isVirtualized = p.scrollHeight > p.clientHeight * 2;
          break;
        }
        p = p.parentElement;
      }
    }

    if (scrollEl && isVirtualized) {
      lines.push('=== Scroll Container ===');
      lines.push(`Tag: ${scrollEl.tagName}, class="${scrollEl.className.slice(0, 100)}"`);
      lines.push(`scrollHeight: ${scrollEl.scrollHeight}, clientHeight: ${scrollEl.clientHeight}`);
      lines.push(`isVirtualized: true`);
      lines.push('');

      lines.push('=== Scroll Capture (scrolling through page...) ===');
      const originalTop = scrollEl.scrollTop;
      const step = Math.max(scrollEl.clientHeight * 0.5, 200);
      let stepIdx = 0;

      scrollEl.scrollTop = 0;
      await wait(600);

      const maxIter = Math.ceil(scrollEl.scrollHeight / step) + 10;

      for (let i = 0; i <= maxIter; i++) {
        lines.push(`--- Step ${stepIdx} (scrollTop=${Math.round(scrollEl.scrollTop)}) ---`);
        for (const sel of template.contentSelectors) {
          let els: Element[] = [];
          try { els = Array.from(document.querySelectorAll(sel)); } catch { /* skip */ }
          const visible = els.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0;
          });
          lines.push(`  ${sel}  →  ${visible.length} visible / ${els.length} total`);
          visible.forEach((el, j) => {
            const rect = el.getBoundingClientRect();
            const text = (el.textContent ?? '').trim();
            const preview = text.length > 100 ? text.slice(0, 50) + '...' + text.slice(-50) : text;
            lines.push(`    [${j}] top=${Math.round(rect.top)} h=${Math.round(rect.height)} "${preview}"`);
          });
        }

        const prevTop = scrollEl.scrollTop;
        scrollEl.scrollTop += step;
        await wait(350);
        if (Math.abs(scrollEl.scrollTop - prevTop) < 2) break;
        stepIdx++;
      }

      scrollEl.scrollTop = originalTop;
      lines.push('');
    } else {
      lines.push('=== Matched Elements (no virtual scroll) ===');
      for (const sel of template.contentSelectors) {
        let els: Element[] = [];
        try { els = Array.from(document.querySelectorAll(sel)); } catch { /* skip */ }
        lines.push(`Selector: ${sel}  →  ${els.length} matches`);
        els.forEach((el, i) => {
          const rect = el.getBoundingClientRect();
          const text = (el.textContent ?? '').trim();
          const preview = text.length > 120 ? text.slice(0, 60) + ' ... ' + text.slice(-60) : text;
          lines.push(`  [${i}] tag=${el.tagName} top=${Math.round(rect.top)} h=${Math.round(rect.height)} text="${preview}"`);
        });
      }
      lines.push('');

      if (template.excludeSelectors.length > 0) {
        lines.push('=== Exclude Selectors ===');
        for (const sel of template.excludeSelectors) {
          let count = 0;
          try { count = document.querySelectorAll(sel).length; } catch { /* skip */ }
          lines.push(`${sel}  →  ${count} matches`);
        }
        lines.push('');
      }
    }
  }

  lines.push('=== Page Source (first 50000 chars) ===');
  lines.push(document.documentElement.outerHTML.slice(0, 50000));

  return lines.join('\n');
}

export function isDocumentReady(): boolean {
  return document.readyState === 'complete' || document.readyState === 'interactive';
}

if (isDocumentReady()) {
  console.info('[ContentPicker] content script ready');
} else {
  window.addEventListener('DOMContentLoaded', () => {
    console.info('[ContentPicker] content script ready after DOMContentLoaded');
  });
}
