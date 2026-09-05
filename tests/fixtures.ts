export const shareUrl = 'https://chatgpt.com/share/12345678-1234-4234-8234-123456789abc';
export const otherShareUrl = 'https://chatgpt.com/share/87654321-4321-4321-8321-cba987654321';
export const singleShareUrl = 'https://chatgpt.com/s/t_0123456789abcdef0123456789abcdef';
export const citedMarker = '\uE200cite\uE202turn593198view2\uE202turn791837view4\uE201';

export function rawMessage(role: string, content: string, id = role) {
  return { id, author: { role }, content: { content_type: 'text', parts: [content] }, metadata: role === 'assistant' ? { model_slug: 'test-model' } : {} };
}

export const conversationData = {
  title: '把灵感变成可执行的计划',
  linear_conversation: [
    { message: rawMessage('system', 'Never store this system prompt') },
    { message: rawMessage('user', '怎样让一个好想法真正落地？') },
    { message: rawMessage('assistant', '## 从一个小动作开始\n\n**先做一个最小实验。**\n\n```javascript\nconst idea = "start small";\n```\n\n| 想法 | 下一步 |\n| --- | --- |\n| 写作 | 写三个问题 |\n\n公式：\\(E = mc^2\\)\n\n![不下载的图片](https://example.invalid/tracker.png)\n\n<script>window.__archiveXss = true</script>\n\n[不安全链接](javascript:alert%281%29)') },
  ],
};

export function nextHtml(data: unknown = conversationData, canonical = shareUrl) {
  return `<!doctype html><html><head><title>ChatGPT - 测试分享</title><link rel="canonical" href="${canonical}"></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { serverResponse: { data } } } }).replace(/</g, '\\u003c')}</script></body></html>`;
}

export function streamHtml(chunks: string[], context = '__reactRouterContext') {
  return `<html><head><title>流式分享</title></head><body>${chunks.map((chunk) => `<script>window.${context}.streamController.enqueue(${JSON.stringify(chunk).replace(/</g, '\\u003c')});</script>`).join('')}</body></html>`;
}

export function singleShareData(postId = 't_0123456789abcdef0123456789abcdef') {
  return {
    loaderData: {
      'routes/s.$postId': {
        postWithProfile: {
          post: {
            id: postId,
            og_title: '单条回复与引用示例',
            attachments: [{
              kind: 'message_slice',
              messages: [{
                ...rawMessage('assistant', `这是一条独立分享的回复，中文、20:00—21:00 和 9月30日都应正常显示。${citedMarker}\n\n缺失来源的旧引用：\uE200cite\uE202turnMissingview9\uE201\n\n\uE200i\uE202turnImage0\uE201`, 'shared-answer'),
                metadata: {
                  model_slug: 'test-model',
                  content_references: [{
                    matched_text: citedMarker,
                    type: 'grouped_webpages',
                    items: [{ title: '示例来源 A', url: 'https://example.com/source-a', supporting_websites: [{ title: '示例来源 B', url: 'https://example.org/source-b' }] }],
                  }],
                  messages: [rawMessage('assistant', 'Never include unrelated metadata conversations '.repeat(80))],
                },
              }],
            }],
          },
          profile: { messages: [rawMessage('assistant', 'Never include profile conversations '.repeat(80))] },
        },
      },
      unrelated: { messages: [rawMessage('assistant', 'Never include unrelated conversations '.repeat(80))] },
    },
  };
}

export function referencePayload(root: unknown) {
  const table: unknown[] = [];
  const references = new Map<unknown, number>();
  function add(value: unknown): number {
    if (value === null) return -5;
    if (value === undefined) return -7;
    const existing = references.get(value);
    if (existing !== undefined) return existing;
    const index = table.length;
    references.set(value, index);
    table.push(null);
    if (Array.isArray(value)) table[index] = value.map(add);
    else if (typeof value === 'object') {
      const encoded: Record<string, number> = {};
      for (const [key, item] of Object.entries(value)) encoded[`_${add(key)}`] = add(item);
      table[index] = encoded;
    } else table[index] = value;
    return index;
  }
  add(root);
  return `${JSON.stringify(table)}\n`;
}
