export type ExtractedMetadata = {
  title: string;
  url: string;
  author?: string;
  publishedAt?: string;
  description?: string;
};

export type ExtractedBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'image' | 'table' | 'link';
  content: string;
  level?: number;
  language?: string;
  src?: string;
  alt?: string;
  href?: string;
};

export type ExtractedContent = {
  metadata: ExtractedMetadata;
  blocks: ExtractedBlock[];
};

export type MarkdownPayload = {
  markdown: string;
  raw: ExtractedContent;
};

export type SiteTemplate = {
  domain: string;
  name: string;
  contentSelector: string;
  excludeSelectors: string[];
  createdAt: number;
  updatedAt: number;
};
