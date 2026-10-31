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
