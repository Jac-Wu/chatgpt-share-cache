import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, CheckCircle2, ChevronRight, Clock3, Copy, Download, FileCode2, Link2, LoaderCircle, MessageSquare, ShieldCheck, Sparkles, Star } from 'lucide-react';
import type { Archive } from '../../shared/types';
import { Brand } from '../components/Brand';
import { Markdown } from '../components/Markdown';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../lib/api';
import { archiveUrl, copyText, errorMessage, fullDate } from '../lib/utils';
import { useLibrary } from '../lib/LibraryContext';
import { demos } from '../demo';
import { useRecentReads } from '../lib/RecentReadsContext';
import { RecentReadsNotice } from '../components/RecentReads';

export function Reader({ demo = false }: { demo?: boolean }) {
  const { id = '' } = useParams();
  const [archive, setArchive] = useState<Archive | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const notify = useToast();
  const { refresh } = useLibrary();
  const { remember, remove } = useRecentReads();
  const example = demo ? demos.find((item) => item.id === id) : undefined;
  const conversation = demo ? example : archive;

  useEffect(() => {
    window.scrollTo(0, 0);
    if (demo) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setArchive(null);
    api.get(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setArchive(result); remember(result); }
    }).catch((failure) => {
      if (!controller.signal.aborted) {
        setError(errorMessage(failure));
        if (failure instanceof ApiError && failure.code === 'ARCHIVE_NOT_FOUND') remove(id);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, demo, attempt, remember, remove]);

  useEffect(() => {
    document.title = conversation ? `${conversation.title} · 拾光` : '对话存档 · 拾光';
    return () => { document.title = '拾光 · ChatGPT 对话存档'; };
  }, [conversation]);

  async function copy(value: string, label = '已复制。') {
    try { await copyText(value); notify(label); }
    catch (failure) { notify(errorMessage(failure), 'error'); }
  }

  async function favorite() {
    if (!archive) return;
    setFavoriteBusy(true);
    try { const updated = await api.favorite(id, !archive.favorite); setArchive(updated); await refresh(); notify(updated.favorite ? '已收藏这段对话。' : '已取消收藏。'); }
    catch (failure) { notify(errorMessage(failure), 'error'); }
    finally { setFavoriteBusy(false); }
  }

  const messageCount = conversation?.messages.length || 0;
  const readingMinutes = Math.max(1, Math.ceil((conversation?.messages.reduce((total, message) => total + message.content.length, 0) || 0) / 600));

  return <div className="reader-page"><header className="reader-topbar"><Brand compact /><Link className="reader-back" to={archive?.isOwner ? '/library' : '/'}><ArrowLeft size={15} />{archive?.isOwner ? '返回工作空间' : '返回首页'}</Link><div className="reader-actions">{archive?.isOwner && <button className={`icon-button ${archive.favorite ? 'is-favorite' : ''}`} aria-label={archive.favorite ? '取消收藏' : '收藏对话'} aria-pressed={archive.favorite} disabled={favoriteBusy} onClick={favorite}><Star size={19} fill={archive.favorite ? 'currentColor' : 'none'} /></button>}{archive && <a className="button button-white button-small reader-export" href={`/api/archives/${id}/export`} download><Download size={15} />导出 Markdown</a>}{demo ? <Link to="/" className="button button-dark button-small">缓存我的对话<ArrowRight size={15} /></Link> : <button className="button button-dark button-small" disabled={!archive} onClick={() => void copy(archiveUrl(id), '缓存地址已复制，拥有地址的人都可以阅读。')}><Link2 size={15} />分享缓存</button>}</div></header>
    {loading ? <main className="reader-loading" aria-busy="true"><LoaderCircle size={28} className="spin" /><h1>正在打开这段灵感…</h1></main> : !conversation || error ? <main className="reader-error"><span className="error-illustration"><FileCode2 size={40} /></span><h1>这段对话，暂时找不到了。</h1><p>{error || '这份阅读示例不存在。'}</p><div><Link to="/" className="button button-dark">返回首页<ArrowRight size={16} /></Link>{!demo && <button className="button button-white" onClick={() => setAttempt(attempt + 1)}>重新加载</button>}</div></main> : <>
      {demo && <div className="demo-banner"><Sparkles size={15} /><span>你正在阅读演示内容，这不是一份真实缓存。</span><Link to="/">开始保存你的对话<ArrowRight size={13} /></Link></div>}
      <main className="reader-container" id="main-content"><div className="reader-layout"><article className="conversation"><header className="conversation-heading"><div className="reader-eyebrow"><span><Bot size={15} />ChatGPT</span><ChevronRight size={12} /><span>{demo ? '阅读示例' : '对话存档'}</span><span className="reader-saved"><span />{demo ? 'DEMO' : '已独立缓存'}</span></div><h1>{conversation.title}</h1><div className="conversation-meta">{archive && <time dateTime={archive.createdAt}><Clock3 size={14} />{fullDate(archive.createdAt)}</time>}<span><MessageSquare size={14} />{messageCount} 条消息</span><span>约 {readingMinutes} 分钟阅读</span></div>{archive && <div className="source-note"><div><ShieldCheck size={17} /><span>这是一份独立文本快照，不随原对话更新。</span></div><a href={archive.sourceUrl} target="_blank" rel="noopener noreferrer">原始分享<ArrowUpRight size={14} /></a></div>}{archive?.importMethod === 'html' && <p className="import-notice"><FileCode2 size={13} />手动导入 · 内容由创建者提供，原始来源未经验证</p>}{archive && archive.warnings.length > 0 && <details className="parse-warnings"><summary>这份缓存的内容说明（{archive.warnings.length}）</summary><ul>{archive.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</header>
        {!demo && <RecentReadsNotice />}
        <div className="message-list">{conversation.messages.map((message, index) => <section key={`${message.id}-${index}`} id={`message-${index}`} className={`message message-${message.role}`} aria-label={message.role === 'user' ? '用户消息' : 'ChatGPT 回复'}><div className="message-heading"><span className={`message-avatar avatar-${message.role}`}>{message.role === 'user' ? '你' : <Bot size={19} />}</span><strong>{message.role === 'user' ? '你' : 'ChatGPT'}</strong>{message.role === 'assistant' && <span className="assistant-label">ASSISTANT</span>}<button className="icon-button message-copy" aria-label={`复制第 ${index + 1} 条消息`} onClick={() => void copy(message.content, '消息内容已复制。')}><Copy size={15} /></button></div><div className="message-content"><Markdown content={message.content} /></div></section>)}</div>
        <footer className="conversation-end"><div><span /><CheckCircle2 size={17} /><span /></div><p>对话有终点，思考没有。</p><small>{demo ? '喜欢这样的阅读体验？把你的好对话也留下来。' : '已保存的文本到这里结束。图片、附件与外部资源未缓存。'}</small><Link to="/">{demo ? '缓存我的第一段对话' : '回到我的灵感空间'}<ArrowRight size={14} /></Link></footer>
      </article><aside className="conversation-toc"><span className="toc-caption">这段对话</span><a href="#main-content" className="toc-title">开始阅读</a>{conversation.messages.map((message, index) => message.role === 'user' && <a key={`${message.id}-${index}`} href={`#message-${index}`}><span>{String(conversation.messages.slice(0, index + 1).filter((item) => item.role === 'user').length).padStart(2, '0')}</span><span>{message.content.slice(0, 45)}</span></a>)}<div className="toc-note"><LayersIcon /><p>每一个好问题，<br />都值得被记住。</p></div></aside></div></main><footer className="reader-footer"><Brand compact /><span>留住对话，让思考继续。</span><span>独立缓存 · 非 OpenAI 官方产品</span></footer>
    </>}
  </div>;
}

function LayersIcon() {
  return <Sparkles size={19} strokeWidth={1.5} />;
}
