import { type ReactNode, useRef } from "react";
import { useObservedSize } from "../resize.ts";
import { cx } from "../shared.ts";
import styles from "./page-frames.module.css";
import { type ColumnFrame, panePadding } from "./model.ts";

// 칸 폭을 관측해 칸 여백(16/32px)을 고른다. 관측 전에는 넓은 칸 여백이다.
export function usePane() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  const pane = size?.width;
  return {
    ref,
    pane,
    pad: pane === undefined ? "wide" : panePadding(pane),
  } as const;
}

interface FrameProps {
  header?: ReactNode;
  children: ReactNode;
}

function Head({ header }: { header?: ReactNode }) {
  return header === undefined
    ? null
    : <header className={styles.head}>{header}</header>;
}

function Column(
  { frame, header, children }: FrameProps & { frame: ColumnFrame },
) {
  const { ref, pad } = usePane();
  return (
    <div ref={ref} className={styles.frame} data-frame={frame} data-pad={pad}>
      <div className={cx(styles.pad, styles.center)}>
        <div className={styles.column} data-frame={frame}>
          <Head header={header} />
          {children}
        </div>
      </div>
    </div>
  );
}

// 폼 640px(R21).
export function FormFrame(props: FrameProps) {
  return <Column frame="form" {...props} />;
}

// 런처 1040px(R22).
export function LauncherFrame(props: FrameProps) {
  return <Column frame="launcher" {...props} />;
}

// 프로젝트 개요 800px(R22).
export function OverviewFrame(props: FrameProps) {
  return <Column frame="overview" {...props} />;
}

// 최대 1440px, 12열, 간격 16px(R21).
export function DashboardFrame({ header, children }: FrameProps) {
  const { ref, pad } = usePane();
  return (
    <div
      ref={ref}
      className={styles.frame}
      data-frame="dashboard"
      data-pad={pad}
    >
      <div className={cx(styles.pad, styles.center)}>
        <div className={styles.dashboard}>
          <Head header={header} />
          <div className={styles.grid}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export type DashboardSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export function DashboardCell(
  { span, children }: { span: DashboardSpan; children: ReactNode },
) {
  return <div className={styles.cell} data-span={span}>{children}</div>;
}

export interface ListDetailFrameProps {
  list: ReactNode;
  detail: ReactNode;
}

// 목록 360px과 나머지 상세. 전체 폭이다(R21).
export function ListDetailFrame({ list, detail }: ListDetailFrameProps) {
  return (
    <div className={styles.listDetail} data-frame="list-detail">
      <div className={styles.list}>{list}</div>
      <div className={styles.detail}>{detail}</div>
    </div>
  );
}

// 전체 폭 표. 머리만 칸 여백을 쓰고 표는 칸 끝까지 간다(R21, R30).
export function TableFrame({ header, children }: FrameProps) {
  const { ref, pad } = usePane();
  return (
    <div
      ref={ref}
      className={styles.tableFrame}
      data-frame="table"
      data-pad={pad}
    >
      {header !== undefined && (
        <div className={styles.pad}>
          <Head header={header} />
        </div>
      )}
      <div className={styles.tableBody}>{children}</div>
    </div>
  );
}
