import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownUp, BookOpen, CheckCircle2, ChevronDown, FileText, FolderOpen, GitBranch, Eye, Pencil, ListTree, Home as HomeIcon, Info, Keyboard, MoreHorizontal, Palette, PanelLeft, Plus, Puzzle, Search, Trash2, Upload, X } from 'lucide-react';
import Sidebar from './Sidebar';
import Outline from './Outline';
import NotebookLocations, { NotebookDirectoryField, directoryError } from './NotebookLocations';
import Modal from './Modal';
import Home from './Home';
import ThemeSettings, { useAppearance } from './ThemeSettings';
import CoverPicker from './CoverPicker';
import About from './About';
import { useAppUpdates } from './updates/useAppUpdates';
import AppUpdateNotice from './updates/AppUpdateNotice';
import GithubSync from './sync/GithubSync';
import { useGithubSync } from './sync/useGithubSync';
import Shortcuts, { APP_SHORTCUTS, shortcutHint } from './Shortcuts';
import MarkdownEditor, { type EditorHandle, type EditorHeading } from './editor/MarkdownEditor';
import { EDITOR_SHORTCUTS, matchesEditorShortcut } from './editor/commands';
import { PluginHost, PluginManager } from './plugins';
import type { PluginView } from './plugins/PluginHost';
import { PluginActions, PluginSurface } from './plugins/PluginSurface';
import PluginSidebar, { PluginSidebarActions, readPluginSidebarState, savePluginSidebarState } from './plugins/PluginSidebar';
import { usePluginDialogs } from './plugins/PluginDialogs';
import { PluginError } from './plugins/contracts';
import { getPluginData, putPluginData, removePluginData, recordInstallation } from './plugins/state';
import { restoreSyncedPlugins } from './plugins/restore';
import { command, native, openLink, pickFile, resolveAsset, saveAsset, uuid, writeTransfer, setNotebookLocation, loadWorkspace } from './lib/bridge';
import { useWorkspace } from './lib/useWorkspace';
import { recordRecentDocument } from './lib/recent';
import type { EditorMode, ExtensionState, JsonValue, NoteDocument, Notebook, TransferFile, Workspace } from './lib/types';


type Dialog=null|{type:'theme'|'plugins'|'shortcuts'|'quick-open'|'about'|'github'}|{type:'transfer',bookId?:string,docId?:string}|{type:'name',kind:'book'|'document'|'rename-book'|'rename-document',bookId?:string,docId?:string,value:string}|{type:'cover',bookId:string}|{type:'delete',bookId:string,docId?:string}|{type:'move',bookId:string,docId:string};
type Context={kind:'home'|'book'|'doc'|'books',bookId?:string,docId?:string,x:number,y:number};
function initialWidth(){try{return Math.max(210,Math.min(380,Number(localStorage.getItem('typepro.sidebar.width'))||264));}catch{return 264;}}

export default function App(){
 const {workspace,current,update,flush,replacePersisted,status,error}=useWorkspace();
 const appUpdates=useAppUpdates(!!workspace);
 const {settings,updateSettings,resetSettings,resolvedTheme}=useAppearance();
 const [view,setView]=useState<'home'|'editor'|'plugin'>('home');
 const [pluginPage,setPluginPage]=useState<PluginView|null>(null);
 const pluginPageRef=useRef<PluginView|null>(null);pluginPageRef.current=pluginPage;
 const [pluginSidebar,setPluginSidebar]=useState(readPluginSidebarState);
 const pluginSidebarRef=useRef(pluginSidebar);pluginSidebarRef.current=pluginSidebar;
 const currentViewRef=useRef(view);currentViewRef.current=view;
 const pluginContext=useRef<string|null>(null),programmaticEdit=useRef(false);
 const {showDialog:showPluginDialog,cancelDialogs,element:pluginDialog}=usePluginDialogs();
 const appearanceRef=useRef({mode:resolvedTheme,accent:settings.accent});
 appearanceRef.current={mode:resolvedTheme,accent:settings.accent};
 const [bookId,setBookId]=useState<string|null>(null),[docId,setDocId]=useState<string|null>(null);
 const modeRef=useRef<EditorMode>('edit');
 const [mode,setMode]=useState<EditorMode>('edit'),[collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[outlineOpen,setOutlineOpen]=useState(false);
 const [width,setWidth]=useState(initialWidth),[mobile,setMobile]=useState(matchMedia('(max-width:700px)').matches),[compact,setCompact]=useState(matchMedia('(max-width:1100px)').matches);
 const [headings,setHeadings]=useState<EditorHeading[]>([]),[dialog,setDialog]=useState<Dialog>(null),[context,setContext]=useState<Context|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[notice,setNotice]=useState(''),[pluginVersion,setPluginVersion]=useState(0),[showPanels,setShowPanels]=useState(false);
 const [cover,setCover]=useState('preset:0'),[transferTab,setTransferTab]=useState<'import'|'export'>('import'),[exportScope,setExportScope]=useState('all'),[exportFormat,setExportFormat]=useState('zip');
 const [locationId,setLocationId]=useState<string|null>(null),[newLocation,setNewLocation]=useState<string|null>(null);
 const allowLocations=!/Android|iPhone|iPad/i.test(navigator.userAgent)&&(!mobile||native);
 const [importFile,setImportFile]=useState<{name:string,bytes:Uint8Array}|null>(null),[quickQuery,setQuickQuery]=useState('');
 const editor=useRef<EditorHandle|null>(null),host=useRef<PluginHost|null>(null),activeRef=useRef<string|null>(null),contextRef=useRef<HTMLDivElement>(null),outlineToggleRef=useRef<HTMLButtonElement>(null);
 const changingPlugins=useRef(false);
 modeRef.current=mode;
 activeRef.current=view==='editor'?docId:view==='plugin'?pluginContext.current:null;
 const activeBook=workspace?.notebooks.find(b=>b.id===bookId),activeDocument=activeBook?.documents.find(d=>d.id===docId);
 const report=useCallback((e:unknown)=>setMessage(e instanceof Error?e.message:String(e)),[]);
 const writeDocument=useCallback((id:string,markdown:string,edit?:{beforePlain:string;afterPlain:string;history?:'undo'|'redo'})=>{
  const previous=current.current?.notebooks.flatMap(b=>b.documents).find(d=>d.id===id);
  if(!previous||previous.markdown===markdown)return;
  const timestamp=new Date().toISOString(),title=markdown.match(/^#\s+([^\r\n]+)/)?.[1]?.trim()||previous.title;
  update(old=>({...old,notebooks:old.notebooks.map(b=>({...b,documents:b.documents.map(d=>d.id===id?{...d,markdown,title,updatedAt:timestamp}:d)}))}));
  host.current?.notifyDocumentChange({documentId:id,title,beforeMarkdown:previous.markdown,afterMarkdown:markdown,...edit,origin:edit&&!programmaticEdit.current?'human':'plugin',timestamp,transactionId:uuid()});
 },[current,update]);
 const collect=useCallback(()=>{const id=activeRef.current;if(!id||!editor.current)return;const value=editor.current.getValue();const doc=current.current?.notebooks.flatMap(b=>b.documents).find(d=>d.id===id);if(doc&&value!==doc.markdown)writeDocument(id,value);},[current,writeDocument]);
 const persist=useCallback(async()=>{collect();await flush();},[collect,flush]);
 const applySynced=useCallback((notebooks:Notebook[],extensions?:ExtensionState)=>{
  const id=activeRef.current,previous=current.current?.notebooks.flatMap(book=>book.documents)||[];
  update(old=>({...old,notebooks,extensions}));
  for(const before of previous){const after=notebooks.flatMap(book=>book.documents).find(doc=>doc.id===before.id);if(before.markdown!==after?.markdown)host.current?.notifyDocumentChange({documentId:before.id,title:after?.title||before.title,beforeMarkdown:before.markdown,afterMarkdown:after?.markdown||'',origin:'sync',timestamp:new Date().toISOString(),transactionId:uuid()});}
  host.current?.notifyStorage();
  if(id){const book=notebooks.find(b=>b.documents.some(d=>d.id===id));if(book)setBookId(book.id);else{setView('home');setBookId(null);setDocId(null);activeRef.current=null;editor.current=null;setHeadings([]);}}
 },[current,update]);
 const github=useGithubSync({current,ready:!!workspace,collect,flush,apply:applySynced});
 const syncLabel=github.state.status==='syncing'?'同步中…':github.state.status==='offline'?'离线':github.state.status==='error'?'同步失败':'GitHub 同步';
 useEffect(()=>{const phone=matchMedia('(max-width:700px)'),small=matchMedia('(max-width:1100px)');const change=()=>{setMobile(phone.matches);setCompact(small.matches);};phone.addEventListener('change',change);small.addEventListener('change',change);return()=>{phone.removeEventListener('change',change);small.removeEventListener('change',change);};},[]);
 useEffect(()=>{try{localStorage.setItem('typepro.sidebar.width',String(width));}catch{}},[width]);
 useEffect(()=>savePluginSidebarState(pluginSidebar),[pluginSidebar]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2600);return()=>clearTimeout(timer);},[notice]);
 const listPluginData=useCallback((pluginId:string,prefix:string)=>
  (current.current?.extensions?.entries||[]).filter(entry=>entry.pluginId===pluginId&&!entry.deleted&&entry.key.startsWith(prefix)).map(entry=>({key:entry.key,value:getPluginData(current.current?.extensions,pluginId,entry.key)})),[current]);
 const setPluginData=useCallback(async(pluginId:string,key:string,value:unknown,remove=false)=>{
  if(!host.current?.hasPermission(pluginId,'storage'))throw new Error('插件已停用或没有存储权限');
  update(old=>({...old,extensions:remove?removePluginData(old.extensions,pluginId,key):putPluginData(old.extensions,pluginId,key,value as JsonValue)}));
  await flush();
 },[update,flush]);
 const openPluginView=useCallback((page:PluginView)=>{
  if(page.slot==='editor.sidebar'){
   if(currentViewRef.current!=='editor')throw new PluginError('NOT_FOUND','请先打开笔记');
   setPluginSidebar(previous=>({...previous,viewId:page.id,open:true}));setContext(null);setMobileOpen(false);setShowPanels(false);return;
  }
  collect();pluginContext.current=activeRef.current;editor.current=null;setPluginPage(page);setView('plugin');setDialog(null);setContext(null);setMobileOpen(false);
 },[collect]);
 const closePluginSidebar=useCallback(()=>{
  const id=pluginSidebarRef.current.viewId;
  setPluginSidebar(previous=>({...previous,open:false}));
  requestAnimationFrame(()=>{if(id)document.querySelector<HTMLButtonElement>(`[data-plugin-sidebar-toggle="${CSS.escape(id)}"]`)?.focus();});
 },[]);
 const closePluginView=useCallback((viewId:string)=>{
  if(pluginSidebarRef.current.viewId===viewId){closePluginSidebar();return;}
  if(pluginPageRef.current?.id!==viewId)return;
  pluginPageRef.current=null;setPluginPage(null);
  const id=pluginContext.current,book=current.current?.notebooks.find(book=>book.documents.some(doc=>doc.id===id));
  editor.current=null;setHeadings([]);setContext(null);
  if(book&&id){setBookId(book.id);setDocId(id);setView('editor');}
  else{setView('home');activeRef.current=null;}
 },[current,closePluginSidebar]);
 useEffect(()=>{
  const runtime=new PluginHost({
   getWorkspace:()=>{collect();return current.current||{version:1,notebooks:[],plugins:[]};},
   getActiveDocumentId:()=>activeRef.current,getTheme:()=>appearanceRef.current,
   replaceDocument:async(id,markdown,expectedMarkdown)=>{collect();const doc=current.current?.notebooks.flatMap(book=>book.documents).find(doc=>doc.id===id);if(!doc)throw new PluginError('NOT_FOUND','文档不存在');if(expectedMarkdown!==undefined&&doc.markdown!==expectedMarkdown)throw new PluginError('CONFLICT','文档已发生变化，请重新读取并确认');writeDocument(id,markdown);await flush();},
   createDocument:async(notebookId,title,markdown)=>{if(!current.current?.notebooks.some(b=>b.id===notebookId))throw new PluginError('NOT_FOUND','笔记不存在');const doc:NoteDocument={id:uuid(),title,markdown,updatedAt:new Date().toISOString()};update(old=>({...old,notebooks:old.notebooks.map(b=>b.id===notebookId?{...b,documents:[...b.documents,doc]}:b)}));await flush();return doc;},
   openDocument:id=>{const book=current.current?.notebooks.find(book=>book.documents.some(doc=>doc.id===id));if(book)select(book.id,id);},
   insertText:text=>{if(!activeRef.current||!editor.current||modeRef.current!=='edit')throw new PluginError('NOT_FOUND','请先打开可编辑文档');programmaticEdit.current=true;try{editor.current.insertText(text);}finally{programmaticEdit.current=false;}},
   getSelection:()=>({documentId:activeRef.current,text:editor.current?.getSelection()||''}),
   getPluginData:(pluginId,key)=>getPluginData(current.current?.extensions,pluginId,key),listPluginData,setPluginData,onOpenView:openPluginView,onCloseView:closePluginView,
   showDialog:showPluginDialog,cancelDialogs,notify:setNotice,
   reservedShortcuts:[...APP_SHORTCUTS.map(item=>item.binding),...EDITOR_SHORTCUTS.map(item=>item.binding)],
   onStateChange:()=>setPluginVersion(v=>v+1),onError:report,
   onPluginStopped:id=>update(old=>({...old,plugins:old.plugins.map(p=>p.manifest.id===id?{...p,enabled:false}:p)}))
  });
  host.current=runtime;return()=>{runtime.dispose();host.current=null;};
 },[current,update,flush,writeDocument,report,collect,listPluginData,setPluginData,openPluginView,closePluginView,showPluginDialog,cancelDialogs]);
 useEffect(()=>host.current?.notifyTheme(),[resolvedTheme,settings.accent]);
 useEffect(()=>{if(github.state.lastSyncedAt)host.current?.notifySync();},[github.state.lastSyncedAt]);
 useEffect(()=>{
  if(!workspace)return;
  const missing=workspace.plugins.filter(plugin=>!workspace.extensions?.installs.some(entry=>entry.id===plugin.manifest.id));
  if(missing.length)update(old=>({...old,extensions:missing.reduce((state,plugin)=>recordInstallation(state,plugin),old.extensions)}));
 },[!!workspace,update]);
 const installationSignature=JSON.stringify(workspace?.extensions?.installs||[]);
 useEffect(()=>{
  if(!workspace||changingPlugins.current)return;
  let cancelled=false;
  void restoreSyncedPlugins({getWorkspace:()=>current.current,isCancelled:()=>cancelled,apply:plugins=>changePlugins(plugins,false),onError:report}).catch(report);
  return()=>{cancelled=true;};
 },[installationSignature,!!workspace,github.state.lastSyncedAt]);
 useEffect(()=>{if(view==='plugin'&&(!pluginPage||!host.current?.getViews().some(page=>page.id===pluginPage.id))){setPluginPage(null);setView('home');}},[pluginVersion,view,pluginPage]);

 useEffect(()=>{if(!changingPlugins.current)host.current?.setPlugins(workspace?.plugins||[]);},[workspace?.plugins]);
 useEffect(()=>host.current?.notifyDocumentChange(),[docId,view]);
 useEffect(()=>{const hidden=()=>{if(document.visibilityState==='hidden')void persist().catch(report);};const leave=()=>void persist().catch(report);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);};},[persist,report]);
 useEffect(()=>{if(!native||/Android/i.test(navigator.userAgent))return;let disposed=false,cleanup:(()=>void)|undefined;void import('@tauri-apps/api/window').then(async({getCurrentWindow})=>{const win=getCurrentWindow();const off=await win.onCloseRequested(async event=>{event.preventDefault();try{await persist();await win.destroy();}catch(e){report(e);}});if(disposed)off();else cleanup=off;}).catch(report);return()=>{disposed=true;cleanup?.();};},[persist,report]);
 useEffect(()=>{if(!context)return;const dismiss=(e:PointerEvent)=>{if(!contextRef.current?.contains(e.target as Node))setContext(null);};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[context]);
 function openDialog(next:Dialog){collect();setContext(null);setMessage('');setQuickQuery('');if(next?.type==='name'&&next.kind==='book')setNewLocation(null);if(next?.type==='name')setCover(next.kind==='book'?'preset:0':current.current?.notebooks.find(b=>b.id===next.bookId)?.cover||'');if(next?.type==='cover')setCover(current.current?.notebooks.find(b=>b.id===next.bookId)?.cover||'');setDialog(next);}
 function transfer(tab:'import'|'export'='import',targetBook?:string,targetDoc?:string){setTransferTab(tab);setExportScope(targetDoc?'document':targetBook?'book':view==='editor'?'book':'all');setExportFormat('zip');setImportFile(null);openDialog({type:'transfer',bookId:targetBook||bookId||undefined,docId:targetDoc||docId||undefined});}
 function showContext(kind:Context['kind'],anchor:HTMLElement,b?:string,d?:string){collect();const r=anchor.getBoundingClientRect();setContext({kind,bookId:b,docId:d,x:Math.max(10,Math.min(r.right-246,innerWidth-256)),y:Math.max(10,Math.min(r.bottom+6,innerHeight-390))});}
 function goHome(){collect();setView('home');setMobileOpen(false);setContext(null);editor.current=null;activeRef.current=null;}
 function closeOutline(){setOutlineOpen(false);requestAnimationFrame(()=>outlineToggleRef.current?.focus());}
 function select(b:string,d?:string){collect();const target=current.current?.notebooks.find(n=>n.id===b);const next=d||target?.documents[0]?.id||null;if(next)recordRecentDocument(next);setBookId(b);setDocId(next);setMode('edit');setView('editor');setMobileOpen(false);setShowPanels(false);setContext(null);if(next!==docId){editor.current=null;setHeadings([]);}}
 function openLocation(id:string){collect();setContext(null);setLocationId(id);}
 async function changePlugins(plugins:Workspace['plugins'],syncInstallations=true){
  if(changingPlugins.current)throw new Error('插件正在保存，请稍候');
  changingPlugins.current=true;setBusy(true);
  let previous:Workspace['plugins']|undefined;
  let previousExtensions:ExtensionState|undefined;
  let stagedExtensions:ExtensionState|undefined;
  try{
   collect();
   previous=current.current?.plugins;
   previousExtensions=current.current?.extensions;
   if(!previous)throw new Error('笔记尚未加载');
   host.current?.setPlugins(previous.filter(plugin=>plugins.includes(plugin)));
   update(old=>{
    let extensions=old.extensions;
    if(syncInstallations){
     for(const plugin of previous!)if(!extensions?.installs.some(record=>record.id===plugin.manifest.id))extensions=recordInstallation(extensions,plugin);
     for(const plugin of plugins)extensions=recordInstallation(extensions,plugin);
     for(const plugin of previous!)if(!plugins.some(next=>next.manifest.id===plugin.manifest.id))extensions=recordInstallation(extensions,null,plugin.manifest.id);
    }
    stagedExtensions=extensions;return {...old,plugins,extensions};
   });
   await flush();
  }catch(e){
   if(previous){
    const restored=previous.map(plugin=>plugins.includes(plugin)?current.current?.plugins.find(value=>value.manifest.id===plugin.manifest.id)||plugin:plugin);
    update(old=>{
     const installs=(old.extensions?.installs||[]).flatMap(record=>{
      const staged=stagedExtensions?.installs.find(value=>value.id===record.id);
      if(JSON.stringify(staged)!==JSON.stringify(record))return [record];
      const original=previousExtensions?.installs.find(value=>value.id===record.id);return original?[original]:[];
     });
     return {...old,plugins:restored,...(old.extensions?{extensions:{...old.extensions,installs}}:{})};
    });await flush().catch(report);
   }
   throw e;
  }finally{
   changingPlugins.current=false;host.current?.setPlugins(current.current?.plugins||[]);setBusy(false);
  }
 }
 async function migrateLocation(path:string|null){if(!locationId)throw new Error('笔记不存在');setBusy(true);host.current?.setPlugins([]);try{await persist();const next=await setNotebookLocation(locationId,path);replacePersisted(await loadWorkspace());return next;}finally{setBusy(false);host.current?.setPlugins(current.current?.plugins||[]);}}
 function create(kind:'book'|'document'){openDialog({type:'name',kind,bookId:bookId||undefined,value:''});}
 async function run(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn();}catch(e){report(e);}finally{setBusy(false);}}
 async function uploadCover(){return new Promise<string|null>(resolve=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.oncancel=()=>resolve(null);input.onchange=()=>{const file=input.files?.[0];if(!file){resolve(null);return;}void saveAsset(file).then(asset=>resolve(asset.path),e=>{report(e);resolve(null);});};input.click();});}
 async function submitName(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(dialog?.type!=='name')return;const name=String(new FormData(e.currentTarget).get('name')||'').trim();if(!name)return;if(dialog.kind==='book'&&allowLocations){const issue=directoryError(newLocation);if(issue){setMessage(issue);return;}}const target=dialog;await run(async()=>{await persist();if(target.kind==='book'){const id=uuid();update(old=>({...old,notebooks:[...old.notebooks,{id,name,cover:cover||undefined,documents:[]}]}));setBookId(id);setDocId(null);setView('editor');editor.current=null;await flush();if(allowLocations&&newLocation!==null){try{await setNotebookLocation(id,newLocation.trim());}catch(e){setDialog(null);setLocationId(id);setNotice('笔记已创建，请重新设置目录');throw e;}}}
 else if(target.kind==='document'){const id=uuid();recordRecentDocument(id);update(old=>({...old,notebooks:old.notebooks.map(b=>b.id===target.bookId?{...b,documents:[...b.documents,{id,title:name,markdown:`# ${name}\n\n`,updatedAt:new Date().toISOString()}]}:b)}));setBookId(target.bookId!);setDocId(id);setView('editor');setMode('edit');setHeadings([]);setMobileOpen(false);editor.current=null;}
 else update(old=>({...old,notebooks:old.notebooks.map(b=>b.id!==target.bookId?b:target.kind==='rename-book'?{...b,name}: {...b,documents:b.documents.map(d=>d.id===target.docId?{...d,title:name,markdown:d.markdown.replace(/^#\s+([^\r\n]+)/,(line,title)=>title.trim()===d.title?'# '+name:line),updatedAt:new Date().toISOString()}:d)})}));await flush();setDialog(null);});}
 async function remove(){if(dialog?.type!=='delete')return;const target=dialog;await run(async()=>{await persist();update(old=>({...old,notebooks:target.docId?old.notebooks.map(b=>b.id===target.bookId?{...b,documents:b.documents.filter(d=>d.id!==target.docId)}:b):old.notebooks.filter(b=>b.id!==target.bookId)}));if(target.bookId===bookId){if(!target.docId){setView('home');setBookId(null);setDocId(null);}else if(target.docId===docId){setDocId(current.current?.notebooks.find(b=>b.id===bookId)?.documents[0]?.id||null);editor.current=null;setHeadings([]);}}await flush();setDialog(null);setNotice('已删除');});}
 async function move(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(dialog?.type!=='move')return;const target=String(new FormData(e.currentTarget).get('notebook')||'');const from=dialog;await run(async()=>{await persist();const doc=current.current?.notebooks.find(b=>b.id===from.bookId)?.documents.find(d=>d.id===from.docId);if(!doc||!target)throw new Error('请选择目标笔记');update(old=>({...old,notebooks:old.notebooks.map(b=>b.id===from.bookId?{...b,documents:b.documents.filter(d=>d.id!==from.docId)}:b.id===target?{...b,documents:[...b.documents,doc]}:b)}));if(docId===from.docId)setBookId(target);await flush();setDialog(null);setNotice('已移动');});}
 async function importNotes(){if(!importFile)return;await run(async()=>{host.current?.setPlugins([]);try{await persist();const next=await command<Workspace>('import_bundle',{name:importFile.name,bytes:Array.from(importFile.bytes),notebookId:view==='editor'?bookId:null});replacePersisted(next);setDialog(null);setNotice('已导入');}finally{host.current?.setPlugins(current.current?.plugins||[]);}});}
 async function exportNotes(){if(dialog?.type!=='transfer')return;await run(async()=>{await persist();const markdown=exportFormat==='md';const file=await command<TransferFile>(markdown?'export_markdown':'export_bundle',{notebookId:exportScope==='all'?null:dialog.bookId,documentId:exportScope==='document'?dialog.docId:null});if(await writeTransfer(file)){setDialog(null);setNotice('已导出');}});}
 function followLink(e:React.MouseEvent){const el=e.target as HTMLElement;const a=el.closest<HTMLAnchorElement>('a[href]');if(a){const url=a.getAttribute('href')||'';if(/^https?:\/\//i.test(url)){e.preventDefault();void openLink(url).catch(report);}else if(!url.startsWith('#'))e.preventDefault();}else if(e.metaKey||e.ctrlKey){const url=el.closest('[data-type="a"]')?.querySelector('.vditor-ir__marker--link')?.textContent;if(url){e.preventDefault();void openLink(url).catch(report);}}}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.isComposing||e.defaultPrevented||(e.target as HTMLElement).closest('.editor-slash-menu,.editor-link-dialog,.flow-overlay,.tool-overlay'))return;if(e.key==='Escape'){if(sidebarVisible&&!dialog&&!locationId&&!document.querySelector('dialog[open]')){e.preventDefault();closePluginSidebar();return;}setContext(null);setMobileOpen(false);if(outlineOpen)closeOutline();return;}if(dialog||locationId||busy)return;const action=APP_SHORTCUTS.find(s=>matchesEditorShortcut(e,s.binding));if(!action)return;if(['save','toggle-mode','sidebar','outline','documents'].includes(action.id)&&view!=='editor')return;e.preventDefault();e.stopPropagation();if(action.id==='new')create(view==='home'?'book':'document');else if(action.id==='save')void persist().catch(report);else if(action.id==='toggle-mode'){collect();setMode(m=>m==='read'?'edit':'read');}else if(action.id==='sidebar')compact?setMobileOpen(v=>!v):setCollapsed(v=>!v);else if(action.id==='outline')outlineOpen?closeOutline():setOutlineOpen(true);else if(action.id==='documents'){setCollapsed(false);setMobileOpen(compact);}else openDialog({type:action.id as 'theme'|'quick-open'|'shortcuts'});};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);});
 const commands=host.current?.getCommands()||[],panels=host.current?.getPanels()||[];
 const homeWidgets=host.current?.getViews('home.widget')||[];
 const sidebarViews=host.current?.getViews('editor.sidebar')||[];
 const sidebarVisible=view==='editor'&&pluginSidebar.open&&sidebarViews.some(sidebar=>sidebar.id===pluginSidebar.viewId);
 function togglePluginSidebar(sidebar:PluginView){
  if(pluginSidebar.open&&pluginSidebar.viewId===sidebar.id){closePluginSidebar();return;}
  setPluginSidebar(previous=>({...previous,viewId:sidebar.id,open:true}));setMobileOpen(false);setShowPanels(false);setContext(null);
 }
 function returnFromPlugin(){if(pluginPage)closePluginView(pluginPage.id);}
 function openPluginSettings(pluginId:string){const page=host.current?.getViews('plugin.settings').find(page=>page.pluginId===pluginId);if(page)host.current?.openView(page.id);else setNotice('请先启用插件，或该插件未提供设置页面');}

 const targetBook=dialog&&'bookId'in dialog?workspace?.notebooks.find(b=>b.id===dialog.bookId):undefined;
 const targetDoc=dialog&&'docId'in dialog?targetBook?.documents.find(d=>d.id===dialog.docId):undefined;
 const quickResults=workspace?.notebooks.flatMap(b=>b.documents.map(d=>({b,d}))).filter(({b,d})=>(b.name+' '+d.title).toLocaleLowerCase().includes(quickQuery.trim().toLocaleLowerCase()))||[];
 const close=()=>{if(!busy)setDialog(null);};
 const menuButton=(label:string,fn:()=>void,Icon=FileText,hint='',danger=false)=><button key={label} className={danger?'danger-text':''} onClick={()=>{setContext(null);fn();}}><Icon size={16}/><span>{label}</span>{hint&&<kbd>{hint}</kbd>}</button>;
 if(!workspace)return <main className="startup"><img src="/typepro-logo.png" alt="TypePro"/>{error?<><p role="alert">{error}</p><button className="btn outline" onClick={()=>location.reload()}>重新加载</button></>:<p>正在打开…</p>}</main>;
 return <div className={`app ${native&&!/Android/i.test(navigator.userAgent)?'native-mac':''} ${view==='home'?'home-view':''}`} style={{'--sidebar-w':width+'px','--plugin-sidebar-preferred-w':pluginSidebar.width+'px'} as CSSProperties}>
 {view==='plugin'&&pluginPage?<PluginSurface host={host.current} view={pluginPage} page onBack={returnFromPlugin}/>:view!=='editor'?<Home actions={<PluginActions host={host.current} commands={commands} location="home.toolbar" onError={report}/>} extensions={homeWidgets.map(widget=><PluginSurface key={widget.id} host={host.current} view={widget}/>)} notebooks={workspace.notebooks} onOpen={select} onCreate={()=>create('book')} onMenu={(b,a)=>showContext('book',a,b)} onTheme={()=>openDialog({type:'theme'})} onTransfer={()=>transfer()} onSync={()=>openDialog({type:'github'})} syncLabel={syncLabel} onMore={a=>showContext('home',a)}/>:<div className={`workspace ${collapsed?'collapsed':''} ${mobileOpen?'mobile-open':''} ${sidebarVisible?'plugin-sidebar-open':''}`}>
 <button className="mobile-scrim" aria-label="关闭目录" onClick={()=>setMobileOpen(false)}/><Sidebar notebooks={workspace.notebooks} bookId={bookId} documentId={docId} hidden={mobile&&sidebarVisible|| (compact?!mobileOpen:collapsed)} width={width} onHome={goHome} onCollapse={()=>compact?setMobileOpen(false):setCollapsed(true)} onSelect={select} onCreate={()=>create('document')} onSwitch={a=>showContext('books',a)} onMenu={(b,d,a)=>showContext('doc',a,b,d)} onTransfer={()=>transfer()} onPlugins={()=>openDialog({type:'plugins'})} onSync={()=>openDialog({type:'github'})} syncLabel={syncLabel} onResize={setWidth}/>
 <main className="editor-main" inert={mobile&&sidebarVisible} onClick={followLink}><header className="editor-header" data-tauri-drag-region><button className="icon-button open-sidebar" aria-label="展开目录" title="展开目录 · ⌘ ⇧ L" onClick={()=>compact?setMobileOpen(true):setCollapsed(false)}><PanelLeft size={19}/></button><div className="breadcrumb" data-tauri-drag-region><span className="book-crumb">{activeBook?.name}</span><span className="sep">/</span><b>{activeDocument?.title||activeBook?.name}</b></div>{activeDocument&&<button className="icon-button mode-toggle" aria-label={mode==='edit'?'切换到阅读 · ⌘ /':'切换到编辑 · ⌘ /'} title={mode==='edit'?'切换到阅读 · ⌘ /':'切换到编辑 · ⌘ /'} onClick={()=>{collect();setMode(mode==='edit'?'read':'edit');}}>{mode==='edit'?<Eye size={19}/>:<Pencil size={19}/>}</button>}<div className="header-actions"><PluginSidebarActions views={sidebarViews} state={pluginSidebar} onToggle={togglePluginSidebar}/><PluginActions host={host.current} commands={commands} location="editor.toolbar" onError={report}/><button className="icon-button theme-top" aria-label="外观" onClick={()=>openDialog({type:'theme'})}><Palette size={19}/></button>{panels.length>0&&<button className="icon-button" aria-label="插件面板" onClick={()=>setShowPanels(v=>!v)}><Puzzle size={18}/></button>}<button className="icon-button" aria-label="文档操作" onClick={e=>showContext('doc',e.currentTarget,bookId||undefined,docId||undefined)}><MoreHorizontal size={20}/></button></div></header>
 <div className="editor-and-panels">{activeDocument?<MarkdownEditor key={activeDocument.id} documentId={activeDocument.id} markdown={activeDocument.markdown} mode={mode} theme={resolvedTheme} documentTools={<div className={`document-tools ${outlineOpen?'outline-open':''}`}><button ref={outlineToggleRef} className="icon-button outline-toggle" aria-label="文档大纲" title="文档大纲 · ⌘ ⌃ 1" aria-controls="document-outline" aria-expanded={outlineOpen} onClick={()=>setOutlineOpen(v=>!v)}><ListTree size={18}/></button></div>} documentOutline={outlineOpen?<Outline key={activeDocument.id} headings={headings} onJump={id=>editor.current?.scrollToHeading(id)} onClose={closeOutline}/>:null} trackEdits={host.current?.hasDocumentSubscribers()||false} onChange={(md,edit)=>writeDocument(activeDocument.id,md,edit)} onReady={api=>{editor.current=api;setHeadings(api.getHeadings());}} onHeadingsChange={setHeadings} onError={report} saveAsset={saveAsset} resolveAsset={resolveAsset}/>:<section className="empty-state"><div className="empty-mark"><FileText size={30}/></div><h2>还没有文档</h2><p>写下这一页的第一句话。</p><button className="btn primary" onClick={()=>create('document')}><Plus size={17}/>新建文档</button></section>}{showPanels&&panels.length>0&&<aside className="plugin-panels"><header>插件面板<button className="icon-button" onClick={()=>setShowPanels(false)} aria-label="关闭插件面板"><X size={15}/></button></header>{panels.map(p=><section key={p.id}><h3>{p.title}</h3><p>{p.text}</p></section>)}</aside>}</div>
 <footer className={`editor-status ${status==='error'?'error':''}`} role="status"><CheckCircle2 size={13}/><span>{status==='saved'?'已保存':status==='saving'?'保存中…':'保存失败'}</span>{status==='error'&&<button className="retry" onClick={()=>void persist().catch(report)}>重试</button>}<button className="retry" onClick={()=>openDialog({type:'github'})} title="GitHub 同步">{syncLabel}</button><span className="word-count">{(activeDocument?.markdown||'').replace(/\s/g,'').length} 字</span></footer></main><PluginSidebar host={host.current} views={sidebarViews} state={pluginSidebar} mobile={mobile} onClose={closePluginSidebar} onResize={width=>setPluginSidebar(previous=>({...previous,width}))}/></div>}
 {context&&<div className="context-menu" ref={contextRef} role="menu" style={{left:context.x,top:context.y,maxHeight:innerHeight-context.y-10}}>{context.kind==='home'?<>{menuButton('快速打开',()=>openDialog({type:'quick-open'}),Search,shortcutHint('quick-open'))}{menuButton('外观',()=>openDialog({type:'theme'}),Palette,shortcutHint('theme'))}{menuButton('插件',()=>openDialog({type:'plugins'}),Puzzle)}{menuButton('GitHub 同步',()=>openDialog({type:'github'}),GitBranch)}{menuButton('导入 / 导出',()=>transfer(),ArrowDownUp)}{menuButton('键盘快捷键',()=>openDialog({type:'shortcuts'}),Keyboard,shortcutHint('shortcuts'))}{commands.filter(c=>c.locations.includes('app.menu')).map(c=>menuButton(c.label,()=>void host.current?.runCommand(c.id).catch(report),Puzzle))}{menuButton('关于 TypePro',()=>openDialog({type:'about'}),Info)}</>:context.kind==='books'?<>{workspace.notebooks.map(b=>menuButton(b.name,()=>select(b.id),BookOpen))}{allowLocations&&bookId&&menuButton('当前笔记存储目录',()=>openLocation(bookId),FolderOpen)}<hr/>{menuButton('全部笔记',goHome,HomeIcon)}</>:<>{context.kind==='book'?menuButton('打开笔记',()=>select(context.bookId!),BookOpen):menuButton('新建文档',()=>openDialog({type:'name',kind:'document',bookId:context.bookId,value:''}),Plus,shortcutHint('new'))}{menuButton('重命名',()=>{const b=workspace.notebooks.find(b=>b.id===context.bookId);openDialog({type:'name',kind:context.docId?'rename-document':'rename-book',bookId:context.bookId,docId:context.docId,value:context.docId?b?.documents.find(d=>d.id===context.docId)?.title||'':b?.name||''});})}{!context.docId&&allowLocations&&context.bookId&&menuButton('存储目录',()=>openLocation(context.bookId!),FolderOpen)}{!context.docId&&menuButton('设置封面',()=>openDialog({type:'cover',bookId:context.bookId!}),BookOpen)}{context.docId&&workspace.notebooks.length>1&&menuButton('移动到…',()=>openDialog({type:'move',bookId:context.bookId!,docId:context.docId!}),FolderOpen)}{menuButton(context.docId?'导出文档':'导出笔记',()=>transfer('export',context.bookId,context.docId),Upload)}{context.kind==='doc'&&<><hr/>{menuButton('快速打开',()=>openDialog({type:'quick-open'}),Search,shortcutHint('quick-open'))}{menuButton('外观',()=>openDialog({type:'theme'}),Palette,shortcutHint('theme'))}{menuButton('键盘快捷键',()=>openDialog({type:'shortcuts'}),Keyboard,shortcutHint('shortcuts'))}{menuButton('关于 TypePro',()=>openDialog({type:'about'}),Info)}{context.docId===docId&&commands.map(c=>menuButton(c.label,()=>void host.current?.runCommand(c.id).catch(report),Puzzle))}</>}<hr/>{menuButton(context.docId?'删除文档':'删除笔记',()=>openDialog({type:'delete',bookId:context.bookId!,docId:context.docId}),Trash2,'',true)}</>}</div>}
 <AppUpdateNotice updates={appUpdates} onDetails={()=>openDialog({type:'about'})}/>
 {(message||error)&&<div className="error-toast" role="alert"><span>{message||error}</span>{message&&<button className="icon-button" aria-label="关闭错误提示" onClick={()=>setMessage('')}><X size={16}/></button>}</div>}{notice&&<div className="toast" role="status"><CheckCircle2 size={15}/>{notice}</div>}
 {dialog&&<Modal title={dialog.type==='github'?'GitHub 同步':dialog.type==='theme'?'外观':dialog.type==='plugins'?'插件':dialog.type==='shortcuts'?'键盘快捷键':dialog.type==='quick-open'?'快速打开':dialog.type==='about'?'关于 TypePro':dialog.type==='transfer'?'导入 / 导出':dialog.type==='cover'?'设置封面':dialog.type==='delete'?`删除${dialog.docId?'文档':'笔记'}`:dialog.type==='move'?'移动文档':dialog.type==='name'?(dialog.kind.includes('rename')?'重命名':dialog.kind==='book'?'新建笔记':'新建文档'):''} onClose={close} wide={['theme','plugins','transfer','shortcuts','about','github'].includes(dialog.type)}>
 {dialog.type==='theme'&&<ThemeSettings settings={settings} onChange={updateSettings} onReset={resetSettings} onClose={close}/>}
 {dialog.type==='github'&&<GithubSync state={github.state} {...github.callbacks} onClose={close}/>}
 {dialog.type==='about'&&<About onClose={close} updates={appUpdates}/>}
 {dialog.type==='shortcuts'&&<><Shortcuts/><div className="form-actions"><button className="btn primary" onClick={close}>完成</button></div></>}
 {dialog.type==='quick-open'&&<><label className="search-box"><Search size={17}/><input autoFocus aria-label="搜索文档" placeholder="搜索文档" value={quickQuery} onChange={e=>setQuickQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&quickResults[0]){const {b,d}=quickResults[0];setDialog(null);select(b.id,d.id);}}}/></label><div className="quick-results">{quickResults.length?quickResults.map(({b,d})=><button className="quick-result" key={d.id} onClick={()=>{setDialog(null);select(b.id,d.id);}}><FileText size={17}/><span>{d.title}<small>{b.name}</small></span></button>):<p className="muted">没有找到文档</p>}</div></>}
 {dialog.type==='name'&&<form onSubmit={submitName}><label className="field" htmlFor="name-input">{dialog.kind.includes('book')?'笔记名称':'文档名称'}</label><input className="field-input" id="name-input" name="name" defaultValue={dialog.value} autoFocus required maxLength={120} autoComplete="off" placeholder={dialog.kind.includes('book')?'给笔记起个名字':'文档标题'}/>{dialog.kind==='book'&&<><CoverPicker value={cover} onChange={setCover} onUpload={uploadCover}/>{allowLocations&&<NotebookDirectoryField value={newLocation} onChange={setNewLocation} disabled={busy}/>}</>}<div className="form-actions"><button className="btn outline" type="button" onClick={close} disabled={busy}>取消</button><button className="btn primary" disabled={busy}>{dialog.kind.includes('rename')?'保存':'创建'}</button></div></form>}
 {dialog.type==='cover'&&<><CoverPicker value={cover} onChange={setCover} onUpload={uploadCover}/><div className="form-actions"><button className="btn outline" disabled={busy} onClick={close}>取消</button><button className="btn primary" disabled={busy} onClick={()=>void run(async()=>{update(old=>({...old,notebooks:old.notebooks.map(b=>b.id===dialog.bookId?{...b,cover:cover||undefined}:b)}));await flush();setDialog(null);})}>保存</button></div></>}
 {dialog.type==='delete'&&<><div className="delete-icon"><Trash2 size={20}/></div><p className="dialog-copy">删除「{targetDoc?.title||targetBook?.name}」？</p><p className="muted">{dialog.docId?'删除后无法恢复。':`其中 ${targetBook?.documents.length||0} 篇文档将一并删除。`}</p><div className="form-actions"><button className="btn outline" disabled={busy} onClick={close}>取消</button><button className="btn danger" disabled={busy} onClick={()=>void remove()}>删除</button></div></>}
 {dialog.type==='move'&&<form onSubmit={move}><label className="field">选择目标笔记</label>{workspace.notebooks.filter(b=>b.id!==dialog.bookId).map((b,i)=><label className="move-option" key={b.id}><input type="radio" name="notebook" value={b.id} defaultChecked={i===0}/><BookOpen size={18}/>{b.name}</label>)}<div className="form-actions"><button type="button" className="btn outline" disabled={busy} onClick={close}>取消</button><button className="btn primary" disabled={busy}>移动</button></div></form>}
 {dialog.type==='transfer'&&<><div className="dialog-tabs">{(['import','export']as const).map(tab=><button key={tab} className={transferTab===tab?'active':''} onClick={()=>setTransferTab(tab)}>{tab==='import'?'导入':'导出'}</button>)}</div>{transferTab==='import'?<><div className="dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void file.arrayBuffer().then(bytes=>setImportFile({name:file.name,bytes:new Uint8Array(bytes)}));}}><Upload size={27}/><h3>将文件拖到这里</h3><p>Markdown / ZIP</p><button className="btn outline" disabled={busy} onClick={()=>void run(async()=>setImportFile(await pickFile()))}>选择文件</button></div>{importFile&&<div className="file-picked"><FileText size={17}/><span>{importFile.name}</span><small>{Math.max(1,Math.round(importFile.bytes.length/1024))} KB</small><button className="icon-button" aria-label="移除文件" onClick={()=>setImportFile(null)}><X size={15}/></button></div>}</>:<><label className="field" htmlFor="export-scope">导出范围</label><select className="field-input" id="export-scope" value={exportScope} onChange={e=>{setExportScope(e.target.value);if(e.target.value!=='document')setExportFormat('zip');}}><option value="all">全部笔记</option><option value="book" disabled={!dialog.bookId}>当前笔记</option><option value="document" disabled={!dialog.docId}>当前文档</option></select><label className="field">文件格式</label><div className="transfer-formats"><button className={`format-option ${exportFormat==='zip'?'active':''}`} onClick={()=>setExportFormat('zip')}><FolderOpen size={22}/><span>ZIP<small>笔记与附件</small></span></button><button className={`format-option ${exportFormat==='md'?'active':''}`} disabled={exportScope!=='document'} onClick={()=>setExportFormat('md')}><FileText size={22}/><span>Markdown<small>单篇文档</small></span></button></div></>}<div className="form-actions"><button className="btn outline" disabled={busy} onClick={close}>取消</button><button className="btn primary" disabled={busy||(transferTab==='import'&&!importFile)} onClick={()=>void(transferTab==='import'?importNotes():exportNotes())}>{transferTab==='import'?'导入':'导出'}</button></div></>}
 {dialog.type==='plugins'&&<PluginManager plugins={workspace.plugins} onImport={()=>pickFile(true)} onChange={changePlugins} onOpenSettings={openPluginSettings}/>}
 {message&&<p className="field-error" role="alert">{message}</p>}
 </Modal>}
 {pluginDialog}
 {locationId&&workspace.notebooks.find(b=>b.id===locationId)&&<NotebookLocations initialError={message} notebook={workspace.notebooks.find(b=>b.id===locationId)!} onMigrate={migrateLocation} onClose={()=>{if(!busy){setLocationId(null);setMessage('');}}}/>}
 </div>;
}
