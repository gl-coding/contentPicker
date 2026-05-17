import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ExtractedContent, ExtractedBlock, MarkdownPayload, SiteTemplate } from '../types/content';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

turndownService.use(gfm);

turndownService.addRule('preformatted', {
  filter: ['pre'],
  replacement(content) {
    return `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
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

function findAllContentRoots(template: SiteTemplate): Element[] {
  try {
    const els = Array.from(document.querySelectorAll(template.contentSelector));
    return els.length > 0 ? els : [document.body];
  } catch {
    return [document.body];
  }
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

export function initTemplateFromStorage(): Promise<void> {
  return new Promise((resolve) => {
    const domain = location.hostname;
    chrome.storage.local.get('siteTemplates', (result) => {
      const templates: Record<string, SiteTemplate> = result.siteTemplates ?? {};
      cachedTemplate = templates[domain] ?? null;
      if (cachedTemplate) {
        console.info(`[ContentPicker] 已加载站点模版: ${domain}`);
      }
      resolve();
    });
  });
}

// ===== 入口 =====

export function buildMarkdownPayload(): MarkdownPayload {
  const template = loadTemplate();
  if (!template) {
    throw new Error('NO_TEMPLATE');
  }

  const metadata = extractMetadata();
  const roots = findAllContentRoots(template);
  const markdownParts = roots.map((root) => {
    const clean = cleanElement(root, template);
    return turndownService.turndown(clean.innerHTML).trim();
  }).filter(Boolean);
  const markdownBody = markdownParts.join('\n\n---\n\n');
  const blocks = extractBlocks(template);

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

  return {
    markdown: `${frontMatter}${markdownBody}`,
    raw: {
      metadata,
      blocks,
    },
  };
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
