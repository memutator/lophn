// node·edge 도표의 배치. 왼쪽에서 오른쪽으로 층을 쌓는 결정적 배치이고 순수 함수다.
// 순환은 입력 순서의 DFS로 끊고, 되돌아가는 edge는 층을 정하는 데 쓰지 않는다.
// @ts-types="@types/d3-shape"
import { linkHorizontal } from "d3-shape";
import { tokens } from "@lophn/design";
import { largest, textWidth } from "./geometry.ts";
import type { GraphEdge, GraphNode } from "./types.ts";

const px = (value: string) => Number.parseFloat(value);

export const NODE_HEIGHT = px(tokens.table.row.compact);
const PAD = px(tokens.space[5]);
const ROW_GAP = px(tokens.space[5]);
const COLUMN_GAP = px(tokens.space[10]);
// 이보다 긴 이름은 줄여 보이고 전체는 tooltip으로 읽는다.
const LABEL_LIMIT = 24;

function shorten(label: string, limit = LABEL_LIMIT): string {
  const characters = [...label];
  return characters.length <= limit
    ? label
    : `${characters.slice(0, limit - 1).join("")}…`;
}

interface PlacedNode extends GraphNode {
  readonly shortLabel: string;
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
  const rows = largest(columns.map((column) => column.length));
  const height = rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
  const placed = new Map<string, PlacedNode>();
  let x = 0;
  columns.forEach((column, layer) => {
    const width = largest(
      column.map((node) => textWidth(shorten(node.label)) + PAD * 2),
    );
    const span = column.length * NODE_HEIGHT + (column.length - 1) * ROW_GAP;
    const offset = (height - span) / 2;
    column.forEach((node, row) =>
      placed.set(node.id, {
        ...node,
        shortLabel: shorten(node.label),
        layer,
        x,
        y: offset + row * (NODE_HEIGHT + ROW_GAP),
        width,
      })
    );
    x += width + gap;
  });
  const placedEdges = edges.map((edge) => {
    const from = placed.get(edge.from)!;
    const to = placed.get(edge.to)!;
    // 되돌아가는 edge는 왼쪽 면에서 나가 앞 층의 오른쪽 면으로 들어간다.
    const forward = to.layer > from.layer;
    const start: [number, number] = [
      forward ? from.x + from.width : from.x,
      from.y + NODE_HEIGHT / 2,
    ];
    const end: [number, number] = [
      forward ? to.x : to.x + to.width,
      to.y + NODE_HEIGHT / 2,
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
