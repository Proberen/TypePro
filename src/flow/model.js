// The drawing view only accepts Mermaid constructs it can preserve.
  export function parseDrawing(source) {
    const lines = source.split(/\r?\n/), nodes = [], edges = [], comments = [], known = new Map();
    let direction = null;
    const fail = message => ({ok:false, reason:message});
    const decodeLabel = label => label.replace(/#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
    const addNode = token => {
      const match = token.trim().match(/^([A-Za-z_][\w-]*)(?:\[([^\[\]]*)\]|\{([^{}]*)\}|\(([^()]*)\))?$/);
      if (!match) throw new Error('包含暂不支持的节点形状或写法');
      const [, id, rectangle, diamond, rounded] = match;
      const text = rectangle ?? diamond ?? rounded;
      const shape = diamond !== undefined ? 'diamond' : rounded !== undefined ? 'round' : 'rect';
      let label = text === undefined ? id : text.trim();
      if (/^".*"$/.test(label)) label = label.slice(1, -1);
      if (/["<>]|\[|\]|\{|\}|\(|\)|\\|&/.test(label)) throw new Error('节点含富文本、转义或复杂标签');
      label = decodeLabel(label);
      if (!known.has(id)) {
        const node = {id,label,shape}; known.set(id,node); nodes.push(node);
      } else if (text !== undefined) {
        const node = known.get(id);
        if (node.declared && (node.label !== label || node.shape !== shape)) throw new Error('同一节点存在多种定义');
        node.label = label; node.shape = shape;
      }
      if (text !== undefined) known.get(id).declared = true;
      return id;
    };
    try {
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith('%%') && !line.startsWith('%%{')) {comments.push(line);continue;}
        if (!direction) {
          const header = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*;?$/);
          if (!header) return fail('绘制模式支持基础 flowchart / graph 流程图');
          direction = header[1]; continue;
        }
        line = line.replace(/;$/, '');
        if (/^(?:subgraph|end|style|classDef|class|click|linkStyle|direction)\b|%%\{|---|==>|-\.->|&/.test(line)) return fail('包含分组、样式或复杂连线，请继续使用 Mermaid 编辑');
        const parts = line.split(/\s*-->\s*(?:\|([^|]*)\|\s*)?/);
        if (parts.length === 1) addNode(line);
        else {
          let from = addNode(parts[0]);
          for (let index = 1; index < parts.length; index += 2) {
            const label = (parts[index] ?? '').trim();
            if (/[|<>"&\\]/.test(label)) return fail('连线含富文本或复杂标签，请继续使用 Mermaid 编辑');
            const to = addNode(parts[index + 1]);
            edges.push({from,to,label:decodeLabel(label)}); from = to;
          }
        }
      }
      if (!direction || !nodes.length) return fail('先写一个带节点的 flowchart 流程图');
      if (nodes.length > 60 || edges.length > 100) return fail('这张图较大，请继续使用 Mermaid 编辑');
      return {ok:true, direction, nodes, edges, comments};
    } catch (error) { return fail(error.message); }
  }

  const encodeLabel = text => String(text).replace(/[#"<>\[\]{}()&|\\\n\r]/g, character => `#${character.codePointAt(0)};`);
  export function serializeDrawing(graph) {
    const lines = [`flowchart ${graph.direction}`,...graph.comments];
    for (const node of graph.nodes) {
      const [left,right] = node.shape === 'diamond' ? ['{','}'] : node.shape === 'round' ? ['(',')'] : ['[',']'];
      lines.push(`  ${node.id}${left}"${encodeLabel(node.label)}"${right}`);
    }
    for (const edge of graph.edges) lines.push(`  ${edge.from} -->${edge.label ? `|${encodeLabel(edge.label)}|` : ''} ${edge.to}`);
    return lines.join('\n');
  }

