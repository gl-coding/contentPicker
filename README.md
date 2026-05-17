# Content Picker Chrome 扩展需求与设计

## 1. 项目概述
构建一款 Chrome 浏览器扩展，可在任意网页中提取结构化内容（标题、段落、列表、链接、图片、表格等），自动整理为 Markdown 文档，并在扩展页面中实时预览与编辑。插件需提供美观易用的界面，支持一键复制 / 导出 Markdown。

## 2. 核心功能需求
1. **内容采集**
   - 从当前标签页读取 DOM，获取：
     - 页面元信息：标题、URL、发布时间（若可解析）、作者。
     - 文章正文：段落、列表、引用、代码块。
     - 媒体：图片（含 `alt` 与 `src`）、视频占位信息。
     - 表格内容（转换为 Markdown 表格）。
   - 支持用户勾选需要的模块（如仅正文 / 仅图片）。

2. **Markdown 整理**
   - 根据采集内容生成标准 Markdown，包含 Front Matter（元数据）。
   - 可选择模板（标准 / 纯文本 / 带引用）。
   - 支持手动微调（编辑器内可修改文本）。

3. **预览与输出**
   - 实时 Markdown 预览（使用 `marked` + `DOMPurify` 或 `markdown-it`）。
   - 支持复制、下载 `.md` 文件、导出到剪贴板。
   - 可切换浅色 / 深色主题。

4. **用户体验**
   - Popup 页提供 Tab：`采集`、`Markdown`、`预览`、`设置`。
   - 采集结果以卡片列表方式展示，每个模块可折叠。
   - 提供加载动画、错误提示（未授予权限、跨域失败等）。

## 3. 技术栈与依赖
- Manifest V3 (Chrome 114+)
- Popup 前端：Vite + React + TypeScript（或纯原生 + Lit，可根据复杂度）
- 样式：TailwindCSS / CSS Modules / 自定义设计系统
- Markdown：`markdown-it`、`turndown`（HTML→Markdown），`highlight.js`
- 状态管理：轻量（Context + Reducer）

## 4. 目录结构规划
```
contentpicker/
├── public/
│   └── icons/ (16/32/48/128)
├── src/
│   ├── manifest.json
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── extractor.ts
│   │   └── dom-utils.ts
│   ├── popup/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── App.tsx
│   ├── styles/
│   │   └── tailwind.css
│   └── types/
│       └── content.d.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 5. 流程设计
1. Popup 请求后台 `chrome.tabs.sendMessage`→ content script 执行 DOM 解析。
2. Content script 使用 `TurndownService` 或自研解析，将 HTML 片段转 Markdown AST。
3. 将结构化数据与 Markdown 回传 Popup。
4. Popup 存入状态，展示可视化模块和 Markdown 编辑器。
5. 预览区监听 Markdown 变化实时渲染。
6. 用户可导出 / 复制。

## 6. UI 关键点
- 顶部导航 + 页面标题 + 当前 URL。
- 卡片化模块：元信息、正文、媒体、表格。
- Markdown 编辑器使用等宽字体，支持语法高亮、自动换行。
- 预览区使用自定义主题，保证可读性。
- 设置页：模板选择、主题切换、默认导出选项。

## 7. 开发计划
1. 初始化项目（Vite + React + TS），配置 Manifest V3、打包脚本。
2. 实现内容采集与 Markdown 转换逻辑，编写单元测试（关键解析函数）。
3. 构建 Popup UI（Tabs + 编辑器 + 预览）。
4. 接入主题、加载状态、错误反馈。
5. 打包并编写使用说明，进行实际网页测试与调优。
# contentPicker
