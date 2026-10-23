import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import { PluginError, type PluginDialog } from './contracts';

interface Request { pluginId: string; pluginName: string; dialog: PluginDialog; finish: (result: string | boolean) => void }
export function usePluginDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  const showDialog = useCallback((pluginId: string, pluginName: string, dialog: PluginDialog, signal: AbortSignal) => {
    if (signal.aborted) return Promise.reject(new PluginError('CANCELLED', '操作已取消'));
    if (pending.current) return Promise.reject(new PluginError('LIMIT_EXCEEDED', '请先处理当前插件的确认窗口'));
    return new Promise<string | boolean>(resolve => {
      const abort = () => entry.finish(false);
      const entry: Request = { pluginId, pluginName, dialog, finish(result) {
        if (pending.current !== entry) return;
        signal.removeEventListener('abort', abort); pending.current = null; setRequest(null); resolve(result);
      } };
      pending.current = entry; signal.addEventListener('abort', abort, { once: true }); setRequest(entry);
    });
  }, []);
  const cancelDialogs = useCallback((pluginId: string) => { if (pending.current?.pluginId === pluginId) pending.current.finish(false); }, []);
  useEffect(() => () => { pending.current?.finish(false); }, []);
  return { showDialog, cancelDialogs, element: request ? <PluginDialogView key={`${request.pluginId}:${request.dialog.kind}`} request={request}/> : null };
}
function PluginDialogView({ request }: { request: Request }) {
  const [value, setValue] = useState('');
  const dialog = request.dialog;
  return <Modal title={dialog.title} wide={dialog.kind === 'review'} onClose={() => request.finish(false)}>
    <p className="plugin-trusted-label">TypePro · {request.pluginName}</p>
    {dialog.kind === 'secret' ? <form onSubmit={event => { event.preventDefault(); if (value.trim()) request.finish(value.trim()); }}>
      <p className="plugin-dialog-origin">{dialog.origin}</p><label className="field" htmlFor="plugin-secret-input">访问密钥</label>
      <input id="plugin-secret-input" className="field-input" type="password" autoFocus autoComplete="off" spellCheck={false} value={value} onChange={event => setValue(event.target.value)} required/>
      <p className="muted">仅保存在此设备，不同步到 GitHub。</p>
      <div className="form-actions"><button type="button" className="btn outline" onClick={() => request.finish(false)}>取消</button><button className="btn primary" disabled={!value.trim()}>保存</button></div>
    </form> : <>
      {dialog.kind === 'confirm' ? <p className="dialog-copy">{dialog.message}</p> : <div className="plugin-review-grid"><section><h3>修改前</h3><pre>{dialog.before || '空文档'}</pre></section><section><h3>修改后</h3><pre>{dialog.after}</pre></section></div>}
      <div className="form-actions"><button className="btn outline" onClick={() => request.finish(false)}>取消</button><button className="btn primary" onClick={() => request.finish(true)}>{dialog.kind === 'review' ? '确认写入' : '允许'}</button></div>
    </>}
  </Modal>;
}
