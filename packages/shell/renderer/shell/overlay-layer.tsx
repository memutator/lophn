// 단추나 줄에 붙어 열리는 overlay 층. Inbox와 Jobs가 같이 쓴다. 열려 있는 동안 층 밖을 누르거나 Esc를 누르면 닫힌다.
// 열린 panel은 위쪽 바(끌기 영역) 안에서도 클릭과 scroll이 먹히도록 `no-drag`다.
// panel 안의 Select·Popover는 body에 portal로 그려 DOM으로는 층 밖이다. React event는 portal에서도 React 부모로
// 올라오므로 그 길로 "층 안"을 안다. Esc도 portal 안에서 눌렀으면 그 popover만 닫히고 층은 남는다.
import { type ReactNode, useEffect, useRef } from "react";

import styles from "./overlay-layer.module.css";

/**
 * panel이 펼쳐지는 쪽.
 * - end: 단추 아래, 오른쪽 끝에 맞춰 왼쪽으로(오른쪽 구역의 단추).
 * - start: 단추 아래, 왼쪽 끝에 맞춰 오른쪽으로.
 * - side: 줄의 오른쪽 옆, 줄의 위에 맞춰(왼쪽 sidebar의 줄).
 */
export type OverlayAlign = "start" | "end" | "side";

export function OverlayLayer({
  open,
  onOpenChange,
  align,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align: OverlayAlign;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  // React tree로 층을 지난 마지막 pointerdown·keydown. document listener가 React root보다 늦게 불려 그 사이에 읽는다.
  const pointerInside = useRef(false);
  const keyInPortal = useRef(false);
  useEffect(() => {
    if (!open) return;
    // 층을 연 누름이 남긴 표시는 지운다.
    pointerInside.current = false;
    keyInPortal.current = false;
    const outside = (event: PointerEvent) => {
      const inside =
        pointerInside.current ||
        layer.current?.contains(event.target as Node) === true;
      pointerInside.current = false;
      if (!inside) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      const portal = keyInPortal.current;
      keyInPortal.current = false;
      if (event.key === "Escape" && !portal) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);
  return (
    <div
      className={styles.layer}
      ref={layer}
      data-align={align}
      onPointerDownCapture={() => {
        pointerInside.current = true;
      }}
      onKeyDownCapture={(event) => {
        keyInPortal.current = !event.currentTarget.contains(
          event.target as Node,
        );
      }}
    >
      {trigger}
      {open ? <div className={styles.floating}>{children}</div> : null}
    </div>
  );
}
