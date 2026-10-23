import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import type { EditorHeading } from './editor/MarkdownEditor';
type Node=EditorHeading&{children:Node[]};
function hierarchy(headings:EditorHeading[]){const roots:Node[]=[],stack:Node[]=[];for(const h of headings.filter(item=>item.text)){const node:Node={...h,children:[]};while(stack.length&&stack[stack.length-1]!.level>=h.level)stack.pop();(stack[stack.length-1]?.children||roots).push(node);stack.push(node);}return roots;}
export default function Outline({headings,onJump,onClose}:{headings:EditorHeading[],onJump:(id:string)=>void,onClose:()=>void}){
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());const [selected,setSelected]=useState('');
 const branch=(nodes:Node[])=> <ul>{nodes.map(n=><li key={n.id}><div className={`outline-item ${selected===n.id?'active':''}`}><button className="outline-disclosure" aria-label={`${collapsed.has(n.id)?'展开':'收起'} ${n.text}`} aria-expanded={n.children.length?!collapsed.has(n.id):undefined} disabled={!n.children.length} onClick={()=>setCollapsed(old=>{const next=new Set(old);next.has(n.id)?next.delete(n.id):next.add(n.id);return next;})}>{n.children.length?(collapsed.has(n.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>):<span/>}</button><button className="outline-title" title={n.text} aria-current={selected===n.id?'location':undefined} onClick={()=>{setSelected(n.id);onJump(n.id);}}>{n.text}</button></div>{n.children.length&&!collapsed.has(n.id)?branch(n.children):null}</li>)}</ul>;
 return <aside className="document-outline" id="document-outline" aria-label="文档大纲"><header><span>大纲</span><button className="icon-button" onClick={onClose} aria-label="收起大纲"><X size={15}/></button></header><nav aria-label="标题层级">{headings.some(item=>item.text)?branch(hierarchy(headings)):<p>添加标题后，大纲会显示在这里。</p>}</nav></aside>;
}
