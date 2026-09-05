import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, CircleAlert, Clock3, Copy, History, MessageSquare, Monitor, SearchX, Trash2, X } from 'lucide-react';
import { useRecentReads } from '../lib/RecentReadsContext';
import { MAX_RECENT_READS, type RecentRead } from '../lib/recent-reads';
import { archiveUrl, copyText, errorMessage, fullDate, shortDate } from '../lib/utils';
import { useToast } from './Toast';
import { Modal } from './Modal';

export function RecentReadsNotice() {
  const { persistent } = useRecentReads();
  return persistent ? null : <p className="recent-storage-warning" role="status"><CircleAlert size={15} />浏览器暂时无法保存阅读记录，仅在当前标签页内保留，刷新后可能丢失。请允许本站使用本地存储。</p>;
}

function RecentReadCard({ entry }: { entry: RecentRead }) {
  const { remove } = useRecentReads();
  const notify = useToast();

  async function copy() {
    try { await copyText(archiveUrl(entry.id)); notify('缓存地址已复制。'); }
    catch (failure) { notify(errorMessage(failure), 'error'); }
  }

  return <article className="recent-read-card">
    <div className="archive-card-top"><span className="recent-read-badge"><BookOpen size={18} />读过的对话</span><div className="card-actions"><button className="icon-button" aria-label={`复制阅读地址：${entry.title}`} onClick={() => void copy()}><Copy size={15} /></button><button className="icon-button" aria-label={`移除阅读记录：${entry.title}`} title="仅移除本机阅读记录，不删除缓存" onClick={() => remove(entry.id)}><X size={17} /></button></div></div>
    <Link to={`/c/${entry.id}`} className="archive-content"><h3>{entry.title}</h3><p>{entry.excerpt || '一段值得重读的好对话。'}</p></Link>
    <div className="archive-meta"><span><MessageSquare size={13} />{entry.messageCount} 条消息</span><span><Monitor size={13} />本机记录</span></div>
    <div className="archive-card-bottom"><span className="recent-read-time"><Clock3 size={12} />上次阅读<time dateTime={entry.lastReadAt} title={fullDate(entry.lastReadAt)}>{shortDate(entry.lastReadAt)}</time></span><Link to={`/c/${entry.id}`} className="card-open" aria-label={`继续阅读：${entry.title}`}><ArrowUpRight size={18} /></Link></div>
  </article>;
}

export function RecentReads({ preview = false, query = '' }: { preview?: boolean; query?: string }) {
  const { entries, persistent, clear } = useRecentReads();
  const [confirm, setConfirm] = useState(false);
  const keyword = query.trim().toLowerCase();
  const filtered = entries.filter((entry) => !keyword || `${entry.title} ${entry.excerpt}`.toLowerCase().includes(keyword));
  const displayed = preview ? filtered.slice(0, 6) : filtered;
  if (preview && !entries.length && persistent) return null;

  return <section className="recent-reads-section" aria-labelledby="recent-reads-title">
    <div className="section-heading"><div className="section-title"><h2 id="recent-reads-title">最近阅读</h2><span className="section-count">{filtered.length}</span><span className="section-description">读过的好对话，随时接着看</span></div><div className="section-tools">{preview ? <Link to="/recent" className="text-button">查看全部<ArrowRight size={14} /></Link> : entries.length > 0 && <button className="text-button recent-clear" onClick={() => setConfirm(true)}><Trash2 size={14} />清空阅读记录</button>}</div></div>
    <p className="recent-reads-description"><Monitor size={14} />仅保存在当前浏览器、当前站点，最多 {MAX_RECENT_READS} 条；不会加入你的服务器缓存列表。</p>
    <RecentReadsNotice />
    {displayed.length ? <div className="archive-grid recent-reads-grid">{displayed.map((entry) => <RecentReadCard key={entry.id} entry={entry} />)}</div> : <div className="recent-reads-empty">{keyword ? <SearchX size={28} /> : <History size={28} />}<h3>{keyword ? '没有匹配的阅读记录' : '还没有阅读记录'}</h3><p>{keyword ? '试试搜索对话标题或摘要。' : '打开一份缓存阅读后，这里会自动留下记录。示例和未能打开的页面不会记录。'}</p></div>}
    {!preview && <p className="recent-reads-footnote">移除记录不会删除服务器缓存；若原缓存被删除，阅读记录也无法恢复正文。</p>}
    {confirm && <Modal title="清空本机阅读记录？" onClose={() => setConfirm(false)}><p className="modal-description">将移除当前浏览器在本站保存的全部阅读记录，不会删除任何服务器缓存，也不会影响其他浏览器。</p><div className="modal-actions"><button className="button button-white" onClick={() => setConfirm(false)}>再想想</button><button className="button button-danger" onClick={() => { clear(); setConfirm(false); }}>确认清空</button></div></Modal>}
  </section>;
}
