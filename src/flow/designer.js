import {parseDrawing, serializeDrawing} from './model.js';
import {renderFlowPreview, cancelFlowPreview} from './preview';
import {mountCodeEditor} from '../editor/CodeMirrorEditor';

// The accepted imperative canvas lives inside its own modal; React owns its lifetime.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sample = 'flowchart TD\n  A[开始] --> B{需要整理？}\n  B -->|是| C[整理笔记]\n  B -->|否| D(继续记录)\n  C --> D';
  const svgIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${{
    close:'<path d="m6 6 12 12M6 18 12 6"/>',
    node:'<rect x="4" y="6" width="16" height="12" rx="2"/>',
    branch:'<path d="m12 3 9 9-9 9-9-9Z"/>',
    link:'<path d="M5 5v9a5 5 0 0 0 5 5h9m-5-5 5 5-5 5"/>',
    delete:'<path d="M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7M14 10v7"/>',
    reset:'<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
  }[name]}</svg>`;

  export function openFlowDesigner({source,onSave,onClose}) {
    const previousFocus = document.activeElement;
    let raw = source === undefined ? sample : source, graph = parseDrawing(raw), mode = graph.ok ? 'draw' : 'mermaid';
    let selected = null, connecting = null, connectMode = false, timer, destroyed = false;
    let nextNode = 1, positions = new Map(), drag = null;
    const overlay = document.createElement('div'); overlay.className = 'flow-overlay';
    const diagramId = `flow-canvas-${crypto.randomUUID()}`, titleId = `${diagramId}-title`;
    overlay.innerHTML = `<section class="flow-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <header class="flow-header"><h2 id="${titleId}">流程图</h2><button class="flow-icon-button" data-flow="close" aria-label="关闭流程图">${svgIcon('close')}</button></header>
      <div class="flow-modebar"><div class="flow-tabs" role="tablist" aria-label="流程图编辑方式"><button role="tab" id="${diagramId}-draw-tab" aria-controls="${diagramId}-draw" data-flow="draw">绘制</button><button role="tab" id="${diagramId}-mermaid-tab" aria-controls="${diagramId}-mermaid" data-flow="mermaid">Mermaid</button></div><span class="flow-mode-hint" aria-live="polite"></span></div>
      <div class="flow-draw" id="${diagramId}-draw" role="tabpanel" aria-labelledby="${diagramId}-draw-tab">
        <div class="flow-toolstrip"><button data-flow="add">${svgIcon('node')}<span>节点</span></button><button data-flow="branch">${svgIcon('branch')}<span>分支</span></button><button data-flow="connect" aria-pressed="false">${svgIcon('link')}<span>连线</span></button><span class="flow-tool-divider"></span><label>方向 <select data-flow-direction aria-label="流程图方向"><option value="TD">从上到下</option><option value="LR">从左到右</option><option value="BT">从下到上</option><option value="RL">从右到左</option></select></label><button class="flow-reset-layout" data-flow="layout" title="重新排列">${svgIcon('reset')}<span>排列</span></button></div>
        <div class="flow-draw-layout"><div class="flow-canvas-scroll"><svg class="flow-canvas" id="${diagramId}" viewBox="0 0 1000 660" aria-label="流程图绘制画布"><defs><marker id="${diagramId}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z"/></marker></defs><g class="flow-edges"></g><g class="flow-nodes"></g></svg></div><aside class="flow-inspector" aria-label="流程图属性"></aside></div>
        <div class="flow-canvas-hint" aria-live="polite">拖动节点调整位置 · 连线后点选起点和终点</div>
      </div>
      <div class="flow-source-layout" id="${diagramId}-mermaid" role="tabpanel" aria-labelledby="${diagramId}-mermaid-tab" hidden><section class="flow-source-panel" aria-label="Mermaid 源码"><header class="flow-source-heading"><span>Mermaid</span><button type="button" class="flow-format" data-flow="format" title="格式化 · ⌥⇧F">格式化</button></header><div class="flow-code-editor"></div></section><div class="flow-preview-panel"><span>预览</span><div class="flow-preview" aria-live="polite"></div></div></div>
      <div class="flow-message" aria-live="polite" hidden></div>
      <footer class="flow-footer"><span>保存为 Mermaid，支持再次编辑</span><div><button class="flow-cancel" data-flow="close">取消</button><button class="flow-save" data-flow="save">${source!==undefined?'保存修改':'插入流程图'}</button></div></footer>
    </section>`;
    document.body.append(overlay);
    const background = [...document.body.children].filter(element => element !== overlay && element instanceof HTMLElement).map(element => [element, element.inert]);
    for (const [element] of background) element.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const query = selector => overlay.querySelector(selector);
    const sourceHost = query('.flow-code-editor'), canvas = query('.flow-canvas'), inspector = query('.flow-inspector'), preview = query('.flow-preview');
    const setMessage = message => { const element = query('.flow-message'); element.textContent = message; element.hidden = !message; };
    const sourceEditor = mountCodeEditor(sourceHost, {
      value: raw, language: 'mermaid', ariaLabel: 'Mermaid 源码',
      onChange: value => {
        raw=value; graph=parseDrawing(raw); clearTimeout(timer);
        if(graph.ok)layout();
        query('[data-flow="draw"]').setAttribute('aria-disabled',String(!graph.ok));
        setMessage(graph.ok?'':graph.reason+'。原文已保留，可继续编辑并预览。');
        timer=setTimeout(()=>renderFlowPreview(preview,raw),220);
      },
      onFormatError: setMessage,
      onFormatStateChange: pending => { const button=query('[data-flow="format"]'); button.disabled=pending; button.textContent=pending?'格式化中…':'格式化'; },
    });
    const hint = message => { query('.flow-canvas-hint').textContent = message || '拖动节点调整位置 · 连线后点选起点和终点'; };

    function close(saved=false) {
      if (destroyed) return;
      destroyed = true; clearTimeout(timer); cancelFlowPreview(preview); sourceEditor.destroy(); overlay.remove();
      for (const [element, inert] of background) element.inert = inert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
      if (!saved) onClose?.();
    }

    function layout() {
      if (!graph.ok) return;
      positions = new Map();
      const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
      const reverse = graph.direction === 'RL' || graph.direction === 'BT';
      const depth = new Map(graph.nodes.map(node => [node.id,0]));
      // A bounded pass handles branches and disconnected nodes without looping on cycles.
      for (let count=0; count < graph.nodes.length; count++) {
        let changed = false;
        for (const edge of graph.edges) {
          const next = Math.min((depth.get(edge.from) || 0)+1,graph.nodes.length-1);
          if (next > (depth.get(edge.to) || 0) && count < 5) {depth.set(edge.to,next);changed=true;}
        }
        if (!changed) break;
      }
      const groups = new Map();
      for (const node of graph.nodes) { const level=depth.get(node.id);if(!groups.has(level))groups.set(level,[]);groups.get(level).push(node); }
      const maxLevel = Math.max(...depth.values());
      for (const [level,group] of groups) group.forEach((node,index) => {
        const along = reverse ? maxLevel-level : level;
        positions.set(node.id,horizontal ? {x:120+along*220,y:110+index*145} : {x:210+index*235,y:90+along*140});
      });
    }

    const selection = () => selected?.kind === 'node' ? graph.nodes.find(node=>node.id===selected.id) : selected?.kind==='edge' ? graph.edges[selected.index] : null;
    const options = value => graph.nodes.map(node=>`<option value="${esc(node.id)}" ${node.id===value?'selected':''}>${esc(node.label || node.id)}</option>`).join('');
    function renderInspector() {
      const item = selection();
      if (!item) { inspector.innerHTML = '<p class="flow-inspector-empty">选择节点或连线</p>';return; }
      inspector.innerHTML = selected.kind === 'node'
        ? `<h3>节点</h3><label>文字<input data-flow-label maxlength="120" value="${esc(item.label)}" aria-label="节点文字"></label><label>形状<select data-flow-shape aria-label="节点形状"><option value="rect" ${item.shape==='rect'?'selected':''}>矩形</option><option value="round" ${item.shape==='round'?'selected':''}>圆角</option><option value="diamond" ${item.shape==='diamond'?'selected':''}>判断</option></select></label><button class="flow-inspector-action" data-flow="connect-from">${svgIcon('link')}从此处连线</button><button class="flow-inspector-action" data-flow="branch-from">${svgIcon('branch')}添加分支</button><button class="flow-inspector-action flow-danger" data-flow="delete">${svgIcon('delete')}删除节点</button>`
        : `<h3>连线</h3><label>文字<input data-flow-label maxlength="60" value="${esc(item.label)}" placeholder="例如：是 / 否" aria-label="连线文字"></label><label>起点<select data-flow-from aria-label="连线起点">${options(item.from)}</select></label><label>终点<select data-flow-to aria-label="连线终点">${options(item.to)}</select></label><button class="flow-inspector-action flow-danger" data-flow="delete">${svgIcon('delete')}删除连线</button>`;
    }

    function draw() {
      if (!graph.ok) return;
      for (const node of graph.nodes) if (!positions.has(node.id)) positions.set(node.id,{x:180+(positions.size%3)*230,y:100+Math.floor(positions.size/3)*145});
      const maxX = Math.max(700,...[...positions.values()].map(p=>p.x+140)), maxY = Math.max(480,...[...positions.values()].map(p=>p.y+100));
      canvas.setAttribute('viewBox',`0 0 ${maxX} ${maxY}`); canvas.style.width = `${maxX}px`; canvas.style.height = `${maxY}px`;
      query('.flow-nodes').innerHTML = graph.nodes.map(node => {
        const point=positions.get(node.id), current=selected?.kind==='node'&&selected.id===node.id;
        const shape=node.shape==='diamond'?'<path d="M0-46 92 0 0 46-92 0Z"/>':`<rect x="-82" y="-30" width="164" height="60" rx="${node.shape==='round'?30:7}"/>`;
        const text=node.label.length>13?node.label.slice(0,12)+'…':node.label;
        return `<g class="flow-node ${current?'selected':''} ${connecting===node.id?'connecting':''}" data-flow-node="${esc(node.id)}" transform="translate(${point.x} ${point.y})" role="button" tabindex="0" aria-label="节点 ${esc(node.label)}" aria-pressed="${current}">${shape}<text text-anchor="middle" dy=".35em">${esc(text)}</text><title>${esc(node.label)}</title></g>`;
      }).join('');
      query('.flow-edges').innerHTML = graph.edges.map((edge,index)=> {
        const a=positions.get(edge.from),b=positions.get(edge.to); if(!a||!b)return'';
        const horizontal=graph.direction==='LR'||graph.direction==='RL', backwards=horizontal?b.x<a.x:b.y<a.y;
        const fromNode=graph.nodes.find(node=>node.id===edge.from),toNode=graph.nodes.find(node=>node.id===edge.to);
        const extent=(node,h)=>node.shape==='diamond'?(h?92:46):(h?82:30);
        const start=horizontal?{x:a.x+(backwards?-1:1)*extent(fromNode,true),y:a.y}:{x:a.x,y:a.y+(backwards?-1:1)*extent(fromNode,false)};
        const end=horizontal?{x:b.x+(backwards?1:-1)*extent(toNode,true),y:b.y}:{x:b.x,y:b.y+(backwards?1:-1)*extent(toNode,false)};
        let path, lx=(start.x+end.x)/2,ly=(start.y+end.y)/2;
        if(edge.from===edge.to) {path=`M${a.x+82} ${a.y} C${a.x+155} ${a.y-90} ${a.x+155} ${a.y+90} ${a.x+82} ${a.y+10}`;lx=a.x+145;ly=a.y;}
        else if(!horizontal&&start.x===end.x&&Math.abs(end.y-start.y)>190){lx=start.x+125+(index%3)*18;path=`M${start.x} ${start.y} H${lx} V${end.y+(backwards?20:-20)} H${end.x} V${end.y}`;}
        else if(horizontal&&start.y===end.y&&Math.abs(end.x-start.x)>260){ly=start.y+100+(index%3)*18;path=`M${start.x} ${start.y} V${ly} H${end.x+(backwards?20:-20)} V${end.y} H${end.x}`;}
        else path=horizontal?`M${start.x} ${start.y} H${lx} V${end.y} H${end.x}`:`M${start.x} ${start.y} V${ly} H${end.x} V${end.y}`;
        const current=selected?.kind==='edge'&&selected.index===index;
        return `<g class="flow-edge ${current?'selected':''}" data-flow-edge="${index}" role="button" tabindex="0" aria-label="连线 ${esc(fromNode.label)} 到 ${esc(toNode.label)}${edge.label?' '+esc(edge.label):''}" aria-pressed="${current}"><path class="flow-edge-hit" d="${path}"/><path class="flow-edge-line" d="${path}" marker-end="url(#${diagramId}-arrow)"/>${edge.label?`<rect x="${lx-Math.min(edge.label.length,12)*6-7}" y="${ly-12}" width="${Math.min(edge.label.length,12)*12+14}" height="24" rx="4"/><text x="${lx}" y="${ly}" text-anchor="middle" dy=".35em">${esc(edge.label.slice(0,12))}</text>`:''}</g>`;
      }).join('');
      query('[data-flow-direction]').value = graph.direction === 'TB' ? 'TD' : graph.direction;
      query('[data-flow="connect"]').setAttribute('aria-pressed',String(connectMode));
    }

    function changed() { raw=serializeDrawing(graph);sourceEditor.setValue(raw);draw();setMessage(''); }
    function select(kind,value) {
      selected=kind==='node'?{kind,id:value}:{kind,index:Number(value)};draw();renderInspector();
      query(kind==='node'?`[data-flow-node="${value}"]`:`[data-flow-edge="${value}"]`)?.focus({preventScroll:true});
    }
    function newNode(label='新节点',shape='rect',point) {
      let id; do{id=`N${nextNode++}`;}while(graph.nodes.some(node=>node.id===id));
      graph.nodes.push({id,label,shape});if(point)positions.set(id,point);return id;
    }
    function branch() {
      const item=selection(), parent=item&&selected.kind==='node'?item:null;
      const id=parent?.shape==='diamond'?parent.id:newNode('条件','diamond',parent?{x:positions.get(parent.id).x,y:positions.get(parent.id).y+140}:undefined);
      if(parent&&id!==parent.id)graph.edges.push({from:parent.id,to:id,label:''});
      const point=positions.get(id)||{x:300,y:100};positions.set(id,point);
      const horizontal=graph.direction==='LR'||graph.direction==='RL';
      const yes=newNode('满足条件','rect',horizontal?{x:point.x+230,y:point.y-90}:{x:point.x-125,y:point.y+145});
      const no=newNode('其他情况','rect',horizontal?{x:point.x+230,y:point.y+90}:{x:point.x+125,y:point.y+145});
      graph.edges.push({from:id,to:yes,label:'是'},{from:id,to:no,label:'否'});selected={kind:'node',id};changed();renderInspector();
    }
    function deleteSelected() {
      if(!selected)return;
      if(selected.kind==='node') {graph.nodes=graph.nodes.filter(node=>node.id!==selected.id);graph.edges=graph.edges.filter(edge=>edge.from!==selected.id&&edge.to!==selected.id);positions.delete(selected.id);}
      else graph.edges.splice(selected.index,1);
      selected=null;connecting=null;changed();renderInspector();
    }

    function switchMode(next) {
      if(next==='draw'&&!graph.ok){setMessage(graph.reason+'。原文已保留。');return;}
      mode=next;
      query('.flow-draw').hidden=mode!=='draw';query('.flow-source-layout').hidden=mode!=='mermaid';
      for(const button of overlay.querySelectorAll('[role="tab"]')) {const current=button.dataset.flow===mode;button.setAttribute('aria-selected',String(current));button.tabIndex=current?0:-1;}
      query('[data-flow="draw"]').setAttribute('aria-disabled',String(!graph.ok));
      query('.flow-mode-hint').textContent=mode==='draw'?'位置仅在本次绘制中保留':'';
      if(mode==='mermaid'){renderFlowPreview(preview,raw);setMessage(graph.ok?'':graph.reason+'。原文已保留，可继续编辑并预览。');}
      else {connectMode=false;connecting=null;selected=null;setMessage('');draw();renderInspector();}
    }

    overlay.addEventListener('click',async event => {
      const node=event.target.closest('[data-flow-node]'), edge=event.target.closest('[data-flow-edge]');
      if(node) {
        const id=node.dataset.flowNode;
        if(drag?.moved){drag=null;return;}
        if(connectMode) {
          if(!connecting){connecting=id;hint('请选择终点');draw();}
          else {const from=connecting;graph.edges.push({from,to:id,label:''});connecting=null;connectMode=false;selected={kind:'edge',index:graph.edges.length-1};changed();renderInspector();hint();}
        } else select('node',id);
        return;
      }
      if(edge) {select('edge',edge.dataset.flowEdge);return;}
      const action=event.target.closest('[data-flow]')?.dataset.flow;
      if(action==='close')close();
      if(action==='format') { const done=await sourceEditor.format(); if(done&&!destroyed)setMessage(''); }
      if(action==='draw'||action==='mermaid')switchMode(action);
      if(action==='add'){
        if(graph.nodes.length>=60){setMessage('绘制模式最多支持 60 个节点，可切换 Mermaid 继续编辑。');return;}
        const id=newNode();selected={kind:'node',id};changed();renderInspector();query('[data-flow-label]')?.focus();query('[data-flow-label]')?.select();
      }
      if(action==='branch'||action==='branch-from'){
        if(graph.nodes.length>57){setMessage('绘制模式最多支持 60 个节点，可切换 Mermaid 继续编辑。');return;}
        branch();
      }
      if(action==='delete')deleteSelected();
      if(action==='layout'){layout();draw();}
      if(action==='connect'||action==='connect-from'){connectMode=action==='connect-from'||!connectMode;connecting=action==='connect-from'?selected.id:null;draw();hint(connectMode?(connecting?'请选择终点':'请选择起点，再选择终点'):'');}
      if(action==='save') {
        const save=query('[data-flow="save"]');if(save.disabled)return;save.disabled=true;
        try { await onSave(raw);close(true); }
        catch(error){if(!destroyed){setMessage(`未能保存：${error.message || error}`);save.disabled=false;}}
      }
    });
    overlay.addEventListener('dblclick',event=>{if(event.target.closest('[data-flow-node]')){query('[data-flow-label]')?.focus();query('[data-flow-label]')?.select();}});
    overlay.addEventListener('input',event=> {
      if(event.target.matches('[data-flow-label]')){const item=selection();if(item){item.label=event.target.value;changed();}}
    });
    overlay.addEventListener('change',event=> {
      if(event.target.matches('[data-flow-direction]')){graph.direction=event.target.value;layout();changed();return;}
      const item=selection();if(!item)return;
      if(event.target.matches('[data-flow-shape]'))item.shape=event.target.value;
      if(event.target.matches('[data-flow-from]'))item.from=event.target.value;
      if(event.target.matches('[data-flow-to]'))item.to=event.target.value;
      changed();
    });

    canvas.addEventListener('pointerdown',event=> {
      const node=event.target.closest('[data-flow-node]');if(!node||connectMode||event.button!==0)return;
      const matrix=canvas.getScreenCTM();if(!matrix)return;
      event.preventDefault();const point=positions.get(node.dataset.flowNode);
      const start=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      drag={id:node.dataset.flowNode,x:point.x,y:point.y,start,moved:false};canvas.setPointerCapture(event.pointerId);
      selected={kind:'node',id:drag.id};draw();renderInspector();
    });
    canvas.addEventListener('pointermove',event=> {
      if(!drag||!canvas.hasPointerCapture(event.pointerId))return;
      const matrix=canvas.getScreenCTM();if(!matrix)return;
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      const dx=point.x-drag.start.x,dy=point.y-drag.start.y;
      if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
      positions.set(drag.id,{x:Math.max(105,drag.x+dx),y:Math.max(65,drag.y+dy)});draw();
    });
    const endDrag=event=>{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(drag&&!drag.moved)drag=null;};
    canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',()=>{drag=null;});
    overlay.addEventListener('keydown',event=> {
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();if(connectMode){connectMode=false;connecting=null;draw();hint();}else close();return;}
      if(event.key==='Tab'&&!event.defaultPrevented) {
        const controls=[...overlay.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(element=>!element.closest('[hidden]')&&element.getClientRects().length);
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
      const tab=event.target.closest('[role="tab"]');
      if(tab&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=mode==='draw'?'mermaid':'draw';switchMode(next);if(next===mode)query(`[data-flow="${mode}"]`).focus();return;}
      const node=event.target.closest('[data-flow-node]'),edge=event.target.closest('[data-flow-edge]');
      if((node||edge)&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
      if((node||edge)&&['Backspace','Delete'].includes(event.key)){event.preventDefault();if(node)selected={kind:'node',id:node.dataset.flowNode};else selected={kind:'edge',index:Number(edge.dataset.flowEdge)};deleteSelected();query('[data-flow="add"]').focus();}
      if(node&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
        event.preventDefault();const id=node.dataset.flowNode,point=positions.get(id),step=event.shiftKey?30:10;
        if(event.key==='ArrowLeft')point.x=Math.max(105,point.x-step);if(event.key==='ArrowRight')point.x+=step;
        if(event.key==='ArrowUp')point.y=Math.max(65,point.y-step);if(event.key==='ArrowDown')point.y+=step;
        draw();query(`[data-flow-node="${id}"]`)?.focus();
      }
    });
    overlay.addEventListener('keyup',event=>event.stopPropagation());
    layout();switchMode(mode);query(`[data-flow="${mode}"]`).focus();
    return {destroy:()=>close(true)};
  }

