import type { PointerEvent as ReactPointerEvent } from "react";

import type { DragOutcome } from "./model.ts";

interface PointerDrag {
  /** 누른 자리에서 움직인 가로 거리. 미리보기만 바꾼다. */
  move: (dx: number) => void;
  /** drag-end면 마지막 값을 적용하고 drag-cancel이면 시작 값으로 돌린다. */
  finish: (outcome: DragOutcome) => void;
}

/**
 * sidebar 폭·칸 경계 drag. 놓으면 drag-end, Esc나 pointercancel이면 drag-cancel을
 * 낸다. overlay pointer DTO와 같은 두 끝이다.
 */
export function startPointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  drag: PointerDrag,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  let lastX = startX;
  let lastY = event.clientY;
  const target = event.currentTarget;
  // 창 밖으로 나가도 놓침이 없도록 문서 전체에서 듣는다.
  const root = target.ownerDocument;
  target.setAttribute("data-dragging", "");
  const move = (next: PointerEvent) => {
    lastX = next.clientX;
    lastY = next.clientY;
    drag.move(lastX - startX);
  };
  const stop = (outcome: DragOutcome) => {
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", up);
    root.removeEventListener("pointercancel", cancel);
    root.removeEventListener("keydown", escape, true);
    target.removeAttribute("data-dragging");
    drag.finish(outcome);
  };
  const up = () => stop({ type: "drag-end", x: lastX, y: lastY });
  const cancel = () => stop({ type: "drag-cancel" });
  const escape = (key: KeyboardEvent) => {
    if (key.key !== "Escape") return;
    key.preventDefault();
    cancel();
  };
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("keydown", escape, true);
}
