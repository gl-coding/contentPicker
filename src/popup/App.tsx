import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import classNames from 'classnames';
import type { ExtractedBlock, MarkdownPayload, SiteTemplate } from '../types/content';

type TabKey = 'capture' | 'markdown' | 'preview' | 'settings';

type FetchResponse = {
  ok: boolean;
  data?: MarkdownPayload;
  error?: string;
};

const blockLabels: Record<ExtractedBlock['type'], string> = {
  heading: '标题',
  paragraph: '段落',
  list: '列表',
  quote: '引用',
  code: '代码',
  image: '图片',
  table: '表格',
  link: '链接',
};

const blockAccent: Record<ExtractedBlock['type'], string> = {
  heading: '#818cf8',
  paragraph: '#34d399',
  list: '#fbbf24',
  quote: '#f87171',
  code: '#60a5fa',
  image: '#f472b6',
  table: '#a78bfa',
  link: '#fb923c',
};

type ContentFilter = 'text' | 'image' | 'link';

const filterConfig: { key: ContentFilter; label: string; types: ExtractedBlock['type'][] }[] = [
  { key: 'text', label: '文本', types: ['heading', 'paragraph', 'list', 'quote', 'code', 'table'] },
  { key: 'image', label: '图片', types: ['image'] },
  { key: 'link', label: '链接', types: ['link'] },
];

function escapeHtml(rawStr: string): string {
  return rawStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const tabs: { key: TabKey; label: string; description: string }[] = [
  { key: 'capture', label: '采集', description: '查看采集的元信息与内容块' },
  { key: 'markdown', label: 'Markdown', description: '编辑和优化导出的 Markdown 文本' },
  { key: 'preview', label: '预览', description: '实时查看渲染后的 Markdown 样式' },
  { key: 'settings', label: '设置', description: '自定义主题、偏好与输出方式' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('capture');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [autoFetch, setAutoFetch] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MarkdownPayload | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<ContentFilter>>(new Set(['text', 'image', 'link']));
  const [templates, setTemplates] = useState<Record<string, SiteTemplate>>({});
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const [obsidianVault, setObsidianVault] = useState('');
  const [obsidianFolder, setObsidianFolder] = useState('');
  const [includeFrontMatter, setIncludeFrontMatter] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' }, (res) => {
      if (res?.ok && res.data) {
        const raw = res.data as Record<string, SiteTemplate & { contentSelector?: string }>;
        for (const tpl of Object.values(raw)) {
          if (!tpl.contentSelectors && tpl.contentSelector) {
            tpl.contentSelectors = [tpl.contentSelector];
            delete tpl.contentSelector;
          }
          if (!Array.isArray(tpl.contentSelectors)) tpl.contentSelectors = [];
        }
        setTemplates(raw as Record<string, SiteTemplate>);
      }
    });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.runtime.sendMessage({ type: 'GET_DOMAIN', tabId: tab.id }, (res) => {
          if (res?.ok && typeof res.data === 'string') setCurrentDomain(res.data);
        });
      }
    });
    chrome.storage.local.get(['obsidianVault', 'obsidianFolder', 'includeFrontMatter', 'autoFetch'], (result) => {
      if (result.obsidianVault) setObsidianVault(result.obsidianVault);
      if (result.obsidianFolder) setObsidianFolder(result.obsidianFolder);
      if (result.includeFrontMatter === false) setIncludeFrontMatter(false);
      if (result.autoFetch === false) setAutoFetch(false);
    });
  }, []);

  const hasTemplate = Boolean(currentDomain && templates[currentDomain]);

  const handleStartPicker = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.runtime.sendMessage({ type: 'START_PICKER', tabId: tab.id });
      window.close();
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const mdEngine = useMemo(() => {
    return new MarkdownIt({
      html: true,
      linkify: true,
      breaks: true,
      highlight(code: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            const highlighted = hljs.highlight(code, { language: lang }).value;
            return `<pre class="hljs"><code>${highlighted}</code></pre>`;
          } catch (err) {
            console.warn('highlight error', err);
          }
        }
        return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
      },
    });
  }, []);

  const renderedPreview = useMemo(() => {
    if (!markdown) return '';
    const rawHtml = mdEngine.render(markdown);
    return DOMPurify.sanitize(rawHtml);
  }, [markdown, mdEngine]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const handleDeleteTemplate = useCallback((domain: string) => {
    chrome.runtime.sendMessage({ type: 'DELETE_TEMPLATE', domain }, (res) => {
      if (res?.ok) {
        setTemplates((prev) => {
          const next = { ...prev };
          delete next[domain];
          return next;
        });
        showToast('模版已删除');
      }
    });
  }, [showToast]);

  const fetchContent = useCallback(() => {
    setLoading(true);
    setError(null);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabsResult) => {
      const targetTab = tabsResult[0];

      if (!targetTab?.id) {
        setLoading(false);
        setError('未找到活动标签页');
        return;
      }

      chrome.runtime.sendMessage({ type: 'FETCH_CONTENT', tabId: targetTab.id, includeFrontMatter }, (response: FetchResponse) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          setLoading(false);
          setError(runtimeError.message ?? '运行时错误');
          return;
        }

        if (!response?.ok || !response.data) {
          setLoading(false);
          setError(response?.error ?? '未能提取内容');
          return;
        }

        setPayload(response.data);
        setMarkdown(response.data.markdown);
        setLoading(false);
        setActiveTab('markdown');
      });
    });
  }, [includeFrontMatter]);

  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetch && hasTemplate && !payload && !loading && !autoFetchedRef.current) {
      autoFetchedRef.current = true;
      fetchContent();
    }
  }, [autoFetch, hasTemplate, payload, loading, fetchContent]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      showToast('Markdown 已复制');
    } catch (copyError) {
      console.error(copyError);
      showToast('复制失败，请手动选择文本');
    }
  }, [markdown, showToast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const filename = payload?.raw.metadata.title?.replace(/[^\w\u4e00-\u9fa5]+/g, '-') || 'content';

    anchor.href = url;
    anchor.download = `${filename}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('已下载 Markdown 文件');
  }, [markdown, payload, showToast]);

  const handleSaveToObsidian = useCallback(() => {
    if (!obsidianVault) {
      showToast('请先在设置中填写 Obsidian Vault 名称');
      setActiveTab('settings');
      return;
    }
    const filename = payload?.raw.metadata.title?.replace(/[^\w\u4e00-\u9fa5]+/g, '-') || 'content';
    const path = obsidianFolder ? `${obsidianFolder}/${filename}` : filename;
    const uri = `obsidian://new?vault=${encodeURIComponent(obsidianVault)}&file=${encodeURIComponent(path)}&content=${encodeURIComponent(markdown)}&overwrite`;
    window.open(uri);
    showToast('已发送到 Obsidian');
  }, [markdown, payload, obsidianVault, obsidianFolder, showToast]);

  const saveObsidianSettings = useCallback((vault: string, folder: string) => {
    setObsidianVault(vault);
    setObsidianFolder(folder);
    chrome.storage.local.set({ obsidianVault: vault, obsidianFolder: folder });
  }, []);

  const handleDumpDebug = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabsResult) => {
      const tab = tabsResult[0];
      if (!tab?.id) return;
      chrome.runtime.sendMessage({ type: 'DUMP_DEBUG', tabId: tab.id }, (res) => {
        if (res?.ok && typeof res.data === 'string') {
          const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `debug-${location.hostname}-${Date.now()}.txt`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('调试信息已导出');
        } else {
          showToast('导出失败');
        }
      });
    });
  }, [showToast]);

  const handleBlockCopy = useCallback((block: ExtractedBlock) => {
    const snippet = block.href || block.content || block.alt || block.src || '';
    if (!snippet) return;
    navigator.clipboard
      .writeText(snippet)
      .then(() => showToast(`${blockLabels[block.type]}内容已复制`))
      .catch(() => showToast('复制失败'));
  }, [showToast]);

  const toggleFilter = useCallback((key: ContentFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allowedTypes = useMemo(() => {
    const types = new Set<ExtractedBlock['type']>();
    for (const f of filterConfig) {
      if (filters.has(f.key)) f.types.forEach((t) => types.add(t));
    }
    return types;
  }, [filters]);

  const filteredBlocks = useMemo(() => {
    if (!payload) return [];
    return payload.raw.blocks.filter((b) => allowedTypes.has(b.type));
  }, [payload, allowedTypes]);

  const hasContent = Boolean(payload && filteredBlocks.length > 0);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Content Picker</p>
          <h1>Markdown 内容采集助手</h1>
          <p className="subtitle">一键提取网页内容，智能整理并导出 Markdown</p>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={handleStartPicker}>
            {hasTemplate ? '编辑模版' : '配置模版'}
          </button>
          <button className="btn primary" onClick={hasTemplate ? fetchContent : handleStartPicker} disabled={loading}>
            {loading ? '采集中…' : !hasTemplate ? '先配置模版' : payload ? '重新采集' : '立即采集'}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={classNames('tab-item', { active: activeTab === tab.key })}
            onClick={() => setActiveTab(tab.key)}
          >
            <span>{tab.label}</span>
            <small>{tab.description}</small>
          </button>
        ))}
      </nav>

      {error && <div className="banner error">⚠️ {error}</div>}

      {activeTab === 'capture' && (
        <section className="panel">
          <div className="filter-bar">
            {filterConfig.map((f) => (
              <label key={f.key} className={classNames('filter-chip', { active: filters.has(f.key) })}>
                <input
                  type="checkbox"
                  checked={filters.has(f.key)}
                  onChange={() => toggleFilter(f.key)}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>

          {!hasContent && !loading && !hasTemplate && (
            <div className="empty-state">
              <p>当前站点尚未配置模版</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>请先点击右上角「配置模版」，在页面上选择要采集的内容区域</p>
              <button className="btn" style={{ marginTop: 12 }} onClick={handleStartPicker}>配置模版</button>
            </div>
          )}
          {!hasContent && !loading && hasTemplate && <div className="empty-state">模版已就绪，点击右上角按钮开始采集</div>}

          {loading && (
            <div className="skeleton-grid">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          )}

          {hasContent && payload && (
            <div className="card-grid">
              <article className="card">
                <div className="card-header">
                  <h3>页面元信息</h3>
                  <span className="status-badge success">已提取</span>
                </div>
                <dl className="meta-list">
                  <div>
                    <dt>标题</dt>
                    <dd>{payload.raw.metadata.title}</dd>
                  </div>
                  <div>
                    <dt>地址</dt>
                    <dd className="truncate">{payload.raw.metadata.url}</dd>
                  </div>
                  {payload.raw.metadata.author && (
                    <div>
                      <dt>作者</dt>
                      <dd>{payload.raw.metadata.author}</dd>
                    </div>
                  )}
                  {payload.raw.metadata.publishedAt && (
                    <div>
                      <dt>发布时间</dt>
                      <dd>{new Date(payload.raw.metadata.publishedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {payload.raw.metadata.description && (
                    <div>
                      <dt>摘要</dt>
                      <dd>{payload.raw.metadata.description}</dd>
                    </div>
                  )}
                </dl>
              </article>

              <article className="card">
                <div className="card-header">
                  <h3>内容块（{filteredBlocks.length}）</h3>
                  <span className="status-badge neutral">可复制</span>
                </div>
                <div className="block-list">
                  {filteredBlocks.map((block, index) => (
                    <div key={`${block.type}-${index}`} className="block-card">
                      <div className="block-chip" style={{ backgroundColor: blockAccent[block.type] }}>
                        {blockLabels[block.type]}
                      </div>
                      <p className="block-content">{block.content || block.alt || block.src}</p>
                      <button className="btn icon" onClick={() => handleBlockCopy(block)} title="复制到剪贴板">
                        复制
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}
        </section>
      )}

      {activeTab === 'markdown' && (
        <section className="panel">
          <div className="card">
            <div className="card-header">
              <h3>Markdown 编辑器</h3>
              <div className="button-group">
                <button className="btn" onClick={handleCopy} disabled={!markdown}>
                  复制
                </button>
                <button className="btn" onClick={handleDownload} disabled={!markdown}>
                  下载
                </button>
                <button className="btn" onClick={handleSaveToObsidian} disabled={!markdown} title="保存到 Obsidian Vault">
                  Obsidian
                </button>
              </div>
            </div>
            <textarea
              className="markdown-editor"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="等待内容采集..."
            />
          </div>
        </section>
      )}

      {activeTab === 'preview' && (
        <section className="panel">
          <div className="card">
            <div className="card-header">
              <h3>实时预览</h3>
              <span className="status-badge success">Live</span>
            </div>
            <div className="preview-pane" dangerouslySetInnerHTML={{ __html: renderedPreview || '<p>暂无内容</p>' }} />
          </div>
        </section>
      )}

      {activeTab === 'settings' && (
        <section className="panel settings">
          <div className="card inline">
            <div>
              <h4>界面主题</h4>
              <p className="muted">在浅色与深色之间切换</p>
            </div>
            <div className="toggle-group">
              <button className={classNames('btn', { primary: theme === 'light' })} onClick={() => setTheme('light')}>
                浅色
              </button>
              <button className={classNames('btn', { primary: theme === 'dark' })} onClick={() => setTheme('dark')}>
                深色
              </button>
            </div>
          </div>

          <div className="card inline">
            <div>
              <h4>自动采集</h4>
              <p className="muted">打开 Popup 时自动对当前页进行采集</p>
            </div>
            <label className="switch">
              <input type="checkbox" checked={autoFetch} onChange={(event) => {
                setAutoFetch(event.target.checked);
                chrome.storage.local.set({ autoFetch: event.target.checked });
              }} />
              <span className="slider" />
            </label>
          </div>

          <div className="card inline">
            <div>
              <h4>附加信息</h4>
              <p className="muted">在 Markdown 头部添加标题、URL 等元数据</p>
            </div>
            <label className="switch">
              <input type="checkbox" checked={includeFrontMatter} onChange={(event) => {
                setIncludeFrontMatter(event.target.checked);
                chrome.storage.local.set({ includeFrontMatter: event.target.checked });
              }} />
              <span className="slider" />
            </label>
          </div>

          <article className="card">
            <div className="card-header">
              <h3>Obsidian 集成</h3>
            </div>
            <div className="card-row">
              <span className="card-row-label">Vault 名称</span>
              <input
                type="text"
                className="setting-input"
                placeholder="My Vault"
                value={obsidianVault}
                onChange={(e) => saveObsidianSettings(e.target.value, obsidianFolder)}
              />
            </div>
            <div className="card-row">
              <span className="card-row-label">文件夹（可选）</span>
              <input
                type="text"
                className="setting-input"
                placeholder="Clippings"
                value={obsidianFolder}
                onChange={(e) => saveObsidianSettings(obsidianVault, e.target.value)}
              />
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <h3>站点模版（{Object.keys(templates).length}）</h3>
              <button className="btn icon" onClick={handleStartPicker}>
                新建
              </button>
            </div>
            {Object.keys(templates).length === 0 ? (
              <div className="template-empty">暂无模版，点击右上角「配置模版」在页面上选择内容区域</div>
            ) : (
              <div className="template-list">
                {Object.values(templates).map((tpl) => (
                  <div key={tpl.domain} className="template-item">
                    <div className="template-info">
                      <span className="template-domain">{tpl.domain}</span>
                      <span className="template-selector">{tpl.contentSelectors.join(', ')}</span>
                      {tpl.excludeSelectors.length > 0 && (
                        <span className="template-excludes">排除 {tpl.excludeSelectors.length} 项</span>
                      )}
                    </div>
                    <button className="btn icon" onClick={() => handleDeleteTemplate(tpl.domain)} title="删除模版">
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>

          <div className="card inline">
            <div>
              <h4>调试</h4>
              <p className="muted">导出页面源码、模版和匹配元素信息</p>
            </div>
            <button className="btn" onClick={handleDumpDebug}>导出调试信息</button>
          </div>
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
