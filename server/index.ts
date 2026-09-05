import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { ArchiveStore } from './store.js';

process.umask(0o077);
const config = readConfig();
const production = process.env.NODE_ENV === 'production' || import.meta.url.includes('/dist-server/');
const store = new ArchiveStore(path.join(config.dataDir, 'archives.sqlite'), config.maxArchives, config.maxTotalArchives);
const app = createApp({ store, config, production });
const server = createHttpServer(app);

if (production) {
  app.use(express.static(path.resolve('dist'), { index: false }));
  app.get('/{*path}', (_request, response) => response.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'custom' });
  app.use(vite.middlewares);
  app.get('/{*path}', async (request, response, next) => {
    try {
      const source = await readFile(path.resolve('index.html'), 'utf8');
      const html = await vite.transformIndexHtml(request.originalUrl, source);
      response.type('html').send(html);
    } catch (error) { next(error); }
  });
}

server.listen(config.port, config.host, () => {
  const host = ['0.0.0.0', '::'].includes(config.host) ? 'localhost' : config.host.includes(':') ? `[${config.host}]` : config.host;
  console.log(`\n  拾光 · Chat Archive\n  http://${host}:${config.port}\n  分享地址自动跟随当前访问地址\n  数据目录：${config.dataDir}\n`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', (error) => {
  console.error('服务器启动失败：', error.message);
  store.close();
  process.exit(1);
});
