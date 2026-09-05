import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchShareHtml } from '../server/fetch-share.js';
import { MAX_HTML_BYTES } from '../server/parser.js';
import { shareUrl, singleShareUrl } from './fixtures.js';

const fakeFetch = (implementation: (input: string, init: RequestInit) => Promise<Response>) => implementation as typeof fetch;

describe('公开分享抓取', () => {
  it('抓取单条回复分享，并阻止跳转到其他回复或完整对话', async () => {
    const result = await fetchShareHtml(`${singleShareUrl}?tracking=true`, { fetchImpl: fakeFetch(async (url) => {
      assert.equal(url, singleShareUrl);
      return new Response('single reply', { headers: { 'content-type': 'text/html' } });
    }) });
    assert.equal(result, 'single reply');
    for (const destination of [shareUrl, singleShareUrl.replace('0123456789abcdef0123456789abcdef', 'ffffffffffffffffffffffffffffffff'), 'https://chatgpt.com/auth/login']) {
      await assert.rejects(fetchShareHtml(singleShareUrl, { fetchImpl: fakeFetch(async () => new Response(null, { status: 302, headers: { location: destination } })) }), { code: 'UNSAFE_REDIRECT' });
    }
  });
  it('只请求规范化公开链接，不转发 Cookie，使用手动重定向', async () => {
    const result = await fetchShareHtml(`${shareUrl}?tracking=true`, { fetchImpl: fakeFetch(async (url, options) => {
      assert.equal(url, shareUrl);
      assert.equal(options.redirect, 'manual');
      assert.equal(new Headers(options.headers).get('cookie'), null);
      return new Response('<html>ok</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) });
    assert.equal(result, '<html>ok</html>');
  });

  it('阻止所有非分享地址跳转', async () => {
    for (const destination of ['http://127.0.0.1/internal', 'https://evil.test/', 'https://chatgpt.com/auth/login', shareUrl.replace('https:', 'http:')]) {
      let requests = 0;
      await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => {
        requests += 1;
        return new Response(null, { status: 302, headers: { location: destination } });
      }) }), { code: 'UNSAFE_REDIRECT' });
      assert.equal(requests, 1);
    }
  });

  it('允许同一分享的合法重定向', async () => {
    let requests = 0;
    const result = await fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => {
      requests += 1;
      return requests === 1 ? new Response(null, { status: 302, headers: { location: `${shareUrl}/` } }) : new Response('ok', { headers: { 'content-type': 'text/html' } });
    }) });
    assert.equal(result, 'ok');
    assert.equal(requests, 2);
  });

  it('区分反爬限制、失效链接和错误内容类型', async () => {
    for (const status of [401, 403, 429]) await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => new Response(null, { status })) }), { code: 'UPSTREAM_BLOCKED' });
    await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => new Response(null, { status: 404 })) }), { code: 'SHARE_NOT_FOUND' });
    await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })) }), { code: 'INVALID_CONTENT_TYPE' });
  });

  it('同时限制声明大小和流式响应大小', async () => {
    await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => new Response('', { headers: { 'content-type': 'text/html', 'content-length': String(MAX_HTML_BYTES + 1) } })) }), { code: 'HTML_TOO_LARGE' });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_HTML_BYTES + 1)); controller.close(); } });
    await assert.rejects(fetchShareHtml(shareUrl, { fetchImpl: fakeFetch(async () => new Response(body, { headers: { 'content-type': 'text/html' } })) }), { code: 'HTML_TOO_LARGE' });
  });

  it('超时中止请求并返回可操作错误', async () => {
    await assert.rejects(fetchShareHtml(shareUrl, { timeoutMs: 10, fetchImpl: fakeFetch(async (_url, options) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) }), { code: 'FETCH_TIMEOUT' });
  });
});
