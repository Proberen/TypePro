import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDrawing, serializeDrawing } from './model.js';

test('basic flowchart shapes, chains and labels survive drawing serialization', () => {
  const source = 'graph TD\n%% 保留注释\nA[开始] --> B{判断}\nB -->|是| C(完成)\nB -->|否| A';
  const graph = parseDrawing(source);
  assert.equal(graph.ok, true);
  assert.deepEqual(graph.nodes.map(({ id, label, shape }) => ({ id, label, shape })), [
    { id: 'A', label: '开始', shape: 'rect' },
    { id: 'B', label: '判断', shape: 'diamond' },
    { id: 'C', label: '完成', shape: 'round' },
  ]);
  assert.deepEqual(parseDrawing(serializeDrawing(graph)), graph);
});

test('all supported directions and disconnected nodes round-trip', () => {
  for (const direction of ['TD', 'TB', 'BT', 'LR', 'RL']) {
    const graph = parseDrawing(`flowchart ${direction}\nA[独立节点]\nB --> C`);
    assert.equal(graph.ok, true);
    const roundtrip = parseDrawing(serializeDrawing(graph));
    assert.equal(roundtrip.ok, true);
    assert.equal(roundtrip.direction, direction);
    assert.deepEqual(roundtrip.edges, graph.edges);
    assert.equal(roundtrip.nodes.length, 3);
  }
});

test('user-entered punctuation is encoded into Mermaid and decoded once', () => {
  const graph = parseDrawing('flowchart LR\nA[开始] --> B[完成]');
  assert.equal(graph.ok, true);
  graph.nodes[0].label = '标题 "<>&[]{}()|\\\n#123;';
  graph.edges[0].label = '是 | 否 #35; & "';
  const roundtrip = parseDrawing(serializeDrawing(graph));
  assert.equal(roundtrip.ok, true);
  assert.equal(roundtrip.nodes[0].label, graph.nodes[0].label);
  assert.equal(roundtrip.edges[0].label, graph.edges[0].label);
});

test('complex source stays outside drawing rather than losing syntax', () => {
  for (const source of [
    'flowchart TD\nsubgraph Group\n A --> B\nend',
    'flowchart TD\nA[开始] --> B[完成]\nstyle A fill:red',
    'flowchart LR\nA -.-> B',
    'sequenceDiagram\nAlice->>Bob: 你好',
    '%%{init: {"theme":"dark"}}%%\nflowchart TD\nA --> B',
    'flowchart TD\nA["<b>富文本</b>"] --> B',
  ]) {
    const original = source;
    assert.equal(parseDrawing(source).ok, false);
    assert.equal(source, original);
  }
});

test('conflicting declarations, broken entities and oversized diagrams fail safely', () => {
  assert.equal(parseDrawing('flowchart TD\nA[甲]\nA[乙]').ok, false);
  assert.equal(parseDrawing('flowchart TD\nA[#999999999;]').ok, false);
  assert.equal(parseDrawing('flowchart TD\n' + Array.from({ length: 61 }, (_, i) => `N${i}[节点]`).join('\n')).ok, false);
  assert.equal(parseDrawing('').ok, false);
});
