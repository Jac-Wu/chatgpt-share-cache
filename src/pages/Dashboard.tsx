import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArrowRight, ArrowUpRight, Bot, ChevronDown, CircleAlert, Clock3, Code2, Database, Grid2X2, Layers3, LayoutList, Lightbulb, MessageSquare, Plus, SearchX, ShieldCheck, Sparkles, Star, WandSparkles } from 'lucide-react';
import { ArchiveForm } from '../components/ArchiveForm';
import { ArchiveCard } from '../components/ArchiveCard';
import { useWorkspace } from '../components/WorkspaceLayout';
import { useLibrary } from '../lib/LibraryContext';
import { formatBytes } from '../lib/utils';
import { demos } from '../demo';
import { RecentReads } from '../components/RecentReads';

function HeroArt() {
  return <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-dot dot-one" /><span className="art-dot dot-two" /><div className="art-paper paper-back"><span /><span /><span /></div><div className="art-paper paper-front"><span className="art-bot"><Bot size={20} /></span><div className="art-lines"><i /><i /><i /></div><div className="art-paper-footer"><span /><Star size={12} /></div></div><div className="art-saved"><ShieldCheck size={14} /><span>灵感，已妥善保存</span></div><Sparkles className="art-spark" size={22} /></div>;
}

function EmptyState({ filtered, favorite, onCreate }: { filtered: boolean; favorite: boolean; onCreate: () => void }) {
  return <div className="empty-state"><div className="empty-art" aria-hidden="true"><span className="empty-sheet empty-sheet-back" /><span className="empty-sheet">{filtered ? <SearchX size={27} /> : favorite ? <Star size={27} /> : <Archive size={27} />}<i /><i /></span><span className="empty-plus">{filtered ? '?' : '+'}</span></div><div><h3>{filtered ? '还没找到这段对话' : favorite ? '给喜欢的对话，一颗星。' : '你的灵感收藏，从这里开始。'}</h3><p>{filtered ? '换一个关键词，试试搜索标题、摘要或原始链接。' : favorite ? '点击缓存卡片上的星标，值得重读的内容就会出现在这里。' : '保存一次深度思考、一个巧妙解法，或一瞬间的灵感。'}</p><div className="empty-actions">{!filtered && !favorite && <button className="text-button" onClick={onCreate}>缓存第一段对话<ArrowRight size={15} /></button>}{!filtered && <Link to={favorite ? '/library' : '/demo/ideas'} className="subtle-link">{favorite ? '浏览全部缓存' : '先看看阅读效果'}<ArrowUpRight size={14} /></Link>}</div></div></div>;
}

export function Dashboard({ view = 'overview' }: { view?: 'overview' | 'library' | 'favorites' }) {
  const { data, loading, error, refresh } = useLibrary();
  const { query } = useWorkspace();
  const navigate = useNavigate();
  const [sort, setSort] = useState('newest');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const overview = view === 'overview';
  const favorite = view === 'favorites';
  const keyword = query.trim().toLowerCase();
  const filtered = data.archives.filter((archive) => (!favorite || archive.favorite) && (!keyword || [archive.title, archive.excerpt, archive.sourceUrl].some((value) => value.toLowerCase().includes(keyword)))).sort((first, second) => {
    if (sort === 'oldest') return first.createdAt.localeCompare(second.createdAt);
    if (sort === 'messages') return second.messageCount - first.messageCount;
    return second.createdAt.localeCompare(first.createdAt);
  });
  const displayed = overview && !keyword ? filtered.slice(0, 6) : filtered;

  function focusCapture() {
    if (!overview) { navigate('/#new-archive'); return; }
    document.getElementById('new-archive')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('share-url')?.focus({ preventScroll: true });
  }

  return <main className="dashboard" id="main-content">
    {overview ? <section className="hero"><div className="hero-copy"><span className="eyebrow"><span />A HOME FOR YOUR IDEAS</span><h1>好对话，<span>值得被留住。</span></h1><p>把 ChatGPT 里的灵光一现，变成随时可回看的珍藏。</p></div><HeroArt /></section> : <section className="library-hero"><div><span className="eyebrow">{favorite ? 'YOUR PERSONAL FAVORITES' : 'YOUR CONVERSATION COLLECTION'}</span><h1>{favorite ? '收藏的，都值得重读。' : '你的每一段好对话。'}</h1><p>{favorite ? '在这里，重新遇见让你眼前一亮的思考。' : '整理思考的片段，让知识慢慢长出自己的形状。'}</p></div><Link to="/#new-archive" className="button button-dark"><Plus size={17} />新建缓存</Link></section>}
    {overview && <ArchiveForm />}
    {overview && <section className="stats-grid" aria-label="缓存统计"><div className="stat-card"><span className="stat-icon stat-peach"><Archive size={21} /></span><div><span className="stat-label">已留住的对话</span><div className="stat-value">{loading ? '—' : data.stats.total}<small>份存档</small></div></div><span className="stat-decoration"><Layers3 size={34} /></span></div><div className="stat-card"><span className="stat-icon stat-lavender"><MessageSquare size={21} /></span><div><span className="stat-label">积累的思考</span><div className="stat-value">{loading ? '—' : data.stats.messages}<small>条消息</small></div></div><span className="stat-decoration"><Sparkles size={34} /></span></div><div className="stat-card"><span className="stat-icon stat-sage"><Database size={21} /></span><div><span className="stat-label">缓存的内容</span><div className="stat-value stat-size">{loading ? '—' : formatBytes(data.stats.bytes)}<small>文本数据</small></div></div><span className="stat-decoration"><ShieldCheck size={34} /></span></div></section>}
    {overview && <RecentReads preview query={query} />}
    <section className="archives-section" aria-labelledby="archives-title"><div className="section-heading"><div className="section-title"><h2 id="archives-title">{keyword ? '搜索结果' : favorite ? '星标收藏' : overview ? '最近缓存' : '全部缓存'}</h2><span className="section-count">{loading ? '…' : filtered.length}</span>{overview && !keyword && <span className="section-description">每一次回看，都有新收获</span>}</div><div className="section-tools"><label className="sort-select"><Clock3 size={14} /><select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">最近保存</option><option value="oldest">最早保存</option><option value="messages">消息最多</option></select><ChevronDown size={12} /></label><div className="view-switch"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="网格视图" aria-pressed={layout === 'grid'}><Grid2X2 size={15} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="列表视图" aria-pressed={layout === 'list'}><LayoutList size={16} /></button></div></div></div>
      {error ? <div className="load-error" role="alert"><CircleAlert size={24} /><h3>暂时无法读取你的空间</h3><p>{error}</p><button className="button button-white" onClick={() => void refresh()}>重新连接</button></div> : loading ? <div className="archive-grid" aria-label="正在加载缓存" aria-busy="true">{[1, 2, 3].map((index) => <div className="skeleton-card" key={index}><span /><span /><span /><span /></div>)}</div> : displayed.length ? <div className={`archive-grid ${layout === 'list' ? 'archive-list' : ''}`}>{displayed.map((archive) => <ArchiveCard archive={archive} key={archive.id} />)}</div> : <EmptyState filtered={!!keyword} favorite={favorite} onCreate={focusCapture} />}
      {overview && !keyword && filtered.length > 6 && <Link to="/library" className="view-all">查看全部 {filtered.length} 份缓存<ArrowRight size={15} /></Link>}
    </section>
    {overview && !keyword && <section className="inspiration-section"><div className="section-heading"><div className="section-title"><h2>灵感陈列室</h2><span className="section-description">先看看，一段对话可以留下什么</span></div><span className="demo-label">示例内容 · 非真实缓存</span></div><div className="demo-grid">{demos.map((demo, index) => <Link key={demo.id} to={`/demo/${demo.id}`} className={`demo-card demo-${demo.color}`}><div className="demo-card-heading"><span className="demo-icon">{index === 0 ? <Lightbulb size={22} /> : index === 1 ? <WandSparkles size={22} /> : <Code2 size={22} />}</span><span>{demo.category}</span><ArrowUpRight size={17} /></div><h3>{demo.title}</h3><p>{demo.description}</p><span className="demo-open">打开阅读示例<ArrowRight size={13} /></span><span className="demo-card-shape" /></Link>)}</div></section>}
    {overview && <div className="bottom-note"><ShieldCheck size={14} /><span>缓存保存在当前服务器 · 访问地址持有者可阅读 · 不下载图片与附件</span></div>}
  </main>;
}
