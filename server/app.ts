import { createHash, randomBytes } from 'node:crypto';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Archive, CreateArchiveResult } from '../shared/types.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { fetchShareHtml } from './fetch-share.js';
import { parseSafely } from './parse-safely.js';
import { normalizeShareUrl } from './share-url.js';
import { ArchiveStore } from './store.js';
import { requestOrigin } from './request-origin.js';
import { createAdminRouter } from './admin.js';

interface AppOptions {
  store: ArchiveStore;
  config: Config;
  fetchHtml?: (url: string) => Promise<string>;
  production?: boolean;
  disableRateLimit?: boolean;
}

export function createApp({ store, config, fetchHtml, production = false, disableRateLimit = false }: AppOptions) {
  const app = express();
  app.set('env', production ? 'production' : 'development');
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const securityHeaders = (secure: boolean) => helmet({
    contentSecurityPolicy: production ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: secure ? [] : null,
      },
    } : false,
    strictTransportSecurity: secure,
    referrerPolicy: { policy: 'no-referrer' },
  });
  const httpHeaders = securityHeaders(false);
  const httpsHeaders = securityHeaders(true);
  app.use((request, response, next) => {
    const origin = requestOrigin(request, config.allowedHosts);
    response.locals.requestOrigin = origin;
    const headers = origin.startsWith('https:') ? httpsHeaders : httpHeaders;
    headers(request, response, next);
  });
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/robots.txt', (_request, response) => response.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  if (!disableRateLimit) {
    app.use('/api', rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: '操作太频繁，请稍后再试。', code: 'RATE_LIMITED' },
    }));
  }

  app.use('/api', (request, response, next) => {
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('shiguang_workspace='))?.slice('shiguang_workspace='.length);
    const validCookie = cookie && /^[a-f\d]{64}$/.test(cookie);
    const token = validCookie ? cookie : randomBytes(32).toString('hex');
    if (!validCookie) {
      response.cookie('shiguang_workspace', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: (response.locals.requestOrigin as string).startsWith('https:'),
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }
    response.locals.ownerKey = createHash('sha256').update(token).digest('hex');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.get('X-Requested-With') !== 'Shiguang') return next(new AppError(403, 'CSRF_REJECTED', '请求来源校验失败，请从本站页面重新操作。'));
      const origin = request.get('Origin');
      if (origin && origin !== response.locals.requestOrigin) return next(new AppError(403, 'ORIGIN_REJECTED', '请求来源与当前访问地址不一致，请从本站页面重试；使用 HTTPS 反向代理时请检查可信代理配置。'));
    }
    next();
  });

  app.use('/api/admin', createAdminRouter(store, config.adminSecret, disableRateLimit));

  const createLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    skip: () => disableRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '15 分钟内最多创建 20 次缓存，请稍后再试。', code: 'RATE_LIMITED' },
  });
  const json = express.json({ limit: '12mb' });
  const pending = new Map<string, Promise<Archive>>();
  const fetchPublic = fetchHtml || ((url: string) => fetchShareHtml(url, { timeoutMs: config.fetchTimeout, proxy: config.outboundProxy }));

  app.get('/api/archives', (_request, response) => response.json(store.list(response.locals.ownerKey as string)));

  async function createArchive(request: Request, response: Response, method: 'link' | 'html') {
    const sourceUrl = normalizeShareUrl(request.body?.url);
    const ownerKey = response.locals.ownerKey as string;
    const existing = store.findBySource(ownerKey, sourceUrl);
    const key = `${ownerKey}:${sourceUrl}`;
    let cached = Boolean(existing);
    let archive = existing;
    if (!archive) {
      store.assertCapacity(ownerKey);
      let work = pending.get(key);
      if (work) cached = true;
      else {
        work = (async () => {
          if (method === 'html' && typeof request.body?.html !== 'string') throw new AppError(400, 'EMPTY_HTML', '请上传保存的 HTML 网页文件。');
          const html = method === 'html' ? request.body.html as string : await fetchPublic(sourceUrl);
          const parsed = await parseSafely(html, sourceUrl);
          return store.create(ownerKey, sourceUrl, parsed, method);
        })();
        pending.set(key, work);
      }
      try { archive = await work; } finally { if (pending.get(key) === work) pending.delete(key); }
    }
    const cachePath = `/c/${archive.id}`;
    const result: CreateArchiveResult = { archive, cached, cachePath, cacheUrl: `${response.locals.requestOrigin as string}${cachePath}` };
    response.status(cached ? 200 : 201).json(result);
  }

  app.post('/api/archives', createLimiter, json, (request, response) => createArchive(request, response, 'link'));
  app.post('/api/archives/import', createLimiter, json, (request, response) => createArchive(request, response, 'html'));
  app.get('/api/archives/:id', (request, response) => response.json(store.get(request.params.id as string, response.locals.ownerKey as string)));
  app.patch('/api/archives/:id', json, (request, response) => {
    if (typeof request.body?.favorite !== 'boolean') throw new AppError(400, 'INVALID_BODY', 'favorite 必须为布尔值。');
    response.json(store.setFavorite(request.params.id as string, response.locals.ownerKey as string, request.body.favorite));
  });
  app.delete('/api/archives/:id', (request, response) => {
    store.delete(request.params.id as string, response.locals.ownerKey as string);
    response.status(204).end();
  });
  app.get('/api/archives/:id/export', (request, response) => {
    const archive = store.get(request.params.id as string, response.locals.ownerKey as string);
    const markdown = `# ${archive.title}\n\n原始分享：${archive.sourceUrl}\n\n缓存时间：${archive.createdAt}\n\n---\n\n${archive.messages.map((message) => `## ${message.role === 'user' ? '你' : 'ChatGPT'}\n\n${message.content}`).join('\n\n---\n\n')}\n`;
    const filename = archive.title.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 80);
    response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="conversation.md"; filename*=UTF-8''${encodeURIComponent(filename)}.md`);
    response.send(markdown);
  });
  app.use('/api', (_request, _response, next) => next(new AppError(404, 'NOT_FOUND', '接口不存在。')));

  const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
    if (error instanceof AppError) {
      response.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const typed = error as { type?: string };
    if (typed.type === 'entity.too.large') {
      response.status(413).json(request.path.startsWith('/api/admin/') ? { error: '管理登录请求过大。', code: 'ADMIN_BODY_TOO_LARGE' } : { error: '请求过大，网页文件不能超过 8 MB。', code: 'HTML_TOO_LARGE' });
      return;
    }
    if (typed.type === 'entity.parse.failed') {
      response.status(400).json({ error: '请求不是有效的 JSON。', code: 'INVALID_JSON' });
      return;
    }
    console.error('[shiguang] Request failed:', error instanceof Error ? error.message : 'Unknown error');
    response.status(500).json({ error: '服务暂时出现问题，请稍后重试。', code: 'INTERNAL_ERROR' });
  };
  app.use(errorHandler);
  return app;
}
