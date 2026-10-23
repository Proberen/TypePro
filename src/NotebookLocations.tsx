import { ArrowDown, Check, FolderOpen } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import Modal from './Modal';
import { command, getNotebookLocation, pickNotebookDirectory, type NotebookLocation } from './lib/bridge';
import type { Notebook } from './lib/types';
import './notebook-locations.css';

export function directoryError(path: string | null) {
  if (path === null) return '';
  if (!path.trim()) return '请选择本地目录，或使用默认目录。';
  if (!/^(\/|~\/).+/.test(path.trim()) || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return '请输入以 / 或 ~/ 开头的完整目录。';
  return '';
}

export function NotebookDirectoryField({ value, onChange, disabled = false }: { value: string | null; onChange: (value: string | null) => void; disabled?: boolean }) {
  const id = useId();
  const [error, setError] = useState('');
  async function choose() {
    setError('');
    try { const path = await pickNotebookDirectory(); if (path) onChange(path); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  }
  return <fieldset className="notebook-location-field" disabled={disabled}>
    <legend className="field">存储目录</legend>
    <div className="notebook-location-choices">
      <label><input type="radio" name={id} checked={value === null} onChange={() => { onChange(null); setError(''); }} />默认目录</label>
      <label><input type="radio" name={id} checked={value !== null} onChange={() => { onChange(''); setError(''); }} />自定义目录</label>
    </div>
    {value !== null && <><div className="notebook-location-input"><FolderOpen size={17}/><input className="field-input" aria-label="笔记本地目录" placeholder="~/Documents/我的笔记" value={value} onChange={e => { onChange(e.target.value); setError(''); }} spellCheck={false} autoComplete="off"/><button type="button" className="btn outline" onClick={() => void choose()}>选择文件夹</button></div><p className="muted notebook-location-hint">选择空文件夹，或这本笔记之前使用的文件夹。</p></>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </fieldset>;
}

export default function NotebookLocations({ notebook, onMigrate, onClose, initialError = '' }: { initialError?: string; notebook: Notebook; onMigrate: (path: string | null) => Promise<NotebookLocation>; onClose: () => void }) {
  const [location, setLocation] = useState<NotebookLocation | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [step, setStep] = useState<'settings' | 'choose' | 'review' | 'done'>('settings');
  const [error, setError] = useState(initialError);
  const [defaultPath, setDefaultPath] = useState('应用默认目录');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void Promise.all([getNotebookLocation(notebook.id), command<string>('get_storage_path')]).then(([value, root]) => { if (alive) setDefaultPath(root); if (alive) { setLocation(value); setCandidate(value.custom ? value.path : null); } }, e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [notebook.id]);
  function review() { const issue = directoryError(candidate); setError(issue); if (!issue) setStep('review'); }
  async function confirm() { setBusy(true); setError(''); try { const next = await onMigrate(candidate?.trim() ?? null); setLocation(next); setStep('done'); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); } }
  const title = { settings: '笔记设置', choose: '更改存储目录', review: '迁移笔记', done: '目录已更新' }[step];
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
    {loading ? <p className="muted">正在读取目录…</p> : location && <>
      {step === 'settings' && <><div className="notebook-location-book"><FolderOpen size={24}/><div><h3>{notebook.name}</h3><p className="muted">{notebook.documents.length} 篇文档</p></div></div><h3 className="notebook-location-label">存储目录</h3><div className="notebook-location-path"><span>{location.custom ? '自定义' : '默认'}</span><code>{location.path}</code></div><button type="button" className="btn outline notebook-location-change" onClick={() => setStep('choose')}><FolderOpen size={16}/>更改目录</button></>}
      {step === 'choose' && <NotebookDirectoryField value={candidate} onChange={value => { setCandidate(value); setError(''); }} disabled={busy}/>}
      {step === 'review' && <><p className="muted">{notebook.name} · {notebook.documents.length} 篇文档</p><div className="notebook-location-route"><span>当前目录</span><code>{location.path}</code><ArrowDown size={19}/><span>新目录</span><code>{candidate === null ? defaultPath : candidate.trim()}</code></div><p className="notebook-location-retain">迁移后使用新目录，旧目录保留原文件。</p></>}
      {step === 'done' && <><div className="notebook-location-success"><Check size={24}/></div><h3 className="notebook-location-complete">{notebook.name}</h3><div className="notebook-location-path"><code>{location.path}</code></div><p className="notebook-location-retain">笔记与附件已迁移，旧目录原文件保留。</p></>}
    </>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="form-actions">
      {step === 'review' ? <><button className="btn outline" disabled={busy} onClick={() => { setStep('choose'); setError(''); }}>返回</button><button className="btn primary" disabled={busy} onClick={() => void confirm()}>{busy ? '迁移中…' : '确认迁移'}</button></> : step === 'choose' ? <><button className="btn outline" onClick={() => { setStep('settings'); setError(''); }}>取消</button><button className="btn primary" onClick={review}>下一步</button></> : <button className="btn primary" onClick={onClose}>完成</button>}
    </div>
  </Modal>;
}
