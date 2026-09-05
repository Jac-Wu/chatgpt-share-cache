import { parentPort, workerData } from 'node:worker_threads';
import { parseShareHtml } from './parser.js';
import { AppError } from './errors.js';

try {
  const data = workerData as { html: string; sourceUrl?: string };
  const conversation = await parseShareHtml(data.html, data.sourceUrl);
  parentPort?.postMessage({ ok: true, conversation });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof AppError
      ? { status: error.status, code: error.code, message: error.message }
      : { status: 422, code: 'PARSE_FAILED', message: '网页格式无法解析，请检查是否保存了完整的分享页面。' },
  });
}
