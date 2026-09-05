import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Copy, Download, FileCode2, Link2, MessageSquare, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import type { ArchiveSummary } from '../../shared/types';
import { api } from '../lib/api';
import { archiveUrl, copyText, errorMessage, shortDate } from '../lib/utils';
import { useLibrary } from '../lib/LibraryContext';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { useRecentReads } from '../lib/RecentReadsContext';

export function ArchiveCard({ archive }: { archive: ArchiveSummary }) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const { refresh } = useLibrary();
  const { remove: removeReading } = useRecentReads();
  const notify = useToast();

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [menu]);

  async function favorite() {
    setBusy(true);
    try { await api.favorite(archive.id, !archive.favorite); await refresh(); notify(archive.favorite ? '已从收藏中移除。' : '已收藏，下次更容易找到。'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await api.remove(archive.id); removeReading(archive.id); setConfirm(false); await refresh(); notify('缓存已删除，原始分享不受影响。'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(false); }
  }

  async function copy() {
    try { await copyText(archiveUrl(archive.id)); notify('缓存地址已复制。'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    setMenu(false);
  }

  return <article className="archive-card">
    <div className="archive-card-top"><span className="chatgpt-badge"><Bot size={20} /><span>ChatGPT</span></span><div className="card-actions"><button className={`icon-button favorite-button ${archive.favorite ? 'is-favorite' : ''}`} aria-label={archive.favorite ? `取消收藏：${archive.title}` : `收藏：${archive.title}`} aria-pressed={archive.favorite} onClick={favorite} disabled={busy}><Star size={17} fill={archive.favorite ? 'currentColor' : 'none'} /></button><div className="menu-anchor" ref={container}><button className="icon-button" onClick={() => setMenu(!menu)} aria-label={`更多操作：${archive.title}`} aria-expanded={menu}><MoreHorizontal size={19} /></button>{menu && <div className="card-menu"><button onClick={copy}><Copy size={15} />复制缓存地址</button><a href={`/api/archives/${archive.id}/export`} download onClick={() => setMenu(false)}><Download size={15} />导出 Markdown</a><button className="text-danger" onClick={() => { setMenu(false); setConfirm(true); }}><Trash2 size={15} />删除缓存</button></div>}</div></div></div>
    <Link to={`/c/${archive.id}`} className="archive-content"><h3>{archive.title}</h3><p>{archive.excerpt || '一段值得重读的好对话。'}</p></Link>
    <div className="archive-meta"><span><MessageSquare size={13} />{archive.messageCount} 条消息</span><span>{archive.importMethod === 'html' ? <FileCode2 size={13} /> : <Link2 size={13} />}{archive.importMethod === 'html' ? '网页导入' : '链接缓存'}</span></div>
    <div className="archive-card-bottom"><span className="saved-status"><span />已缓存<time dateTime={archive.createdAt}>{shortDate(archive.createdAt)}</time></span><Link to={`/c/${archive.id}`} className="card-open" aria-label={`阅读：${archive.title}`}><ArrowUpRight size={18} /></Link></div>
    {confirm && <Modal title="删除这份缓存？" onClose={() => { if (!busy) setConfirm(false); }}><p className="modal-description">「{archive.title}」将从服务器删除，已有缓存地址也会失效。原始 ChatGPT 分享不会受影响，此操作无法撤销。</p><div className="modal-actions"><button className="button button-white" disabled={busy} onClick={() => setConfirm(false)}>再想想</button><button className="button button-danger" disabled={busy} onClick={remove}>{busy ? '正在删除…' : '确认删除'}</button></div></Modal>}
  </article>;
}
