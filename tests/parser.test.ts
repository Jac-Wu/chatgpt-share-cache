import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encode } from 'turbo-stream';
import { parseShareHtml, MAX_HTML_BYTES } from '../server/parser.js';
import { parseSafely } from '../server/parse-safely.js';
import { normalizeShareUrl } from '../server/share-url.js';
import { conversationData, nextHtml, otherShareUrl, rawMessage, referencePayload, shareUrl, singleShareData, singleShareUrl, streamHtml } from './fixtures.js';

describe('分享地址校验', () => {
  it('支持单条回复分享，移除跟踪参数并保持独立 ID', () => {
    assert.equal(normalizeShareUrl(`${singleShareUrl.toUpperCase()}/?tracking=true#content`), singleShareUrl);
    for (const value of [singleShareUrl.replace('/s/t_', '/s/'), `${singleShareUrl}/extra`, singleShareUrl.slice(0, -1), singleShareUrl.replace('chatgpt.com', 'chatgpt.com.evil.test'), singleShareUrl.replace('https:', 'http:')]) {
      assert.throws(() => normalizeShareUrl(value), { code: 'INVALID_URL' });
    }
  });
  it('统一新旧域名、大小写与跟踪参数', () => {
    assert.equal(normalizeShareUrl(` ${shareUrl.toUpperCase()}/?utm_source=test#fragment `), shareUrl);
    assert.equal(normalizeShareUrl(shareUrl.replace('chatgpt.com', 'chat.openai.com')), shareUrl);
  });
  it('拒绝内网、伪装域名、凭据、任意路径与非 HTTPS 地址', () => {
    const invalid = [undefined, {}, '', 'hello', 'http://127.0.0.1', shareUrl.replace('https:', 'http:'), shareUrl.replace('chatgpt.com', 'chatgpt.com.evil.test'), shareUrl.replace('chatgpt.com', 'chatgpt.com@evil.test'), shareUrl.replace('chatgpt.com', 'user:secret@chatgpt.com'), shareUrl.replace('chatgpt.com', 'chatgpt.com:8443'), shareUrl.replace('/share/', '/c/'), `${shareUrl}/extra`, 'https://chatgpt.com/share/not-a-uuid', 'file:///etc/passwd'];
    for (const value of invalid) assert.throws(() => normalizeShareUrl(value), { code: 'INVALID_URL' });
  });
});

describe('对话解析', () => {
  it('只提取指定帖子的单条分享，不混入完整对话、个人资料或元数据消息', async () => {
    const result = await parseSafely(streamHtml([referencePayload(singleShareData())]), singleShareUrl);
    assert.equal(result.title, '单条回复与引用示例');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'assistant');
    assert.equal(result.messages[0].id, 'shared-answer');
    assert.equal(result.model, 'test-model');
    assert.ok(result.messages[0].content.includes('[来源 1](<https://example.com/source-a>'));
    assert.ok(result.messages[0].content.includes('[来源 2](<https://example.org/source-b>'));
    assert.ok(result.messages[0].content.includes('来源未缓存'));
    assert.ok(result.messages[0].content.includes('图片未缓存'));
    assert.ok(!JSON.stringify(result).includes('Never include'));
    assert.ok(!result.messages[0].content.includes('\uE200'));
  });

  it('单条分享 ID 不匹配时拒绝缓存其他帖子', async () => {
    await assert.rejects(parseShareHtml(streamHtml([referencePayload(singleShareData('t_ffffffffffffffffffffffffffffffff'))]), singleShareUrl), { code: 'IMPORT_URL_MISMATCH' });
  });

  it('单条分享的通用社交标题不覆盖真正的网页标题', async () => {
    const data = singleShareData();
    data.loaderData['routes/s.$postId'].postWithProfile.post.og_title = '看看这段聊天';
    const html = streamHtml([referencePayload(data)]).replace('<title>流式分享</title>', '<title>ChatGPT - 一段有标题的回复</title><meta property="og:title" content="看看这段聊天">');
    const result = await parseShareHtml(html, singleShareUrl);
    assert.equal(result.title, '一段有标题的回复');
  });

  it('提取 Next.js 数据，保留 Markdown，排除系统消息', async () => {
    const result = await parseShareHtml(nextHtml(), shareUrl);
    assert.equal(result.title, conversationData.title);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].role, 'user');
    assert.ok(result.messages[1].content.includes('```javascript'));
    assert.equal(result.model, 'test-model');
    assert.equal(result.parseMethod, 'next-data');
    assert.ok(!JSON.stringify(result).includes('Never store'));
  });

  it('只保留 mapping 中当前分支，过滤工具调用和隐藏推理', async () => {
    const result = await parseShareHtml(nextHtml({
      title: '分支测试', current_node: 'final', mapping: {
        root: { parent: null, children: ['question'], message: rawMessage('system', 'secret') },
        question: { parent: 'root', children: ['old', 'analysis'], message: rawMessage('user', 'question') },
        old: { parent: 'question', children: [], message: rawMessage('assistant', 'old branch') },
        analysis: { parent: 'question', children: ['tool'], message: { ...rawMessage('assistant', 'hidden thoughts'), channel: 'analysis' } },
        tool: { parent: 'analysis', children: ['final'], message: rawMessage('tool', 'tool output') },
        final: { parent: 'tool', children: [], message: rawMessage('assistant', 'final answer') },
      },
    }));
    assert.deepEqual(result.messages.map((message) => message.content), ['question', 'final answer']);
  });

  it('解析 React Router v2 引用表和分段脚本', async () => {
    const payload = referencePayload({ loaderData: { route: { serverResponse: { data: conversationData } } } });
    const result = await parseShareHtml(streamHtml([payload.slice(0, 97), payload.slice(97)]));
    assert.equal(result.messages.length, 2);
    assert.equal(result.title, conversationData.title);
    assert.equal(result.parseMethod, 'router-stream');
  });

  it('兼容旧 Remix 流与循环引用', async () => {
    const root: Record<string, unknown> = { data: conversationData };
    root.self = root;
    const result = await parseShareHtml(streamHtml([referencePayload(root)], '__remixContext'));
    assert.equal(result.messages.length, 2);
  });

  it('解析新版 turbo-stream 数据', async () => {
    const reader = encode({ loaderData: { shared: conversationData } }).getReader();
    const chunks: string[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    const result = await parseSafely(streamHtml(chunks));
    assert.equal(result.title, conversationData.title);
    assert.equal(result.messages.length, 2);
  });

  it('HTML 正文回退保留代码、表格，不执行脚本', async () => {
    const html = '<html><title>ChatGPT - 正文测试</title><body><script>globalThis.__parserPwned = true;</script><div data-message-author-role="user">如何开始？<button>复制</button></div><div data-message-author-role="assistant"><div class="markdown"><h2>下一步</h2><pre><code class="language-js">const answer = 42;</code></pre><table><thead><tr><th>阶段</th></tr></thead><tbody><tr><td>开始</td></tr></tbody></table><img src="https://example.invalid/image.png" /></div></div></body></html>';
    const result = await parseShareHtml(html);
    assert.equal(result.parseMethod, 'html');
    assert.equal(result.title, '正文测试');
    assert.equal(result.messages[0].content, '如何开始？');
    assert.ok(result.messages[1].content.includes('```js'));
    assert.ok(result.messages[1].content.includes('| 阶段 |'));
    assert.ok(result.messages[1].content.includes('图片未缓存'));
    assert.equal(Reflect.get(globalThis, '__parserPwned'), undefined);
  });

  it('多模态内容显示占位，不下载资源', async () => {
    const message = { ...rawMessage('user', ''), content: { parts: ['看这张图片', { content_type: 'image_asset_pointer', asset_pointer: 'https://private.test/file' }] } };
    const result = await parseShareHtml(nextHtml({ messages: [message] }));
    assert.ok(result.messages[0].content.includes('图片未缓存'));
    assert.ok(!JSON.stringify(result).includes('private.test'));
    assert.equal(result.warnings.length, 1);
  });

  it('拒绝地址不匹配的导入文件', async () => {
    await assert.rejects(parseShareHtml(nextHtml(), otherShareUrl), { code: 'IMPORT_URL_MISMATCH' });
  });

  it('识别验证页、空网页和无法解析的内容', async () => {
    await assert.rejects(parseShareHtml(''), { code: 'EMPTY_HTML' });
    await assert.rejects(parseShareHtml('<html><title>Just a moment...</title><form id="challenge-form"></form></html>'), { code: 'UPSTREAM_CHALLENGE' });
    await assert.rejects(parseShareHtml('<html><title>Log in</title></html>'), { code: 'PARSE_FAILED' });
  });

  it('对过大输入和过多消息明确失败，不悄悄截断', async () => {
    await assert.rejects(parseShareHtml('x'.repeat(MAX_HTML_BYTES + 1)), { code: 'HTML_TOO_LARGE' });
    await assert.rejects(parseShareHtml(nextHtml({ messages: Array.from({ length: 1001 }, (_value, index) => rawMessage('user', `message ${index}`)) })), { code: 'CONVERSATION_TOO_LARGE' });
  });

  it('隔离损坏流中的未决 Promise，不影响主进程', async () => {
    await assert.rejects(parseSafely(streamHtml(['{"pending":$0}\n'])), { code: 'PARSE_FAILED' });
    const result = await parseSafely(nextHtml());
    assert.equal(result.messages.length, 2);
  });
});
