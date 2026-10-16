/// <reference lib="dom" />
// 고른 것 하나의 값과 대상 찾기.
import type { PickedItem } from "../../ipc/annotation.ts";
import { bundlePositionOf, nameOf, roleOf, textOf } from "./describe.ts";
import { type Box, rectOf, type View } from "./geometry.ts";

export const COMPONENT_ATTR = "data-lophn-component";
/** 이만큼 움직이면 클릭이 아니라 끌기다(CSS px). */
export const DRAG_THRESHOLD = 4;
export const NOTE_MAX = 2000;
const PATH_MAX = 512;

/** 고른 것. 요소를 고른 것이면 `ref`를 쥔다. */
export type Picked = Omit<PickedItem, "rect"> & {
  rect: PickedItem["rect"];
  ref: WeakRef<Element> | null;
};

export const viewOf = (win: Window): View => ({
  width: win.innerWidth,
  height: win.innerHeight,
  scrollX: win.scrollX,
  scrollY: win.scrollY,
});

/** 점 아래에서 층(host)을 뺀 첫 요소에서 위로 올라가 처음 만나는 SDK component, 없으면 그 요소. */
export function targetAt(
  doc: Document,
  host: Element,
  x: number,
  y: number,
): Element | null {
  const hit = doc.elementsFromPoint(x, y).find((el) => el !== host);
  if (hit === undefined) return null;
  return hit.closest(`[${COMPONENT_ATTR}]`) ?? hit;
}

/** 이름표 문구: component 이름, 아니면 `role "접근 이름"`. */
export function labelOf(target: Element): string {
  const component = target.getAttribute(COMPONENT_ATTR);
  if (component) return component;
  const role = roleOf(target) ?? target.tagName.toLowerCase();
  const name = nameOf(target);
  return name === null ? role : `${role} "${name}"`;
}

const pathOf = (win: Window) =>
  (win.location.pathname + win.location.hash).slice(0, PATH_MAX);

export function pickElement(
  target: Element,
  n: number,
  win: Window,
): Picked {
  const box = target.getBoundingClientRect();
  return {
    n,
    kind: "element",
    note: "",
    component: target.getAttribute(COMPONENT_ATTR) || null,
    bundle_position: bundlePositionOf(target),
    element: {
      role: roleOf(target),
      name: nameOf(target),
      text: textOf(target),
    },
    rect: rectOf(box, viewOf(win)),
    path: pathOf(win),
    ref: new WeakRef(target),
  };
}

export function pickRegion(box: Box, n: number, win: Window): Picked {
  return {
    n,
    kind: "region",
    note: "",
    component: null,
    bundle_position: null,
    element: { role: null, name: null, text: null },
    rect: rectOf(box, viewOf(win)),
    path: pathOf(win),
    ref: null,
  };
}

export function toItem({ ref: _ref, ...item }: Picked): PickedItem {
  return item;
}
