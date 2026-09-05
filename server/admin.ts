import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from './errors.js';
import type { ArchiveStore } from './store.js';

const cookieName = 'shiguang_admin';
const sessionDuration = 8 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest();

export class AdminSessions {
  private sessions = new Map<string, { expiresAt: number; origin: string }>();
  private secretHash: Buffer;

  constructor(secret: string, private now = Date.now) {
    this.secretHash = digest(secret);
  }

  verify(secret: unknown) {
    return typeof secret === 'string' && secret.length <= 512 && timingSafeEqual(digest(secret), this.secretHash);
  }

  create(origin: string) {
    for (const [key, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(key);
    if (this.sessions.size >= 1000) throw new AppError(503, 'ADMIN_SESSION_LIMIT', '管理会话已达上限，请稍后再试。');
    const token = randomBytes(32).toString('hex');
    const session = { expiresAt: this.now() + sessionDuration, origin };
    this.sessions.set(digest(token).toString('hex'), session);
    return { token, expiresAt: session.expiresAt };
  }

  get(token: string, origin: string) {
    if (!/^[a-f\d]{64}$/.test(token)) return undefined;
    const key = digest(token).toString('hex');
    const session = this.sessions.get(key);
    if (session && session.expiresAt <= this.now()) { this.sessions.delete(key); return undefined; }
    return session?.origin === origin ? session : undefined;
  }

  revoke(token: string) {
    this.sessions.delete(digest(token).toString('hex'));
  }
}

function cookieOptions(response: Response) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: (response.locals.requestOrigin as string).startsWith('https:'), path: '/api/admin' };
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
    throw new AppError(400, 'INVALID_QUERY', '分页参数必须是有效的正整数。');
  }
  return Number(value);
}

export function createAdminRouter(store: ArchiveStore, secret: string | undefined, disableRateLimit: boolean) {
  const router = express.Router();
  const sessions = secret ? new AdminSessions(secret) : undefined;
  router.use((request, response, next) => {
    if (!sessions) throw new AppError(503, 'ADMIN_DISABLED', '管理端尚未启用，请在服务器配置 ADMIN_SECRET 并重启服务。');
    response.locals.adminToken = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
    next();
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    skip: () => disableRateLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '登录尝试过多，请在 15 分钟后重试。', code: 'ADMIN_RATE_LIMITED' },
  });
  router.post('/login', loginLimiter, express.json({ limit: '4kb' }), (request, response) => {
    if (!sessions!.verify(request.body?.secret)) throw new AppError(401, 'ADMIN_INVALID_SECRET', '管理密钥不正确。');
    const session = sessions!.create(response.locals.requestOrigin as string);
    sessions!.revoke(response.locals.adminToken as string);
    response.cookie(cookieName, session.token, { ...cookieOptions(response), maxAge: sessionDuration });
    response.json({ expiresAt: session.expiresAt });
  });
  router.delete('/session', (_request, response) => {
    sessions!.revoke(response.locals.adminToken as string);
    response.clearCookie(cookieName, cookieOptions(response));
    response.status(204).end();
  });
  router.use((_request, response, next) => {
    const session = sessions!.get(response.locals.adminToken as string, response.locals.requestOrigin as string);
    if (!session) {
      response.clearCookie(cookieName, cookieOptions(response));
      throw new AppError(401, 'ADMIN_UNAUTHORIZED', '请使用管理密钥登录，或重新登录已过期的会话。');
    }
    response.locals.adminExpiresAt = session.expiresAt;
    next();
  });
  router.get('/session', (_request, response) => response.json({ expiresAt: response.locals.adminExpiresAt }));
  router.get('/archives', (request, response) => {
    const query = request.query.q ?? '';
    if (typeof query !== 'string' || query.length > 200) throw new AppError(400, 'INVALID_QUERY', '搜索内容不能超过 200 个字符。');
    const page = positiveInteger(request.query.page, 1, 1000000);
    const pageSize = positiveInteger(request.query.pageSize, 20, 100);
    response.json(store.listAll(query.trim(), page, pageSize));
  });
  router.delete('/archives/:id', (request, response) => {
    store.deleteAny(request.params.id as string);
    response.status(204).end();
  });
  return router;
}
