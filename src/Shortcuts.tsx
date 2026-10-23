import { Search } from 'lucide-react';
import { useState } from 'react';
import { EDITOR_SHORTCUTS } from './editor/commands';
export const APP_SHORTCUTS=[
 {id:'new',label:'新建笔记 / 文档',group:'文件',binding:'Mod+KeyN',keys:'⌘ N'},
 {id:'quick-open',label:'快速打开文档',group:'文件',binding:'Mod+Shift+KeyO',keys:'⌘ ⇧ O'},
 {id:'save',label:'保存',group:'文件',binding:'Mod+KeyS',keys:'⌘ S'},
 {id:'theme',label:'外观设置',group:'文件',binding:'Mod+Comma',keys:'⌘ ,'},
 {id:'toggle-mode',label:'编辑 / 阅读切换',group:'视图',binding:'Mod+Slash',keys:'⌘ /'},
 {id:'sidebar',label:'展开 / 收起目录',group:'视图',binding:'Mod+Shift+KeyL',keys:'⌘ ⇧ L'},
 {id:'outline',label:'文档大纲',group:'视图',binding:'Mod+Ctrl+Digit1',keys:'⌘ ⌃ 1'},
 {id:'documents',label:'文档目录',group:'视图',binding:'Mod+Ctrl+Digit3',keys:'⌘ ⌃ 3'},
 {id:'shortcuts',label:'键盘快捷键',group:'TypePro',binding:'Mod+Shift+Slash',keys:'⌘ ⇧ /'}
];
const native=[['撤销','⌘ Z'],['重做','⌘ ⇧ Z'],['剪切','⌘ X'],['复制','⌘ C'],['粘贴','⌘ V'],['全选','⌘ A']].map(([label,keys])=>({id:label,label,keys,group:'常用编辑'}));
export const shortcutHint=(id:string)=>APP_SHORTCUTS.find(s=>s.id===id)?.keys||'';
export default function Shortcuts(){const [query,setQuery]=useState('');let last='';const items=[...APP_SHORTCUTS.slice(0,4),...EDITOR_SHORTCUTS,{id:'format-code',label:'格式化当前代码块',group:'代码块',keys:'⌥ ⇧ F'},...APP_SHORTCUTS.slice(4),...native].filter(s=>(s.label+' '+s.keys+' '+s.group).toLowerCase().includes(query.trim().toLowerCase()));return <><div className="shortcut-platform">macOS <span>⌘ Command · ⌥ Option · ⌃ Control</span></div><label className="search-box"><Search size={17}/><input autoFocus placeholder="搜索操作或按键" aria-label="搜索快捷键" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="shortcut-results">{items.length?items.map(s=>{const heading=last!==s.group;last=s.group;return <div key={s.id}>{heading&&<h3 className="shortcut-group">{s.group}</h3>}<div className="shortcut-row"><span>{s.label}</span><span className="key-combo">{s.keys.split(' ').map((k,i)=><kbd key={i}>{k}</kbd>)}</span></div></div>}):<p className="muted">没有匹配的快捷键</p>}</div></>;}
