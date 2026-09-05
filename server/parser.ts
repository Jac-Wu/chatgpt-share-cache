import { load } from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { decode } from 'turbo-stream';
import type { ChatMessage, ParsedConversation, ParseMethod } from '../shared/types.js';
import { MISSING_CITATION_WARNING, normalizeChatContent, RICH_CONTENT_WARNING } from '../shared/chat-content.js';
import { AppError } from './errors.js';
import { normalizeShareUrl, singleShareId } from './share-url.js';

export const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_MESSAGES = 1000;
type DataRecord = Record<string, unknown>;

function record(value: unknown): value is DataRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function messageFrom(raw: unknown, index: number, warnings: Set<string>): ChatMessage | null {
  if (!record(raw)) return null;
  const message = record(raw.message) ? raw.message : raw;
  const author = record(message.author) ? message.author : {};
  const role = author.role || message.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const metadata = record(message.metadata) ? message.metadata : {};
  if (
    metadata.is_visually_hidden_from_conversation === true ||
    metadata.is_user_system_message === true ||
    message.channel === 'analysis' ||
    message.channel === 'justify' ||
    (role === 'assistant' && typeof message.recipient === 'string' && message.recipient !== 'all')
  ) return null;

  const content = message.content;
  const parts = record(content) && Array.isArray(content.parts)
    ? content.parts
    : [typeof content === 'string' ? content : record(content) ? content.text : ''];
  const rendered = parts.map((part: unknown) => {
    if (typeof part === 'string') return part;
    if (!record(part)) return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (part.asset_pointer || text(part.content_type).includes('image')) {
      warnings.add('图片与附件未下载，需在原始分享中查看。');
      return '\n\n> [图片未缓存，请查看原始分享]\n\n';
    }
    if (part.content_type) {
      warnings.add('部分非文本内容（例如音频或附件）无法保存。');
      return '\n\n> [非文本内容未缓存]\n\n';
    }
    return '';
  }).join('\n').trim();

  if (!rendered) return null;
  const normalized = normalizeChatContent(rendered, metadata.content_references);
  if (normalized.missingCitations) warnings.add(MISSING_CITATION_WARNING);
  if (normalized.omittedRichContent) warnings.add(RICH_CONTENT_WARNING);
  return { id: text(message.id) || `message-${index + 1}`, role, content: normalized.content };
}

function mappingPath(conversation: DataRecord, warnings: Set<string>): unknown[] {
  const mapping = conversation.mapping;
  if (!record(mapping)) return [];
  const keys = Object.keys(mapping);
  if (keys.length > 10000) throw new AppError(413, 'CONVERSATION_TOO_LARGE', '对话节点过多，暂不支持缓存。');

  let traversed = 0;
  function pathTo(nodeId: string) {
    const path: unknown[] = [];
    const seen = new Set<string>();
    while (nodeId && record(mapping) && record(mapping[nodeId]) && !seen.has(nodeId)) {
      traversed += 1;
      if (traversed > 30000) throw new AppError(413, 'CONVERSATION_TOO_COMPLEX', '对话分支结构过于复杂，暂不支持缓存。');
      seen.add(nodeId);
      const node = mapping[nodeId] as DataRecord;
      path.push(node);
      nodeId = text(node.parent);
    }
    return path.reverse();
  }

  if (typeof conversation.current_node === 'string' && mapping[conversation.current_node]) {
    return pathTo(conversation.current_node);
  }

  const leaves = keys.filter((key) => {
    const node = mapping[key];
    return record(node) && (!Array.isArray(node.children) || node.children.length === 0);
  });
  if (leaves.length > 1) warnings.add('原分享包含多个分支且未标记当前分支，已保留最长的完整分支。');
  let longest: unknown[] = [];
  for (const leaf of leaves) {
    const branch = pathTo(leaf);
    if (branch.length >= longest.length) longest = branch;
  }
  return longest;
}

function conversationFromMessages(rawMessages: unknown[], title: string, method: ParseMethod, warnings = new Set<string>(), model: string | null = null): ParsedConversation | null {
  const messages = rawMessages.map((message, index) => messageFrom(message, index, warnings)).filter((message): message is ChatMessage => message !== null);
  if (!messages.length) return null;
  const modelMessage = rawMessages.map((raw) => record(raw) && record(raw.message) ? raw.message : raw)
    .find((raw) => record(raw) && record(raw.metadata) && typeof raw.metadata.model_slug === 'string');
  const messageModel = record(modelMessage) && record(modelMessage.metadata) ? text(modelMessage.metadata.model_slug) : '';
  return { title, messages, model: messageModel || model, warnings: [...warnings], parseMethod: method };
}

function extractStructured(root: unknown, method: ParseMethod, pageTitle: string, sourceUrl?: string): ParsedConversation | null {
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let best: ParsedConversation | null = null;
  let bestLength = 0;
  const postId = singleShareId(sourceUrl);
  let foundOtherPost = false;

  for (let cursor = 0; cursor < queue.length && cursor < 100000; cursor += 1) {
    const current = queue[cursor];
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (queue.length < 100000) queue.push(...current.slice(0, 10000));
      continue;
    }
    if (!record(current)) continue;

    if (postId) {
      if (typeof current.id === 'string' && current.id.startsWith('t_') && Array.isArray(current.attachments)) {
        if (current.id !== postId) foundOtherPost = true;
        else {
          const messages = current.attachments.filter((attachment) => record(attachment) && attachment.kind === 'message_slice' && Array.isArray(attachment.messages))
            .flatMap((attachment) => (attachment as DataRecord).messages as unknown[]);
          return conversationFromMessages(messages, descriptiveTitle(text(current.og_title)) || pageTitle, method);
        }
      }
      if (queue.length < 100000) queue.push(...Object.values(current).slice(0, 10000));
      continue;
    }

    const warnings = new Set<string>();
    let rawMessages: unknown[] = [];
    if (Array.isArray(current.linear_conversation)) rawMessages = current.linear_conversation;
    else if (record(current.mapping)) rawMessages = mappingPath(current, warnings);
    else if (Array.isArray(current.messages)) rawMessages = current.messages;

    if (rawMessages.length) {
      const candidate = conversationFromMessages(rawMessages, text(current.title) || pageTitle, method, warnings, text(current.model) || null);
      const length = candidate?.messages.reduce((total, message) => total + message.content.length, 0) || 0;
      if (candidate && length > bestLength) {
        best = candidate;
        bestLength = length;
      }
    }

    if (queue.length < 100000) queue.push(...Object.values(current).slice(0, 10000));
  }
  if (postId && foundOtherPost) throw new AppError(400, 'IMPORT_URL_MISMATCH', '网页中的单条回复分享 ID 与输入地址不一致，请检查链接与文件。');
  return best;
}

function decodeReferenceTable(table: unknown[]): unknown {
  const resolved = new Map<number, unknown>();
  let steps = 0;

  function resolve(reference: unknown, depth = 0): unknown {
    steps += 1;
    if (depth > 150 || steps > 150000) return undefined;
    if (typeof reference !== 'number' || !Number.isInteger(reference)) return reference;
    if (reference === -5) return null;
    if (reference < 0 || reference >= table.length) return undefined;
    if (resolved.has(reference)) return resolved.get(reference);
    const value = table[reference];
    if (Array.isArray(value)) {
      if (value[0] === 'N' && record(value[1])) {
        const target = Object.create(null) as DataRecord;
        resolved.set(reference, target);
        for (const [key, item] of Object.entries(value[1])) {
          const decodedKey = /^_\d+$/.test(key) ? resolve(Number(key.slice(1)), depth + 1) : key;
          if (typeof decodedKey === 'string' && !['__proto__', 'constructor', 'prototype'].includes(decodedKey)) target[decodedKey] = resolve(item, depth + 1);
        }
        return target;
      }
      const target: unknown[] = [];
      resolved.set(reference, target);
      for (const item of value) target.push(resolve(item, depth + 1));
      return target;
    }
    if (record(value)) {
      const target = Object.create(null) as DataRecord;
      resolved.set(reference, target);
      for (const [key, item] of Object.entries(value)) {
        const decodedKey = /^_\d+$/.test(key) ? resolve(Number(key.slice(1)), depth + 1) : key;
        if (typeof decodedKey === 'string' && !['__proto__', 'constructor', 'prototype'].includes(decodedKey)) {
          target[decodedKey] = resolve(item, depth + 1);
        }
      }
      return target;
    }
    resolved.set(reference, value);
    return value;
  }

  return resolve(0);
}

async function extractStream(html: string, title: string, sourceUrl?: string): Promise<ParsedConversation | null> {
  const pattern = /(?:window\.)?__(?:reactRouter|remix)Context\.streamController\.enqueue\(\s*("(?:\\.|[^"\\])*")\s*\)/g;
  const chunks: string[] = [];
  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1]) as string);
    } catch {
      continue;
    }
  }
  if (!chunks.length) return null;
  const payload = chunks.join('');

  try {
    const firstLine = payload.split('\n')[0];
    const table: unknown = JSON.parse(firstLine);
    if (Array.isArray(table)) {
      const result = extractStructured(decodeReferenceTable(table), 'router-stream', title, sourceUrl);
      if (result) return result;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
  }

  try {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    const decoded = await decode<unknown>(stream, {
      plugins: [(_type, ...values) => ({ value: values.length === 1 ? values[0] : values })],
    });
    return extractStructured(decoded, 'router-stream', title, sourceUrl);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
}

function descriptiveTitle(title: string) {
  const cleaned = title.replace(/^ChatGPT\s*[-–—|:]\s*/i, '').replace(/\s*[-–—|]\s*ChatGPT$/i, '').trim();
  return /^(ChatGPT|ChatGPT Shared Conversation|Shared conversation|看看这段聊天|Check out this chat)$/i.test(cleaned) ? '' : cleaned;
}

function cleanTitle(title: string, messages: ChatMessage[]) {
  const cleaned = descriptiveTitle(title);
  if (cleaned) return cleaned.slice(0, 160);
  return (messages.find((message) => message.role === 'user')?.content.replace(/[#*`\n]/g, ' ').trim() || '未命名的对话').slice(0, 80);
}

function finalize(conversation: ParsedConversation): ParsedConversation {
  const warnings = new Set(conversation.warnings);
  const messages = conversation.messages.map((message) => {
    const normalized = normalizeChatContent(message.content);
    if (normalized.missingCitations) warnings.add(MISSING_CITATION_WARNING);
    if (normalized.omittedRichContent) warnings.add(RICH_CONTENT_WARNING);
    return { ...message, content: normalized.content };
  });
  if (conversation.messages.length > MAX_MESSAGES || Buffer.byteLength(JSON.stringify(conversation.messages)) > MAX_TEXT_BYTES) {
    throw new AppError(413, 'CONVERSATION_TOO_LARGE', '对话超过 1,000 条消息或 1 MB 文本上限，无法完整缓存。');
  }
  return { ...conversation, messages, warnings: [...warnings], title: cleanTitle(conversation.title, messages) };
}

export async function parseShareHtml(html: string, sourceUrl?: string): Promise<ParsedConversation> {
  if (typeof html !== 'string' || !html.trim()) throw new AppError(400, 'EMPTY_HTML', '请选择包含对话内容的 HTML 网页文件。');
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new AppError(413, 'HTML_TOO_LARGE', '网页文件不能超过 8 MB。');
  const document = load(html);
  const title = descriptiveTitle(document('meta[property="og:title"]').attr('content') || '') || descriptiveTitle(document('title').text());
  const canonical = document('link[rel="canonical"]').attr('href') || document('meta[property="og:url"]').attr('content');
  if (sourceUrl && canonical) {
    let canonicalUrl: string | undefined;
    try { canonicalUrl = normalizeShareUrl(canonical); } catch { canonicalUrl = undefined; }
    if (canonicalUrl && canonicalUrl !== sourceUrl) {
      throw new AppError(400, 'IMPORT_URL_MISMATCH', '网页文件中的分享地址与输入链接不一致，请检查后重试。');
    }
  }

  const scripts = document('script#__NEXT_DATA__, script[type="application/json"]').toArray();
  for (const script of scripts.slice(0, 100)) {
    try {
      const value: unknown = JSON.parse(document(script).text());
      const method = document(script).attr('id') === '__NEXT_DATA__' ? 'next-data' : 'structured-json';
      const result = extractStructured(value, method, title, sourceUrl);
      if (result) return finalize(result);
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }

  const streamed = await extractStream(html, title, sourceUrl);
  if (streamed) return finalize(streamed);

  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.use(gfm);
  turndown.addRule('code-fence', {
    filter: 'pre',
    replacement(_content, node) {
      const code = node.querySelector('code');
      const source = (code || node).textContent || '';
      const language = code?.className.match(/language-([\w+-]+)/)?.[1] || '';
      const longestFence = Math.max(2, ...[...source.matchAll(/`+/g)].map((match) => match[0].length));
      const fence = '`'.repeat(longestFence + 1);
      return `\n\n${fence}${language}\n${source.replace(/\n$/, '')}\n${fence}\n\n`;
    },
  });
  turndown.addRule('math', {
    filter: (node) => node.classList.contains('katex') || node.classList.contains('katex-display'),
    replacement(_content, node) {
      const formula = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (!formula) return node.textContent || '';
      return node.classList.contains('katex-display') ? `\n\n$$\n${formula}\n$$\n\n` : `$${formula}$`;
    },
  });
  turndown.addRule('remote-images', {
    filter: 'img',
    replacement: () => '\n\n> [图片未缓存，请查看原始分享]\n\n',
  });

  const messages: ChatMessage[] = [];
  document('[data-message-author-role="user"], [data-message-author-role="assistant"]').each((index, element) => {
    const node = document(element);
    if (node.parents('[data-message-author-role]').length) return;
    const role = node.attr('data-message-author-role') as ChatMessage['role'];
    const body = (node.find('.markdown').first().length ? node.find('.markdown').first() : node).clone();
    body.find('script, style, button, svg, nav, iframe, form, [aria-hidden="true"]').remove();
    const content = turndown.turndown(body.html() || '').trim();
    if (content) messages.push({ id: node.attr('data-message-id') || `message-${index + 1}`, role, content });
  });

  if (messages.length) {
    return finalize({
      title,
      messages,
      model: null,
      warnings: ['通过网页正文提取；部分代码、公式格式可能与原页面不同。', '图片与附件未下载，需在原始分享中查看。'],
      parseMethod: 'html',
    });
  }

  if (/just a moment|checking your browser|verify you are human|attention required/i.test(title) || document('#challenge-form, #cf-challenge-running').length) {
    throw new AppError(422, 'UPSTREAM_CHALLENGE', '分享页面要求浏览器验证，服务器无法直接解析。请在浏览器打开原链接，保存完整网页后使用「导入网页」。');
  }
  throw new AppError(422, 'PARSE_FAILED', '未找到可读取的对话。链接可能已失效、需要登录，或网页格式已变化。可尝试在浏览器中保存完整网页后导入。');
}
