// 단추나 줄에 붙어 열리는 overlay 층. Inbox와 Jobs가 같이 쓴다. 열려 있는 동안 층 밖을 누르거나 Esc를 누르면 닫힌다.
// 열린 panel은 위쪽 바(끌기 영역) 안에서도 클릭과 scroll이 먹히도록 `no-drag`다.
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
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!layer.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);
  return (
    <div className={styles.layer} ref={layer} data-align={align}>
      {trigger}
      {open ? <div className={styles.floating}>{children}</div> : null}
    </div>
  );
}
