// 탭들이 같이 쓰는 작은 조각. 색 다른 띠나 상자로 알리지 않는다. 안내는 굵은 제목 한 줄과 설명이고,
// 알림은 pane 위쪽 toast다.
import type { ReactNode } from "react";
import { Toast } from "@lophn/design/components";

import type { Effect } from "./source.ts";
import styles from "./app-detail.module.css";

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
        <div key={name} className={styles.fact}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

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

/** 운영 패널 위쪽 가운데에 뜨는 알림. 시간이 지나거나 닫으면 사라진다. 실패는 error다. */
export function PaneToast(
  { title, body, error = false, onClose }: {
    title: string;
    body?: string;
    error?: boolean;
    onClose: () => void;
  },
) {
  return (
    <div className={styles.paneToast}>
      <Toast
        title={title}
        body={body}
        tone={error ? "error" : "neutral"}
        onClose={onClose}
      />
    </div>
  );
}
