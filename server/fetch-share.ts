import { ProxyAgent } from 'undici';
import { AppError } from './errors.js';
import { MAX_HTML_BYTES } from './parser.js';
import { normalizeShareUrl } from './share-url.js';

interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  proxy?: string;
}

export async function fetchShareHtml(input: string, options: FetchOptions = {}): Promise<string> {
  const initialUrl = normalizeShareUrl(input);
  let currentUrl = initialUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  const proxy = options.proxy ? new ProxyAgent(options.proxy) : undefined;

  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const requestOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ShiguangArchive/1.0; public-share-cache)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        ...(proxy ? { dispatcher: proxy } : {}),
      };
      const response = await (options.fetchImpl || fetch)(currentUrl, requestOptions);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirect === 3) throw new AppError(502, 'UNSAFE_REDIRECT', '分享地址重定向异常，请检查原链接。');
        let destination: string;
        try {
          const absolute = new URL(location, currentUrl);
          destination = normalizeShareUrl(absolute.href);
          if (destination !== initialUrl) throw new Error('Different share');
          currentUrl = absolute.href;
        } catch {
          throw new AppError(502, 'UNSAFE_REDIRECT', '分享链接跳转到了非公开分享页面；不会跟随登录页或其他站点。');
        }
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 429].includes(response.status)) {
          throw new AppError(502, 'UPSTREAM_BLOCKED', 'ChatGPT 暂时拒绝服务器访问，或该链接需要登录。请在浏览器打开分享链接，保存完整网页后使用「导入网页」。');
        }
        if ([404, 410].includes(response.status)) throw new AppError(404, 'SHARE_NOT_FOUND', '分享链接不存在或已被取消分享，请确认原链接仍可公开访问。');
        throw new AppError(502, 'UPSTREAM_ERROR', 'ChatGPT 分享服务暂不可用，请稍后再试。');
      }

      const type = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
        await response.body?.cancel();
        throw new AppError(502, 'INVALID_CONTENT_TYPE', '分享链接未返回 HTML 网页，无法解析。');
      }
      if (Number(response.headers.get('content-length') || 0) > MAX_HTML_BYTES) {
        await response.body?.cancel();
        throw new AppError(413, 'HTML_TOO_LARGE', '分享网页超过 8 MB，暂不支持缓存。');
      }
      if (!response.body) throw new AppError(502, 'EMPTY_RESPONSE', '分享页面内容为空。');

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_HTML_BYTES) {
            await reader.cancel();
            throw new AppError(413, 'HTML_TOO_LARGE', '分享网页超过 8 MB，暂不支持缓存。');
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    throw new AppError(502, 'UNSAFE_REDIRECT', '分享地址重定向次数过多。');
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) throw new AppError(504, 'FETCH_TIMEOUT', '访问 ChatGPT 超时。请检查服务器网络，或改用「导入网页」。');
    throw new AppError(502, 'FETCH_FAILED', '服务器无法连接 ChatGPT。请检查服务器网络或 OUTBOUND_PROXY 设置，也可以导入已保存的网页。');
  } finally {
    clearTimeout(timer);
    await proxy?.close();
  }
}
