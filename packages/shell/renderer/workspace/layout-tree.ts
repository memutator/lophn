// 칸 배치 tree. `WorkspaceView.panes`의 i번째 칸이 tree의 i번째 잎이다(왼쪽·위에서 오른쪽·아래로 읽은 순서).
// 잎은 칸을 가리키는 값이 없어서 칸을 넣고 뺄 때 배열과 tree를 같은 index로 같이 고친다.

export const MAX_PANES = 6;
export const SPLIT_EQUAL = 0.5;

/** 칸 최소 크기와 경계. 칸 높이에는 탭 줄(control-lg)이 든다. */
const PANE_MIN_WIDTH = 320;
const PANE_MIN_HEIGHT = 240;
const DIVIDER = 1;

export type SplitDir = "row" | "column";
export type PaneSide = "left" | "right" | "top" | "bottom";

export interface SplitNode {
  /** row는 a가 왼쪽, column은 a가 위. */
  readonly dir: SplitDir;
  /** a가 차지하는 몫. 경계를 뺀 길이에 대한 비율이고 0보다 크고 1보다 작다. */
  readonly ratio: number;
  readonly a: LayoutNode;
  readonly b: LayoutNode;
}

export type LayoutNode = "leaf" | SplitNode;

export function leafCount(node: LayoutNode): number {
  return node === "leaf" ? 1 : leafCount(node.a) + leafCount(node.b);
}

/** 같은 폭으로 가로로 늘어놓은 칸 count개. */
export function evenRow(count: number): LayoutNode {
  if (count <= 1) return "leaf";
  return { dir: "row", ratio: 1 / count, a: "leaf", b: evenRow(count - 1) };
}

/** index번째 잎을 둘로 나눈다. 새 잎이 앞인지 뒤인지는 칸 배열에 넣는 자리가 정한다. */
export function splitLeaf(
  node: LayoutNode,
  index: number,
  dir: SplitDir,
): LayoutNode {
  if (node === "leaf") {
    return { dir, ratio: SPLIT_EQUAL, a: "leaf", b: "leaf" };
  }
  const before = leafCount(node.a);
  return index < before
    ? { ...node, a: splitLeaf(node.a, index, dir) }
    : { ...node, b: splitLeaf(node.b, index - before, dir) };
}

/** index번째 잎을 지운다. 부모 나눔이 사라지고 그 자리에 형제가 선다. 잎 하나뿐이면 그대로다. */
export function removeLeaf(node: LayoutNode, index: number): LayoutNode {
  if (node === "leaf") return node;
  const before = leafCount(node.a);
  if (index < before) {
    return node.a === "leaf"
      ? node.b
      : { ...node, a: removeLeaf(node.a, index) };
  }
  return node.b === "leaf"
    ? node.a
    : { ...node, b: removeLeaf(node.b, index - before) };
}

/** 경로("a"/"b"를 root부터 이은 글)가 가리키는 나눔의 비율을 바꾼다. */
export function setRatio(
  node: LayoutNode,
  path: string,
  ratio: number,
): LayoutNode {
  if (node === "leaf") return node;
  if (path === "") return { ...node, ratio };
  const rest = path.slice(1);
  return path[0] === "a"
    ? { ...node, a: setRatio(node.a, rest, ratio) }
    : { ...node, b: setRatio(node.b, rest, ratio) };
}

export function nodeAt(node: LayoutNode, path: string): SplitNode | undefined {
  if (node === "leaf") return undefined;
  if (path === "") return node;
  return nodeAt(path[0] === "a" ? node.a : node.b, path.slice(1));
}

function minSize(node: LayoutNode, axis: "width" | "height"): number {
  if (node === "leaf") {
    return axis === "width" ? PANE_MIN_WIDTH : PANE_MIN_HEIGHT;
  }
  const a = minSize(node.a, axis);
  const b = minSize(node.b, axis);
  return (node.dir === "row") === (axis === "width")
    ? a + b + DIVIDER
    : Math.max(a, b);
}

/**
 * 모든 칸이 최소 크기로 들어가는지. 부족하면 저장된 비율·탭 소속을 바꾸지 않고 focus 칸 하나만 보인다.
 * 높이를 아직 못 쟀으면 높이는 보지 않는다.
 */
export function fitsArea(
  node: LayoutNode,
  width: number,
  height: number | undefined,
): boolean {
  return (
    minSize(node, "width") <= width &&
    (height === undefined || minSize(node, "height") <= height)
  );
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Divider extends Box {
  /** root부터 "a"/"b"를 이은 경로. setRatio와 nodeAt이 쓴다. */
  readonly path: string;
  readonly dir: SplitDir;
  /** 이 나눔 전체의 길이(경계 포함)와 지금 a가 차지하는 길이. */
  readonly total: number;
  readonly sizeA: number;
  /** a·b가 가질 수 있는 최소 길이. */
  readonly minA: number;
  readonly minB: number;
}

export interface Arranged {
  /** 잎 순서의 칸 사각형. */
  readonly panes: readonly Box[];
  readonly dividers: readonly Divider[];
}

/** 비율대로 나누되 양쪽이 최소 크기 아래로 내려가지 않게 가둔다. */
function splitSize(
  node: SplitNode,
  total: number,
): { a: number; minA: number; minB: number } {
  const axis = node.dir === "row" ? "width" : "height";
  const minA = minSize(node.a, axis);
  const minB = minSize(node.b, axis);
  const usable = total - DIVIDER;
  const a = Math.min(
    Math.max(minA, usable - minB),
    Math.max(minA, Math.round(usable * node.ratio)),
  );
  return { a, minA, minB };
}

/** 영역 안에 칸과 경계의 자리를 정한다. 좌표는 영역 왼쪽 위 기준 px다. */
export function arrange(node: LayoutNode, box: Box, path = ""): Arranged {
  if (node === "leaf") return { panes: [box], dividers: [] };
  const row = node.dir === "row";
  const { a, minA, minB } = splitSize(node, row ? box.width : box.height);
  const total = row ? box.width : box.height;
  const boxA: Box = row ? { ...box, width: a } : { ...box, height: a };
  const rest = total - a - DIVIDER;
  const boxB: Box = row
    ? { ...box, x: box.x + a + DIVIDER, width: rest }
    : { ...box, y: box.y + a + DIVIDER, height: rest };
  const line: Box = row
    ? { x: box.x + a, y: box.y, width: DIVIDER, height: box.height }
    : { x: box.x, y: box.y + a, width: box.width, height: DIVIDER };
  const first = arrange(node.a, boxA, `${path}a`);
  const second = arrange(node.b, boxB, `${path}b`);
  return {
    panes: [...first.panes, ...second.panes],
    dividers: [
      { ...line, path, dir: node.dir, total, sizeA: a, minA, minB },
      ...first.dividers,
      ...second.dividers,
    ],
  };
}

/** 경계 drag로 a가 차지할 비율. 시작할 때의 a 길이에 움직인 거리를 더하고 양쪽 최소 크기 안에 가둔다. */
export function ratioFromDrag(divider: Divider, delta: number): number {
  const usable = divider.total - DIVIDER;
  const a = Math.min(
    usable - divider.minB,
    Math.max(divider.minA, divider.sizeA + delta),
  );
  return a / usable;
}
