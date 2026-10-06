import { t } from "@lophn/wording";

import type { ConfirmationView } from "../frame/api.ts";
import type { DetailFact } from "../display.ts";
import styles from "./kinds.module.css";

/** 종류 화면이 받는 것. 결정은 main이 허용한 이름만 보낸다. */
export interface KindProps {
  view: ConfirmationView;
  decide(
    decision: string,
    options?: { input?: Record<string, unknown>; confirmedSecond?: boolean },
  ): void;
  cancel(): void;
  /** 보내는 중이면 결정 버튼을 다시 누르지 못한다. */
  busy: boolean;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 값이 있는 것만 Details에 싣는다. */
export function facts(
  pairs: readonly (readonly [string, string | undefined])[],
): DetailFact[] {
  return pairs.flatMap(([label, value]) =>
    value === undefined ? [] : [{ label, value }]
  );
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * 고정 동작을 줄이지 않고 그대로 보인다: 맡은 concern, command, 대상, 정확한 입력,
 * 비교 기준. 고정폭 원문이고 자르지 않는다(confirmation-window#R2, wording#R12).
 */
export function ExactAction({ view }: { view: Record<string, unknown> }) {
  const input = obj(view.input);
  const rows: { key: string; label: string; value: string; note?: string }[] =
    [];
  const owner = str(view.concern);
  if (owner !== undefined) {
    rows.push({ key: "owner", label: t("confirmation-window.label.owner"), value: owner });
  }
  const command = str(view.command);
  if (command !== undefined) {
    rows.push({ key: "command", label: t("confirmation-window.label.action"), value: command });
  }
  const targets = list(view.targets);
  if (targets.length > 0) {
    rows.push({
      key: "targets",
      label: t("confirmation-window.label.targets"),
      value: targets.join("\n"),
    });
  }
  if (input.kind === "blob") {
    rows.push({
      key: "input",
      label: t("confirmation-window.label.input"),
      value: String(input.sha256),
      note: t("confirmation-window.input.blob"),
    });
  } else if (input.kind === "inline") {
    rows.push({
      key: "input",
      label: t("confirmation-window.label.input"),
      value: pretty(input.value),
    });
  }
  const comparison = obj(view.comparison);
  if (Object.keys(comparison).length > 0) {
    rows.push({
      key: "comparison",
      label: t("confirmation-window.label.comparison"),
      value: pretty(comparison),
    });
  }
  if (rows.length === 0) return null;
  return (
    <dl className={styles.exact} data-exact="action">
      {rows.map((row) => (
        <div key={row.key} className={styles.row} data-exact-row={row.key}>
          <dt className={styles.label}>{row.label}</dt>
          {row.note === undefined
            ? null
            : <dd className={styles.note}>{row.note}</dd>}
          <dd className={styles.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
