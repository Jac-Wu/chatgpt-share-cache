import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Copy, ImageOff } from 'lucide-react';
import { copyText, errorMessage } from '../lib/utils';
import { useToast } from './Toast';

function nodeText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
    return '';
  }).join('');
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const notify = useToast();
  const element = Children.toArray(children).find((child) => isValidElement(child));
  const language = isValidElement<{ className?: string }>(element) ? element.props.className?.match(/language-([\w+-]+)/)?.[1] : undefined;

  async function copy() {
    try { await copyText(nodeText(children).replace(/\n$/, '')); notify('代码已复制。'); }
    catch (error) { notify(errorMessage(error), 'error'); }
  }

  return <div className="code-block"><div className="code-toolbar"><span><i /><i /><i /></span><strong>{language || 'CODE'}</strong><button onClick={copy} aria-label="复制代码"><Copy size={13} />复制代码</button></div><pre>{children}</pre></div>;
}

function safeUrl(value: string) {
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : '';
  } catch { return ''; }
}

export function Markdown({ content }: { content: string }) {
  const normalized = content.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`[^`\n]+`)/g).map((part, index) => index % 2 ? part : part.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n$$\n${formula}\n$$\n`).replace(/\\\(([^\n]*?)\\\)/g, (_match, formula: string) => `$${formula}$`)).join('');
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, strict: false, throwOnError: false, maxExpand: 1000, maxSize: 10 }], [rehypeHighlight, { detect: false }]]} skipHtml urlTransform={safeUrl} components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ children, href, title }) => href ? <a href={href} title={title} className={title?.startsWith('引用来源：') ? 'citation-link' : undefined} target="_blank" rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="uncached-image"><ImageOff size={16} />{alt ? `图片未缓存：${alt}` : '图片未缓存，请查看原始分享'}</span>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{normalized}</ReactMarkdown></div>;
}
