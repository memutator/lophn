// Orders 앱이 그린 화면의 고정 그림. 앱 view는 앱이 그리므로 lophn 화면이 아니다. annotate에서 고를 수 있는 요소 둘과 영역 하나가 있다.
import type { ReactNode } from "react";
import { StatRow, StatTile } from "@lophn/ui/data";
import { Button } from "@lophn/ui/primitives";

import { ORDER_ROWS } from "./data.ts";
import styles from "../../drafts/app-space/orders-view.module.css";

type TargetId = "ship" | "total";

interface Mark {
  /** 고른 순서. 번호 표지로 보인다. */
  readonly n: number;
  /** 메모 칸을 이 요소 아래에 붙여 열어 둔다. */
  readonly memo?: string;
}

interface AreaMark {
  /** 앱 화면 안 위치와 크기(%). */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** 끄는 중이면 없다. 고른 뒤에는 번호가 붙는다. */
  readonly n?: number;
}

export interface ViewMarks {
  /** 지금 가리키는 요소. 점선 윤곽과 이름표가 뜬다. */
  readonly hover?: { readonly id: TargetId; readonly label: string };
  readonly picked?: Partial<Record<TargetId, Mark>>;
  readonly area?: AreaMark;
}

function Target({
  id,
  marks,
  children,
  memoSide,
}: {
  id: TargetId;
  marks: ViewMarks;
  children: ReactNode;
  memoSide?: "right";
}) {
  const picked = marks.picked?.[id];
  const hovering = marks.hover?.id === id;
  return (
    <span
      className={`${styles.target} ${
        picked ? styles.picked : hovering ? styles.hover : ""
      }`}
    >
      {hovering && !picked ? (
        <span className={styles.hoverLabel}>{marks.hover?.label}</span>
      ) : null}
      {picked ? <span className={styles.badge}>{picked.n}</span> : null}
      {children}
      {picked?.memo === undefined ? null : (
        <span className={`${styles.memo} ${memoSide ? styles.memoRight : ""}`}>
          <textarea
            readOnly
            rows={2}
            defaultValue={picked.memo}
            aria-label={`Note for ${id}`}
            style={{ font: "inherit", resize: "none" }}
          />
          <span className={styles.muted}>
            Notes stay here until you send them all.
          </span>
        </span>
      )}
    </span>
  );
}

export function OrdersView({ marks = {} }: { marks?: ViewMarks }) {
  const { area } = marks;
  return (
    <div className={styles.appView} data-app-view="orders">
      <div className={styles.appHead}>
        <h1 className={styles.appTitle}>Orders</h1>
        <Button variant="primary" size="sm">
          New order
        </Button>
      </div>
      <StatRow>
        <StatTile label="Open" value={12} />
        <StatTile label="Shipped today" value={31} />
        <StatTile label="Revenue today" value={4210} unit="USD" />
      </StatRow>
      <div className={styles.orders}>
        <div className={styles.ordersHead}>
          <span>Order</span>
          <span>Customer</span>
          <span>Status</span>
          <span className={styles.num}>Total</span>
          <span />
        </div>
        {ORDER_ROWS.map((row, index) => (
          <div key={row.id} className={styles.ordersRow}>
            <span>#{row.id}</span>
            <span>{row.customer}</span>
            <span>{row.status}</span>
            <span className={styles.num}>
              {index === 1 ? (
                <Target id="total" marks={marks}>
                  {row.total}
                </Target>
              ) : (
                row.total
              )}
            </span>
            <span>
              {row.status === "Open" ? (
                index === 1 ? (
                  <Target id="ship" marks={marks} memoSide="right">
                    <Button size="sm">Mark shipped</Button>
                  </Target>
                ) : (
                  <Button size="sm">Mark shipped</Button>
                )
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {area === undefined ? null : (
        <div
          className={`${styles.area} ${
            area.n === undefined ? "" : styles.areaSolid
          }`}
          style={{
            left: `${area.left}%`,
            top: `${area.top}%`,
            width: `${area.width}%`,
            height: `${area.height}%`,
          }}
        >
          {area.n === undefined ? null : (
            <span className={styles.badge}>{area.n}</span>
          )}
        </div>
      )}
    </div>
  );
}
