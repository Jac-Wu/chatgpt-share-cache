import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Copy, Database, Download, KeyRound, Loader2, LogOut, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { AdminArchiveList, ArchiveSummary } from '../../shared/types';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { adminApi, ApiError } from '../lib/api';
import { useLibrary } from '../lib/LibraryContext';
import { useRecentReads } from '../lib/RecentReadsContext';
import { archiveUrl, copyText, errorMessage, formatBytes, fullDate } from '../lib/utils';
import './admin.css';

export function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secret, setSecret] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminArchiveList | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [deleting, setDeleting] = useState<ArchiveSummary | null>(null);
  const notify = useToast();
  const { refresh } = useLibrary();
  const { remove } = useRecentReads();

  const resetSession = useCallback(() => {
    setExpiresAt(null);
    setData(null);
    setDeleting(null);
    setSearch('');
    setQuery('');
    setPage(1);
  }, []);

  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && ['ADMIN_UNAUTHORIZED', 'ADMIN_DISABLED'].includes(failure.code)) {
      resetSession();
      setDisabled(failure.code === 'ADMIN_DISABLED');
    }
    setError(errorMessage(failure));
  }, [resetSession]);

  useEffect(() => {
    const controller = new AbortController();
    const checkSession = async () => {
      try {
        const session = await adminApi.session(controller.signal);
        if (!controller.signal.aborted) { setExpiresAt(session.expiresAt); setDisabled(false); }
      } catch (failure) {
        if (!controller.signal.aborted) {
          resetSession();
          if (!(failure instanceof ApiError && failure.code === 'ADMIN_UNAUTHORIZED')) handleError(failure);
        }
      } finally { if (!controller.signal.aborted) setChecking(false); }
    };
    void checkSession();
    window.addEventListener('focus', checkSession);
    return () => { controller.abort(); window.removeEventListener('focus', checkSession); };
  }, [handleError, resetSession]);

  useEffect(() => {
    if (!expiresAt) return;
    const timeout = setTimeout(() => {
      resetSession();
      setError('管理会话已过期，请重新输入密钥。');
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [expiresAt, resetSession]);

  useEffect(() => {
    if (!expiresAt) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError('');
    adminApi.list(query, page, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setData(result); setPage(result.page); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) handleError(failure);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expiresAt, query, page, revision, handleError]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await adminApi.login(secret);
      setExpiresAt(session.expiresAt);
      setDisabled(false);
    } catch (failure) { handleError(failure); }
    finally { setSecret(''); setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await adminApi.logout(); resetSession(); setError(''); }
    catch (failure) { handleError(failure); }
    finally { setBusy(false); }
  }

  async function deleteArchive() {
    if (!deleting) return;
    setBusy(true);
    try {
      await adminApi.remove(deleting.id);
      remove(deleting.id);
      setDeleting(null);
      setRevision((value) => value + 1);
      void refresh();
      notify('缓存已从服务器删除，原缓存地址已失效。');
    } catch (failure) {
      handleError(failure);
      setDeleting(null);
      if (failure instanceof ApiError && failure.code === 'ARCHIVE_NOT_FOUND') setRevision((value) => value + 1);
      notify(errorMessage(failure), 'error');
    } finally { setBusy(false); }
  }

  async function copyAddress(id: string) {
    try { await copyText(archiveUrl(id)); notify('缓存地址已复制'); }
    catch (failure) { notify(errorMessage(failure), 'error'); }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <div className="admin-shell">
    <header className="admin-topbar"><Link to="/" className="admin-brand"><ShieldCheck size={23} /><strong>拾光<span> / 管理端</span></strong></Link><div className="admin-topbar-actions"><Link to="/" className="subtle-link"><ArrowLeft size={14} />返回首页</Link>{expiresAt && <button className="button button-white button-small" disabled={busy} onClick={() => void logout()}><LogOut size={14} />退出登录</button>}</div></header>
    <main id="main-content" className={`admin-main${expiresAt ? '' : ' admin-gate'}`}>
      {checking ? <div className="admin-loading" role="status"><Loader2 className="spin" size={24} />正在检查管理会话…</div> : !expiresAt ? <section className="admin-login" aria-labelledby="admin-title">
        <span className="admin-lock"><KeyRound size={28} /></span><p className="admin-eyebrow">PRIVATE CONSOLE</p><h1 id="admin-title">管理每一份留存。</h1><p className="admin-intro">此处可查看与管理全站缓存。<br />请输入部署者配置的管理密钥。</p>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <form onSubmit={(event) => void login(event)}><label htmlFor="admin-secret">管理密钥</label><input id="admin-secret" type="password" name="admin-secret" autoComplete="current-password" placeholder="输入 ADMIN_SECRET" value={secret} onChange={(event) => setSecret(event.target.value)} maxLength={512} required disabled={busy || disabled} /><button type="submit" className="button button-dark" disabled={busy || disabled || !secret}>{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{busy ? '正在验证…' : '进入管理端'}</button></form>
        <p className="admin-login-note">密钥不写入浏览器本地存储，登录有效期为 8 小时。<br />请使用 HTTPS 访问，并在离开后退出登录。</p>
      </section> : <>
        <div className="admin-heading"><div><p className="admin-eyebrow">INSTANCE OVERVIEW</p><h1>全站缓存，一目了然。</h1><p className="admin-intro">跨工作区查看所有服务器缓存，不影响普通用户的内容隔离。</p></div><span className="admin-session-badge"><ShieldCheck size={15} />管理员会话</span></div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <section className="admin-stats" aria-label="全站统计">{[
          ['缓存总数', data?.stats.total.toLocaleString(), '份已保存对话'],
          ['工作区', data?.stats.workspaces.toLocaleString(), '含缓存的浏览器身份'],
          ['对话消息', data?.stats.messages.toLocaleString(), '条已提取消息'],
          ['内容体积', data ? formatBytes(data.stats.bytes) : undefined, '不含数据库索引与日志'],
        ].map(([label, value, hint]) => <div className="admin-stat" key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>{hint}</small></div>)}</section>
        <section className="admin-records" aria-labelledby="admin-records-title">
          <div className="admin-records-heading"><h2 id="admin-records-title"><Database size={18} />所有缓存{data && <span>{data.total.toLocaleString()} 份{query ? '匹配' : '记录'}</span>}</h2><button className="button button-white button-small" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''} />刷新列表</button></div>
          <form className="admin-search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setPage(1); setRevision((value) => value + 1); }}><label htmlFor="admin-search" className="visually-hidden">搜索全站缓存</label><Search size={18} /><input id="admin-search" placeholder="搜索标题、原始分享链接或缓存 ID" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} /><button className="button button-dark button-small" type="submit" disabled={busy}>搜索</button></form>
          {loading ? <div className="admin-loading" role="status"><Loader2 size={22} className="spin" />正在读取全站缓存…</div> : data?.archives.length ? <div className="admin-list">{data.archives.map((archive) => <article className="admin-record" key={archive.id}>
            <div className="admin-record-content"><div className="admin-record-meta"><span>{archive.importMethod === 'html' ? '网页导入' : '链接缓存'}</span><time dateTime={archive.createdAt}>{fullDate(archive.createdAt)}</time></div><h3><Link to={`/c/${archive.id}`} target="_blank" rel="noopener noreferrer">{archive.title}<ArrowUpRight size={16} /></Link></h3><p className="admin-excerpt">{archive.excerpt}</p><p className="admin-source">{archive.sourceUrl}</p><div className="admin-record-foot"><code>{archive.id}</code><span>{archive.messageCount} 条消息 · {formatBytes(archive.byteSize)}</span></div></div>
            <div className="admin-record-actions"><Link className="button button-white button-small" to={`/c/${archive.id}`} target="_blank" rel="noopener noreferrer">阅读<ArrowUpRight size={14} /></Link><button className="icon-button" aria-label={`复制地址：${archive.title}`} onClick={() => void copyAddress(archive.id)}><Copy size={16} /></button><a className="icon-button" aria-label={`导出 Markdown：${archive.title}`} href={`/api/archives/${archive.id}/export`} download><Download size={16} /></a><button className="icon-button admin-delete" aria-label={`删除缓存：${archive.title}`} disabled={busy} onClick={() => setDeleting(archive)}><Trash2 size={16} /></button></div>
          </article>)}</div> : data ? <div className="admin-empty"><Database size={30} /><h3>{query ? '没有匹配的缓存' : '服务器还没有缓存'}</h3><p>{query ? '换一个关键词，或清空搜索查看全部。' : '用户保存的对话会显示在这里。'}</p></div> : null}
          {data && <nav className="admin-pagination" aria-label="缓存分页"><span>第 {data.page} / {pageCount} 页 · 每页 {data.pageSize} 份</span><div><button className="button button-white button-small" disabled={loading || busy || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} />上一页</button><button className="button button-white button-small" disabled={loading || busy || page >= pageCount} onClick={() => setPage(page + 1)}>下一页<ChevronRight size={15} /></button></div></nav>}
        </section><p className="admin-footer-note">此处仅展示服务器缓存；用户的「最近阅读」保存在其浏览器中，不会上传至管理端。</p>
      </>}
    </main>
    {deleting && <Modal title="永久删除这份缓存？" onClose={() => { if (!busy) setDeleting(null); }}><p className="modal-description">将从服务器删除「{deleting.title}」。该缓存可能属于其他用户，所有持有缓存地址的人都将无法继续访问。此操作不可撤销，不影响原始 ChatGPT 分享。</p><div className="modal-actions"><button className="button button-white" disabled={busy} onClick={() => setDeleting(null)}>再想想</button><button className="button button-danger" disabled={busy} onClick={() => void deleteArchive()}>{busy ? '正在删除…' : '确认永久删除'}</button></div></Modal>}
  </div>;
}
