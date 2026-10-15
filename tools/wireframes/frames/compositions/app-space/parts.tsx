// 앱 공간 탭들이 같이 쓰는 작은 조각.
import type { ReactNode } from "react";

import type { Effect } from "./data.ts";
import styles from "./app-space.module.css";

export type PillTone =
  | "plain"
  | "write"
  | "external"
  | "good"
  | "critical"
  | "neutral";

const TONE: Record<PillTone, string> = {
  plain: "",
  write: styles.pillWrite,
  external: styles.pillExternal,
  good: styles.pillGood,
  critical: styles.pillCritical,
  neutral: styles.pillNeutral,
};

export function Pill(
  { tone = "plain", children }: { tone?: PillTone; children: ReactNode },
) {
  return <span className={`${styles.pill} ${TONE[tone]}`}>{children}</span>;
}

export function EffectPill({ effect }: { effect: Effect }) {
  return <Pill tone={effect === "read" ? "plain" : effect}>{effect}</Pill>;
}

export function Section(
  { title, children }: { title?: string; children: ReactNode },
) {
  return (
    <section className={styles.section}>
      {title === undefined ? null : <h4 className={styles.heading}>{title}</h4>}
      {children}
    </section>
  );
}

export function Facts({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([name, value]) => (
        <div key={name} style={{ display: "contents" }}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 탭 안 안내 글. 색 다른 띠나 상자가 아니라 굵은 제목 한 줄과 설명이다. 알림은 pane 위쪽 toast로 띄운다. */
export function Note(
  { title, children }: { title?: string; children: ReactNode },
) {
  return (
    <p className={styles.note}>
      {title === undefined
        ? null
        : <span className={styles.strong}>{title}</span>}
      <span>{children}</span>
    </p>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}
