// node·edge 도표의 배치. 왼쪽에서 오른쪽으로 층을 쌓는 결정적 배치이고 순수 함수다.
// 순환은 입력 순서의 DFS로 끊고, 되돌아가는 edge는 층을 정하는 데 쓰지 않는다.
// @ts-types="@types/d3-shape"
import { linkHorizontal } from "d3-shape";
import { tokens } from "../../../tokens.ts";
import { largest, textWidth } from "./geometry.ts";
import type { GraphEdge, GraphNode } from "./types.ts";

const px = (value: string) => Number.parseFloat(value);

export const NODE_HEIGHT = px(tokens.table.row.compact);
// 첫 줄(label) 아래에 줄마다 caption 줄 높이만큼 늘어난다. 맨 아래 여백은 NODE_HEIGHT에 이미 있다.
const LINE = px(tokens.type.caption.line);
const LABEL_LINE = px(tokens.type.small.line);
export const ICON_SIZE = px(tokens.icon.size.small);
export const ICON_GAP = px(tokens.space[2]);
const PAD = px(tokens.space[5]);
const ROW_GAP = px(tokens.space[5]);
const COLUMN_GAP = px(tokens.space[10]);
// 이보다 긴 이름은 줄여 보이고 전체는 tooltip으로 읽는다.
const LABEL_LIMIT = 24;
// note는 node 폭을 밀지 않도록 이만큼에서 줄인다.
export const NOTE_LIMIT = 40;

function shorten(label: string, limit = LABEL_LIMIT): string {
  const characters = [...label];
  return characters.length <= limit
    ? label
    : `${characters.slice(0, limit - 1).join("")}…`;
}

// node 높이: status와 note가 없으면 NODE_HEIGHT이고, 있는 줄마다 늘어난다.
export function nodeHeight(node: GraphNode): number {
  const lines = (node.status === undefined ? 0 : 1) +
    (node.note === undefined ? 0 : 1);
  return NODE_HEIGHT + lines * LINE;
}

// 상태 줄은 아이콘과 글이 한 줄이다.
function statusWidth(node: GraphNode): number {
  return node.status === undefined
    ? 0
    : ICON_SIZE + ICON_GAP + textWidth(shorten(node.status.label));
}

function nodeTextWidth(node: GraphNode): number {
  return largest([
    textWidth(shorten(node.label)),
    statusWidth(node),
    node.note === undefined ? 0 : textWidth(shorten(node.note, NOTE_LIMIT)),
  ]);
}

interface PlacedNode extends GraphNode {
  readonly shortLabel: string;
  readonly shortStatus?: string;
  readonly shortNote?: string;
  // node 위쪽에서 각 줄 가운데까지의 거리.
  readonly labelY: number;
  readonly statusY: number;
  readonly noteY: number;
  // 상태 줄(아이콘+글)을 가운데에 두는 왼쪽 x(node 안 상대).
  readonly statusX: number;
  readonly height: number;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

interface PlacedEdge extends GraphEdge {
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly shortLabel?: string;
}

interface GraphLayout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly width: number;
  readonly height: number;
}

// 입력 순서 DFS에서 조상으로 돌아가는 edge의 자리.
function backEdges(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Set<number> {
  const out = new Map<string, number[]>();
  edges.forEach((edge, index) =>
    out.set(edge.from, [...(out.get(edge.from) ?? []), index])
  );
  const state = new Map<string, "open" | "done">();
  const back = new Set<number>();
  // 깊은 graph에서도 call stack을 넘지 않게 직접 stack을 쓴다.
  for (const root of nodes) {
    if (state.has(root.id)) continue;
    const stack: { id: string; next: number }[] = [{ id: root.id, next: 0 }];
    state.set(root.id, "open");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id) ?? [];
      if (top.next >= list.length) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      const index = list[top.next++];
      const target = edges[index].to;
      const seen = state.get(target);
      if (seen === "open") back.add(index);
      else if (seen === undefined) {
        state.set(target, "open");
        stack.push({ id: target, next: 0 });
      }
    }
  }
  return back;
}

// 앞으로 가는 edge만으로 가장 긴 경로 층을 정한다.
function layers(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  back: Set<number>,
): Map<string, number> {
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const forward = edges.filter((_, index) => !back.has(index));
  for (const edge of forward) {
    incoming.set(edge.to, incoming.get(edge.to)! + 1);
  }
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((
    node,
  ) => node.id);
  for (let at = 0; at < queue.length; at += 1) {
    const id = queue[at];
    for (const edge of forward) {
      if (edge.from !== id) continue;
      layer.set(edge.to, Math.max(layer.get(edge.to)!, layer.get(id)! + 1));
      incoming.set(edge.to, incoming.get(edge.to)! - 1);
      if (incoming.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  return layer;
}

const link = linkHorizontal();

// 검증을 마친 입력(id가 겹치지 않고 edge가 있는 node를 가리킴)을 받는다.
export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphLayout {
  const back = backEdges(nodes, edges);
  const layerOf = layers(nodes, edges, back);
  const columns: GraphNode[][] = [];
  for (const node of nodes) {
    (columns[layerOf.get(node.id)!] ??= []).push(node);
  }
  const edgeRoom = largest(
    edges.map((edge) =>
      edge.label === undefined ? 0 : textWidth(shorten(edge.label)) + PAD * 2
    ),
  );
  const gap = Math.max(COLUMN_GAP, edgeRoom);
  const spanOf = (column: readonly GraphNode[]) =>
    column.reduce((sum, node) => sum + nodeHeight(node), 0) +
    (column.length - 1) * ROW_GAP;
  const height = largest(columns.map(spanOf));
  const placed = new Map<string, PlacedNode>();
  let x = 0;
  columns.forEach((column, layer) => {
    const width = largest(column.map((node) => nodeTextWidth(node) + PAD * 2));
    let y = (height - spanOf(column)) / 2;
    for (const node of column) {
      const nodeH = nodeHeight(node);
      const statusY = NODE_HEIGHT / 2 + LABEL_LINE / 2 + LINE / 2;
      const noteY = statusY + (node.status === undefined ? 0 : LINE);
      placed.set(node.id, {
        ...node,
        shortLabel: shorten(node.label),
        shortStatus: node.status && shorten(node.status.label),
        shortNote: node.note === undefined
          ? undefined
          : shorten(node.note, NOTE_LIMIT),
        labelY: NODE_HEIGHT / 2,
        statusY,
        noteY,
        statusX: (width - statusWidth(node)) / 2,
        layer,
        x,
        y,
        width,
        height: nodeH,
      });
      y += nodeH + ROW_GAP;
    }
    x += width + gap;
  });
  const placedEdges = edges.map((edge) => {
    const from = placed.get(edge.from)!;
    const to = placed.get(edge.to)!;
    // 되돌아가는 edge는 왼쪽 면에서 나가 앞 층의 오른쪽 면으로 들어간다.
    const forward = to.layer > from.layer;
    const start: [number, number] = [
      forward ? from.x + from.width : from.x,
      from.y + from.height / 2,
    ];
    const end: [number, number] = [
      forward ? to.x : to.x + to.width,
      to.y + to.height / 2,
    ];
    return {
      ...edge,
      path: link({ source: start, target: end }) ?? "",
      labelX: (start[0] + end[0]) / 2,
      labelY: (start[1] + end[1]) / 2,
      shortLabel: edge.label === undefined ? undefined : shorten(edge.label),
    };
  });
  return {
    nodes: nodes.map((node) => placed.get(node.id)!),
    edges: placedEdges,
    width: Math.max(0, x - gap),
    height,
  };
}
