import { ArrowDownUp, ChevronDown, ChevronsLeft, GitBranch, FileText, Home, MoreHorizontal, Plus, Puzzle } from 'lucide-react';
import { useRef } from 'react';
import type { Notebook } from './lib/types';
interface Props {
  notebooks: Notebook[]; bookId: string|null; documentId:string|null; hidden:boolean; width:number;
  onHome:()=>void; onCollapse:()=>void; onSelect:(bookId:string,documentId?:string)=>void; onCreate:()=>void;
  onSwitch:(anchor:HTMLElement)=>void; onMenu:(bookId:string,documentId:string|undefined,anchor:HTMLElement)=>void;
  onSync:()=>void;syncLabel:string;onTransfer:()=>void;onPlugins:()=>void;onResize:(width:number)=>void;
}
export default function Sidebar(p:Props){
 const book=p.notebooks.find(b=>b.id===p.bookId);const drag=useRef<{x:number,width:number}|null>(null);
 return <aside className="sidebar" inert={p.hidden} aria-hidden={p.hidden||undefined}>
  <div className="sidebar-inner"><div className="sidebar-brand" data-tauri-drag-region><span className="brand"><img src="/typepro-logo.png" alt=""/>TypePro</span><button className="icon-button" onClick={p.onCollapse} aria-label="收起目录" title="收起目录 · ⌘ ⇧ L"><ChevronsLeft size={18}/></button></div>
  <button className="side-home" onClick={p.onHome}><Home size={17}/>全部笔记</button>
  <button className="book-selector" onClick={e=>p.onSwitch(e.currentTarget)}><img src="/typepro-logo.png" alt=""/><span>{book?.name||'笔记'}</span><ChevronDown size={14}/></button>
  <div className="side-section"><span>文档</span><span>{book?.documents.length||0}</span></div>
  <nav className="tree" aria-label="文档目录">{book?.documents.map(d=><div className={`tree-row ${d.id===p.documentId?'selected':''}`} key={d.id}><button className="tree-label" onClick={()=>p.onSelect(book.id,d.id)} aria-current={d.id===p.documentId?'page':undefined}><FileText size={16}/><span>{d.title}</span></button><button className="icon-button doc-menu" aria-label={`${d.title} 操作`} onClick={e=>p.onMenu(book.id,d.id,e.currentTarget)}><MoreHorizontal size={16}/></button></div>)}<button className="tree-row new-doc" onClick={p.onCreate}><Plus size={16}/>新建文档</button></nav>
  <div className="side-bottom"><button onClick={p.onSync}><GitBranch size={17}/>{p.syncLabel}</button><button onClick={p.onPlugins}><Puzzle size={17}/>插件</button><button onClick={p.onTransfer}><ArrowDownUp size={17}/>导入 / 导出</button></div></div>
  <div className="resize-handle" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuenow={p.width} aria-valuemin={210} aria-valuemax={380} tabIndex={0}
   onPointerDown={e=>{drag.current={x:e.clientX,width:p.width};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{if(drag.current)p.onResize(Math.max(210,Math.min(380,drag.current.width+e.clientX-drag.current.x)));}}
   onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
   onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();p.onResize(e.key==='Home'?264:Math.max(210,Math.min(380,p.width+(e.key==='ArrowLeft'?-16:16))));}}}/>
 </aside>;
}
