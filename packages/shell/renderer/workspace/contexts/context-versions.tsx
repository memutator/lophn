// Context 탭 머리의 판 목록. 판마다 번호와 시각이고, 적용된 판은 Current, 옛 판은 [Restore]로 되돌린다.
// 되돌리는 일은 확인 없이 바로 한다: 되돌린 뒤에도 옛 판이 목록에 남아 다시 되돌릴 수 있다.
import type { ReactNode } from "react";
import { Button } from "@lophn/ui/primitives";
import { formatRelativeTime, t } from "@lophn/wording";

import type { BundleEntry } from "./source.ts";
import styles from "./context-frame.module.css";

interface ContextVersionsProps {
  readonly bundles: readonly BundleEntry[];
  /** 적용된 판의 ID. 적용된 판이 없으면 null. */
  readonly applied: string | null;
  /** 되돌리는 중인 판의 ID. */
  readonly restoring: string | null;
  readonly now: Date;
  readonly onRestore: (entry: BundleEntry) => void;
}

export function ContextVersions(
  { bundles, applied, restoring, now, onRestore }: ContextVersionsProps,
): ReactNode {
  // 번호를 받은 판만 나열한다. 쓰는 중인 draft와 버린 판은 이력이 아니다.
  const rows = bundles.filter((entry) => entry.bundle.number !== null);
  return (
    <section
      className={styles.versions}
      aria-label={t("contexts.heading.versions")}
      data-versions=""
    >
      <h2>{t("contexts.heading.versions")}</h2>
      {rows.map((entry) => (
        <div
          key={entry.bundle.id}
          className={styles.version}
          data-version-row={entry.bundle.number}
        >
          <span className={styles.versionName}>
            {t("contexts.label.versions-name", {
              number: String(entry.bundle.number),
            })}
          </span>
          <span className={styles.versionWhen}>
            {entry.check === null ? "" : formatRelativeTime(
              new Date(entry.check.finished_at ?? entry.check.started_at),
              now,
            )}
          </span>
          <span className={styles.versionState}>{stateOf(entry)}</span>
          {entry.bundle.id === applied
            ? (
              <span className={styles.chip}>
                {t("contexts.label.versions-current")}
              </span>
            )
            : entry.bundle.status === "superseded"
            ? (
              <Button
                size="sm"
                disabled={restoring !== null}
                onClick={() => onRestore(entry)}
              >
                {t("contexts.button.versions-restore")}
              </Button>
            )
            : <span />}
        </div>
      ))}
    </section>
  );
}

/** 적용된 적 없는 판(검사 중, 검사 실패)에만 상태 글을 보인다. */
function stateOf(entry: BundleEntry): string {
  if (entry.bundle.status === "checking") {
    return t("contexts.label.versions-checking");
  }
  if (entry.bundle.status === "failed") {
    return t("contexts.label.versions-failed");
  }
  return "";
}
