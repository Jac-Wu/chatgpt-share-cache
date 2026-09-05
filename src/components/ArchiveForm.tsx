import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, Clipboard, Copy, FileCode2, Globe2, Link2, LoaderCircle, LockKeyhole, Plus, Upload, X } from 'lucide-react';
import type { CreateArchiveResult } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { copyText, errorMessage, formatBytes } from '../lib/utils';
import { useLibrary } from '../lib/LibraryContext';
import { useToast } from './Toast';

export function ArchiveForm() {
  const [mode, setMode] = useState<'link' | 'html'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offerImport, setOfferImport] = useState(false);
  const [result, setResult] = useState<CreateArchiveResult | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { refresh, loading: libraryLoading, error: libraryError } = useLibrary();
  const notify = useToast();

  function chooseFile(selected?: File) {
    if (!selected) return;
    if (!/\.html?$/i.test(selected.name)) { setFile(null); setError('请选择 .html 或 .htm 格式的网页文件。'); return; }
    if (selected.size > 8 * 1024 * 1024) { setFile(null); setError('网页文件不能超过 8 MB。'); return; }
    setFile(selected); setError(''); setResult(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setOfferImport(false); setResult(null); setCopied(false);
    if (!url.trim()) { setError('先粘贴一个 ChatGPT 公开分享链接吧。'); input.current?.focus(); return; }
    if (mode === 'html' && !file) { setError('请选择已经保存的 HTML 网页文件。'); return; }
    setBusy(true);
    try {
      const html = mode === 'html' ? await file!.text() : undefined;
      const saved = await api.create(url.trim(), html);
      setResult(saved);
      await refresh();
      notify(saved.cached ? '这段对话已在你的空间，直接打开就好。' : '已留住这段好对话。');
    } catch (failure) {
      setError(errorMessage(failure));
      setOfferImport(mode === 'link' && failure instanceof ApiError && ['UPSTREAM_BLOCKED', 'UPSTREAM_CHALLENGE', 'FETCH_TIMEOUT', 'FETCH_FAILED', 'PARSE_FAILED'].includes(failure.code));
    } finally { setBusy(false); }
  }

  async function paste() {
    try { setUrl(await navigator.clipboard.readText()); setResult(null); input.current?.focus(); }
    catch { notify('浏览器未允许读取剪贴板，请直接粘贴到输入框。', 'error'); input.current?.focus(); }
  }

  async function copyResult() {
    if (!result) return;
    try { await copyText(result.cacheUrl); setCopied(true); notify('缓存地址已复制，可以分享了。'); }
    catch (failure) { notify(errorMessage(failure), 'error'); }
  }

  return <section className="capture-panel" id="new-archive" aria-labelledby="capture-title">
    <div className="capture-heading"><div className="capture-heading-left"><span className="capture-icon"><Plus size={21} /></span><div><h2 id="capture-title">留住一段新对话</h2><p>一个链接，让灵感随时可回看。</p></div></div><div className="mode-switch" aria-label="导入方式"><button type="button" className={mode === 'link' ? 'active' : ''} disabled={busy} onClick={() => { setMode('link'); setError(''); }}><Link2 size={14} />粘贴链接</button><button type="button" className={mode === 'html' ? 'active' : ''} disabled={busy} onClick={() => { setMode('html'); setError(''); }}><FileCode2 size={14} />导入网页</button></div></div>
    <form onSubmit={submit} noValidate>
      <div className={`url-input-shell ${error ? 'input-has-error' : ''}`}><Link2 size={20} className="url-icon" /><input id="share-url" ref={input} value={url} onChange={(event) => { setUrl(event.target.value); setError(''); setResult(null); }} placeholder="粘贴 ChatGPT 分享链接，支持 /share/… 和 /s/t_…" aria-label="ChatGPT 分享链接" aria-invalid={!!error} aria-describedby={error ? 'capture-error' : 'capture-hint'} autoComplete="off" spellCheck={false} disabled={busy} /><button className="paste-button icon-button" type="button" onClick={paste} disabled={busy} title="从剪贴板粘贴" aria-label="从剪贴板粘贴"><Clipboard size={17} /></button><button type="submit" className="button button-dark capture-submit" disabled={busy || libraryLoading || !!libraryError}>{busy ? <><LoaderCircle size={17} className="spin" />正在保存</> : <>{mode === 'html' ? '导入并缓存' : '解析并缓存'}<ArrowRight size={17} /></>}</button></div>
      {mode === 'html' && <div className={`file-drop ${dragging ? 'file-dragging' : ''} ${file ? 'file-selected' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
        <input type="file" ref={fileInput} accept=".html,.htm,text/html" className="visually-hidden" aria-label="选择 HTML 网页文件" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" className="file-choose" disabled={busy} onClick={() => fileInput.current?.click()}>{file ? <FileCode2 size={24} /> : <Upload size={24} />}<span><strong>{file ? file.name : '点击选择，或将 HTML 网页拖到这里'}</strong><small>{file ? `${formatBytes(file.size)} · 文件仅用于提取对话，不公开原始 HTML` : '在原分享页使用浏览器「另存为」保存网页 · 最大 8 MB'}</small></span></button>
        {file && <button type="button" className="icon-button" aria-label="移除文件" disabled={busy} onClick={() => setFile(null)}><X size={17} /></button>}
      </div>}
      {busy && <div className="capture-progress" role="status"><span className="progress-track"><span /></span><span>{mode === 'html' ? '正在提取对话并写入缓存，请稍候…' : '正在读取公开分享并解析对话，请稍候…'}</span></div>}
      {error && <div className="form-error" role="alert" id="capture-error"><span>{error}</span>{offerImport && <button type="button" onClick={() => { setMode('html'); setError(''); }}>改用网页导入 <ArrowRight size={13} /></button>}</div>}
      <div className="capture-hint" id="capture-hint"><span><LockKeyhole size={12} />仅解析公开分享，不读取你的 ChatGPT 账户</span><span><Globe2 size={12} />无需 API Key</span></div>
    </form>
    {result && <div className="capture-result" role="status"><div className="result-heading"><CheckCircle2 size={20} /><div><strong>{result.cached ? '这段灵感，已经好好保存。' : '缓存成功，灵感有了新地址。'}</strong><p>{result.archive.title} · {result.archive.messageCount} 条消息</p></div></div><div className="result-link"><input readOnly value={result.cacheUrl} aria-label="缓存访问地址" onFocus={(event) => event.currentTarget.select()} /><button type="button" className="button button-white button-small" onClick={copyResult}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制地址'}</button><Link className="button button-green button-small" to={result.cachePath}>打开阅读<ArrowUpRight size={14} /></Link></div><small>拥有此地址的人都能阅读，请谨慎分享。</small></div>}
  </section>;
}
