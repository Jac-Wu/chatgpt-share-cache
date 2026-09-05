import { Worker } from 'node:worker_threads';
import type { ParsedConversation } from '../shared/types.js';
import { AppError } from './errors.js';

let activeParsers = 0;

export async function parseSafely(html: string, sourceUrl?: string): Promise<ParsedConversation> {
  if (activeParsers >= 4) throw new AppError(503, 'PARSER_BUSY', '当前解析任务较多，请稍后再试。');
  activeParsers += 1;
  try {
    const development = import.meta.url.endsWith('.ts');
    const entry = new URL(development ? './parser-worker.ts' : './parser-worker.js', import.meta.url);
    const workerUrl = development
      ? new URL(`data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register(); await import(${JSON.stringify(entry.href)});`)}`)
      : entry;
    return await new Promise<ParsedConversation>((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        workerData: { html, sourceUrl },
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      });
      let settled = false;
      const finish = (error?: Error, conversation?: ParsedConversation) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(conversation!);
      };
      const timer = setTimeout(() => finish(new AppError(422, 'PARSE_TIMEOUT', '网页解析超时或内容过于复杂，请尝试导入更精简的分享网页。')), 8000);
      worker.once('message', (message: { ok: boolean; conversation?: ParsedConversation; error?: { status: number; code: string; message: string } }) => {
        if (message.ok && message.conversation) finish(undefined, message.conversation);
        else finish(new AppError(message.error?.status || 422, message.error?.code || 'PARSE_FAILED', message.error?.message || '无法解析此网页。'));
      });
      worker.once('error', () => finish(new AppError(422, 'PARSE_FAILED', '网页数据无法安全解析，请尝试导入浏览器另存的完整网页。')));
      worker.once('exit', () => { if (!settled) finish(new AppError(422, 'PARSE_FAILED', '网页解析未完成，请检查网页格式。')); });
    });
  } finally { activeParsers -= 1; }
}
