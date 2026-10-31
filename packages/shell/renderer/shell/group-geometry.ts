// group 배치 tree를 card 안의 칸 자리로 푼다. 칸은 tree 구조와 상관없이 card 안에 평평하게 놓이는 absolute 상자라
// 구조가 바뀌어도 칸 본문의 React 부모가 바뀌지 않는다(본문이 다시 mount되지 않는다). 자리는 CSS calc 식이라
// card 크기를 재지 않고도 맞고, 끄는 동안의 계산은 같은 식을 px로 푼 `dragRatio`가 한다.
import type { GroupNode, NodePath, SplitDir } from "./desk-model.ts";

/** CSS 길이 식 넷. card(layer) 왼쪽 위 기준이다. */
export interface CssBox {
  readonly x: string;
  readonly y: string;
  readonly w: string;
  readonly h: string;
}

export interface PlacedSplit {
  readonly path: NodePath;
  readonly dir: SplitDir;
  /** 나누는 선의 끌 자리. 실제 폭(gap)을 가진다. */
  readonly box: CssBox;
}

export interface Placed {
  readonly leaves: ReadonlyMap<string, CssBox>;
  readonly splits: readonly PlacedSplit[];
}

export const FULL: CssBox = { x: "0px", y: "0px", w: "100%", h: "100%" };

/** gap은 나누는 선의 두께(CSS 길이)다. */
export function placeGroup(root: GroupNode, gap: string): Placed {
  const leaves = new Map<string, CssBox>();
  const splits: PlacedSplit[] = [];
  const walk = (node: GroupNode, box: CssBox, path: NodePath) => {
    if ("tab" in node) {
      leaves.set(node.tab, box);
      return;
    }
    const row = node.dir === "row";
    const size = row ? box.w : box.h;
    const a = `calc((${size} - ${gap}) * ${node.ratio})`;
    const b = `calc((${size} - ${gap}) * ${1 - node.ratio})`;
    const at = (origin: string, ...parts: string[]) =>
      `calc(${[origin, ...parts].join(" + ")})`;
    const boxOf = (start: string[], length: string): CssBox =>
      row
        ? { x: at(box.x, ...start), y: box.y, w: length, h: box.h }
        : { x: box.x, y: at(box.y, ...start), w: box.w, h: length };
    splits.push({ path, dir: node.dir, box: boxOf([a], gap) });
    walk(node.a, boxOf([], a), [...path, "a"]);
    walk(node.b, boxOf([a, gap], b), [...path, "b"]);
  };
  walk(root, FULL, []);
  return { leaves, splits };
}

/**
 * 나누는 선을 끌 때의 몫. point는 card 왼쪽 위 기준 px이고 size는 card의 px 크기, gap은 선의 px 두께다.
 * path의 나눔 node가 차지하는 상자 안에서 선의 가운데가 point에 오는 a의 몫을 돌려준다.
 */
export function dragRatio(
  root: GroupNode,
  path: NodePath,
  point: { x: number; y: number },
  size: { w: number; h: number },
  gap: number,
): number | null {
  let node = root;
  let box = { x: 0, y: 0, w: size.w, h: size.h };
  for (const step of path) {
    if ("tab" in node) return null;
    const row = node.dir === "row";
    const room = (row ? box.w : box.h) - gap;
    const a = room * node.ratio;
    const b = room - a;
    box = row
      ? step === "a"
        ? { ...box, w: a }
        : { ...box, x: box.x + a + gap, w: b }
      : step === "a"
        ? { ...box, h: a }
        : { ...box, y: box.y + a + gap, h: b };
    node = node[step];
  }
  if ("tab" in node) return null;
  const row = node.dir === "row";
  const room = (row ? box.w : box.h) - gap;
  if (room <= 0) return null;
  const start = row ? box.x : box.y;
  return ((row ? point.x : point.y) - start - gap / 2) / room;
}

export type PaneDirection = "left" | "right" | "up" | "down";

interface UnitRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// 나누는 선의 두께를 뺀 단위 정사각형 위의 leaf 자리. 방향 찾기에는 몫만 있으면 된다.
function unitRects(root: GroupNode): Map<string, UnitRect> {
  const rects = new Map<string, UnitRect>();
  const walk = (node: GroupNode, box: UnitRect) => {
    if ("tab" in node) {
      rects.set(node.tab, box);
      return;
    }
    if (node.dir === "row") {
      const w = box.w * node.ratio;
      walk(node.a, { ...box, w });
      walk(node.b, { ...box, x: box.x + w, w: box.w - w });
    } else {
      const h = box.h * node.ratio;
      walk(node.a, { ...box, h });
      walk(node.b, { ...box, y: box.y + h, h: box.h - h });
    }
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return rects;
}

/**
 * key의 leaf에서 dir 쪽으로 가장 가까운 leaf. 변이 겹치는 것을 먼저 보고(맞닿은 칸), 그중 가까운 순, 겹침이 큰 순,
 * 중심이 가까운 순이다. 겹치는 칸이 없으면(대각선) 그쪽에 있는 것 중 중심이 가까운 것이고, 그쪽에 아무것도
 * 없으면 null이다(반대쪽으로 돌아 나오지 않는다).
 */
export function neighborLeaf(
  root: GroupNode,
  key: string,
  dir: PaneDirection,
): string | null {
  const rects = unitRects(root);
  const from = rects.get(key);
  if (from === undefined) return null;
  const horizontal = dir === "left" || dir === "right";
  const forward = dir === "right" || dir === "down";
  // 진행 축의 [시작, 끝)과 가로지르는 축의 [시작, 끝).
  const along = (r: UnitRect) =>
    horizontal ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
  const across = (r: UnitRect) =>
    horizontal ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
  const [fromStart, fromEnd] = along(from) as [number, number];
  const [fromA, fromB] = across(from) as [number, number];
  const scored: {
    key: string;
    overlap: number;
    distance: number;
    away: number;
  }[] = [];
  for (const [other, rect] of rects) {
    if (other === key) continue;
    const [start, end] = along(rect) as [number, number];
    const distance = forward ? start - fromEnd : fromStart - end;
    if (distance < -1e-9) continue;
    const [a, b] = across(rect) as [number, number];
    scored.push({
      key: other,
      overlap: Math.min(fromB, b) - Math.max(fromA, a),
      distance,
      away: Math.abs((a + b) / 2 - (fromA + fromB) / 2),
    });
  }
  const touching = scored.filter((item) => item.overlap > 1e-9);
  const pool = touching.length > 0 ? touching : scored;
  pool.sort((p, q) =>
    touching.length > 0
      ? Math.abs(p.distance - q.distance) > 1e-9
        ? p.distance - q.distance
        : Math.abs(p.overlap - q.overlap) > 1e-9
          ? q.overlap - p.overlap
          : p.away - q.away
      : Math.abs(p.distance - q.distance) > 1e-9
        ? p.distance - q.distance
        : p.away - q.away,
  );
  return pool[0]?.key ?? null;
}
