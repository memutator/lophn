import type { PointerEvent, ReactNode, Ref } from "react";
import { componentMark, cx } from "../../_shared/shared.ts";
import styles from "./float-panel.module.css";

// renderer workspace/model.ts의 FloatEdge와 같은 글자.
export type FloatEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface FloatPanelProps {
  title: string;
  icon?: ReactNode;
  // 제목 바로 뒤. 상태 점 같은 작은 표시를 호출자가 넣는다.
  badge?: ReactNode;
  // 위 bar 오른쪽 끝. IconButton 몇 개를 호출자가 넣는다.
  actions?: ReactNode;
  children?: ReactNode;
  // 부모(position: relative)의 왼쪽 위 기준 CSS px.
  x: number;
  y: number;
  width: number;
  height: number;
  // 맨 위 패널. 그림자가 조금 더 깊다.
  active?: boolean;
  // 그리지 않되 mount는 유지한다.
  // 전체 화면 모드. 테두리와 그림자, resize 손잡이가 없다.
  full?: boolean;
  hidden?: boolean;
  // 패널 어디든 pointer가 눌리거나 focus가 들어오면 부른다.
  onRaise?: () => void;
  // 위 bar에서 pointer가 눌렸다. 행동 단추 위는 제외한다.
  onMoveStart?: (event: PointerEvent<HTMLElement>) => void;
  // 위 bar를 두 번 눌렀다. 행동 단추 위는 제외한다.
  onBarDoubleClick?: () => void;
  onResizeStart?: (edge: FloatEdge, event: PointerEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;
}

// 모서리가 변 위에 놓이도록 모서리를 뒤에 둔다.
const EDGES: readonly FloatEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

// 끌기 논리는 갖지 않는다: pointer 처리는 호출자가 이어받는다.
export function FloatPanel({
  title,
  icon,
  badge,
  actions,
  children,
  x,
  y,
  width,
  height,
  active = false,
  full = false,
  hidden = false,
  onRaise,
  onMoveStart,
  onBarDoubleClick,
  onResizeStart,
  ref,
}: FloatPanelProps) {
  return (
    <section
      ref={ref}
      hidden={hidden}
      className={styles.panel}
      style={{ left: x, top: y, width, height }}
      aria-label={title}
      data-float-panel=""
      data-full={full ? "" : undefined}
      data-active={active ? "" : undefined}
      onPointerDownCapture={onRaise}
      onFocusCapture={onRaise}
      {...componentMark("FloatPanel")}
    >
      {!full && (
        <div
          className={styles.bar}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            onMoveStart?.(event);
          }}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            onBarDoubleClick?.();
          }}
        >
          {icon !== undefined && <span className={styles.icon}>{icon}</span>}
          <span className={styles.title}>{title}</span>
          {badge}
          {actions !== undefined && (
            <div className={styles.actions}>{actions}</div>
          )}
        </div>
      )}
      <div className={styles.body}>{children}</div>
      {!full &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className={cx(styles.handle, styles[edge])}
            data-float-edge={edge}
            onPointerDown={(event) => onResizeStart?.(edge, event)}
          />
        ))}
    </section>
  );
}
