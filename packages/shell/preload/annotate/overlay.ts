/// <reference lib="dom" />
// 앱 view 위 층. documentElement에 host 하나를 붙이고 closed shadow root 안에 그린다.
// 스타일은 모두 shadow 안에 있어 앱 CSS와 섞이지 않는다. mode가 꺼지면 host를 뗀다.
import { BADGE_OFFSET, BADGE_SIZE, type Box } from "./geometry.ts";
import { labels } from "./labels.ts";
import { NOTE_MAX } from "./pick.ts";

const MEMO_WIDTH = 260;
const MEMO_HEIGHT = 110;
const MEMO_GAP = 8;

// 색은 wireframe의 focus(파랑), ink(검정 이름표), surface(흰 메모 칸)를 따른다.
const CSS = `
:host { all: initial; }
.root { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 12px/16px system-ui, sans-serif; color: #161615; }
.box { position: absolute; box-sizing: border-box; border-radius: 4px; }
.hover { outline: 2px dashed #2a78d6; outline-offset: 2px; }
.drag { border: 2px dashed #2a78d6; background: #e7f0fb; opacity: 0.7; }
.picked { outline: 2px solid #2a78d6; outline-offset: 2px; }
.region { border: 2px solid #2a78d6; }
.label { position: absolute; bottom: 100%; left: 0; margin-bottom: 4px; padding: 2px 6px;
  border-radius: 2px; background: #1a1a18; color: #fff; white-space: nowrap; }
.badge { position: absolute; top: -${BADGE_OFFSET}px; left: -${BADGE_OFFSET}px;
  width: ${BADGE_SIZE}px; height: ${BADGE_SIZE}px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #2a78d6; color: #fff; font-weight: 600; }
.memo { position: absolute; width: ${MEMO_WIDTH}px; box-sizing: border-box; padding: 8px;
  display: flex; flex-direction: column; gap: 4px; border-radius: 8px; background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); pointer-events: auto; }
.memo textarea { font: inherit; resize: none; box-sizing: border-box; width: 100%; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hint { color: #6b6b66; }
.remove { flex: none; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: #6b6b66; font: 16px/20px system-ui, sans-serif; cursor: pointer; }
.remove:hover { background: #ededeb; color: #161615; }
.capturing .hover, .capturing .drag, .capturing .memo,
.capturing .item:not(.target) { display: none; }
`;

type Item = {
  box: HTMLElement;
  memo: HTMLElement;
  textarea: HTMLTextAreaElement;
};

export function createOverlay(
  doc: Document,
  onNote: (n: number, note: string) => void,
  // 모은 목록이 shell에 따로 없어 메모 칸의 ×가 하나를 지운다.
  onRemove: (n: number) => void,
) {
  const host = doc.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  const root = doc.createElement("div");
  root.className = "root";
  const hover = doc.createElement("div");
  hover.className = "box hover";
  const hoverLabel = doc.createElement("span");
  hoverLabel.className = "label";
  hover.append(hoverLabel);
  const drag = doc.createElement("div");
  drag.className = "box drag";
  hover.hidden = drag.hidden = true;
  root.append(hover, drag);
  shadow.append(style, root);
  // 메모 칸의 키 입력이 앱의 단축키에 닿지 않게 한다.
  for (const type of ["keydown", "keyup", "keypress"]) {
    shadow.addEventListener(type, (e) => e.stopPropagation());
  }

  const items = new Map<number, Item>();
  const workspace = (el: HTMLElement, box: Box) => {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  };

  return {
    host,
    attach: () => {
      if (!host.isConnected) doc.documentElement.append(host);
    },
    detach: () => host.remove(),

    hover(box: Box | null, label = "") {
      hover.hidden = box === null;
      if (box === null) return;
      hoverLabel.textContent = label;
      workspace(hover, box);
    },
    drag(box: Box | null) {
      drag.hidden = box === null;
      if (box !== null) workspace(drag, box);
    },

    add(n: number, kind: "element" | "region") {
      const box = doc.createElement("div");
      box.className = `box item ${kind === "region" ? "region" : "picked"}`;
      const badge = doc.createElement("span");
      badge.className = "badge";
      badge.textContent = String(n);
      box.append(badge);
      const memo = doc.createElement("div");
      memo.className = "memo item";
      const textarea = doc.createElement("textarea");
      textarea.rows = 2;
      textarea.maxLength = NOTE_MAX;
      textarea.placeholder = labels.notePlaceholder;
      textarea.setAttribute("aria-label", labels.noteAria(n));
      textarea.addEventListener("input", () => onNote(n, textarea.value));
      const hint = doc.createElement("span");
      hint.className = "hint";
      hint.textContent = labels.noteHint;
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", labels.removeAria(n));
      remove.title = labels.removeAria(n);
      remove.addEventListener("click", () => onRemove(n));
      const foot = doc.createElement("div");
      foot.className = "foot";
      foot.append(hint, remove);
      memo.append(textarea, foot);
      root.append(box, memo);
      items.set(n, { box, memo, textarea });
    },
    workspace(n: number, box: Box, view: { width: number; height: number }) {
      const item = items.get(n);
      if (item === undefined) return;
      workspace(item.box, box);
      const left = Math.max(
        0,
        Math.min(box.x, view.width - MEMO_WIDTH - MEMO_GAP),
      );
      const top = Math.max(
        0,
        Math.min(box.y + box.height + MEMO_GAP, view.height - MEMO_HEIGHT),
      );
      item.memo.style.left = `${left}px`;
      item.memo.style.top = `${top}px`;
    },
    focusNote: (n: number) => items.get(n)?.textarea.focus(),
    remove(n: number | "all") {
      for (const key of n === "all" ? [...items.keys()] : [n]) {
        const item = items.get(key);
        item?.box.remove();
        item?.memo.remove();
        items.delete(key);
      }
    },

    /** n 하나의 윤곽과 번호 표지만 남긴다. null이면 되돌린다. */
    capture(n: number | null) {
      root.classList.toggle("capturing", n !== null);
      for (const [key, item] of items) {
        item.box.classList.toggle("target", key === n);
      }
    },
  };
}
