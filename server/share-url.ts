import { AppError } from './errors.js';

const sharePath = /^\/share\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/?$/i;
const singleSharePath = /^\/s\/(t_[a-f\d]{32})\/?$/i;
const allowedHosts = new Set(['chatgpt.com', 'chat.openai.com']);

export function normalizeShareUrl(input: unknown): string {
  const invalid = () => new AppError(400, 'INVALID_URL', '请输入有效的 ChatGPT 分享链接，支持 https://chatgpt.com/share/对话ID 和 https://chatgpt.com/s/t_分享ID。');
  if (typeof input !== 'string' || input.length > 2048) throw invalid();

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw invalid();
  }

  const match = parsed.pathname.match(sharePath);
  const singleMatch = parsed.hostname === 'chatgpt.com' ? parsed.pathname.match(singleSharePath) : null;
  if (
    parsed.protocol !== 'https:' ||
    !allowedHosts.has(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    (!match && !singleMatch)
  ) {
    throw invalid();
  }

  return match ? `https://chatgpt.com/share/${match[1].toLowerCase()}` : `https://chatgpt.com/s/${singleMatch![1].toLowerCase()}`;
}

export function singleShareId(sourceUrl?: string) {
  return sourceUrl ? new URL(sourceUrl).pathname.match(singleSharePath)?.[1].toLowerCase() : undefined;
}
