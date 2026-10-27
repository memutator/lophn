// 디자인 시스템 page(pages/kit/<분류>/page.tsx) 공통 조각.
import { type ReactNode, useState } from "react";
import styles from "./kit.module.css";

export { styles as kit };

export function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
      {children}
    </section>
  );
}

/** 이름(mono)과 그 모양 한 줄. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

/**
 * 열린 overlay를 담는 상자. transform 때문에 portal의 fixed 배치가 이 상자를 기준으로 하고,
 * 안의 component는 `container`로 이 상자에 그려진다.
 */
export function Stage({
  height,
  center = false,
  children,
}: {
  height: number;
  center?: boolean;
  children: (container: HTMLElement) => ReactNode;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={setElement}
      className={`${styles.stage} ${center ? styles.stageCenter : ""}`}
      style={{ height }}
    >
      {element === null ? null : children(element)}
    </div>
  );
}

/** 예제 하나를 담는 무대. */
export function Example({
  children,
  height,
}: {
  children: ReactNode;
  height?: number;
}) {
  return (
    <div
      className={styles.sdkStage}
      style={height === undefined ? undefined : { height }}
    >
      {children}
    </div>
  );
}

/** 시간이 가지 않는 timer. 열린 toast·tooltip이 그대로 남는다. */
export const FROZEN_TIMER = { set: () => 0, clear: () => {} };
