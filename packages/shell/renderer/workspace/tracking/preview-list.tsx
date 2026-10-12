import { t } from "@lophn/wording";

import {
  PREVIEW_ROWS,
  type PreviewGroups,
  type ReasonKind,
  reasonOf,
} from "./model.ts";
import type { PreviewEntry } from "./source.ts";
import styles from "./tracking.module.css";

function reasonText(reason: ReasonKind): string {
  switch (reason.kind) {
    case "included":
      return t("project-workspace.label.reason-included", {
        glob: reason.glob,
      });
    case "excluded":
      return t("project-workspace.label.reason-excluded", {
        glob: reason.glob,
      });
    case "unmatched":
      return t("project-workspace.label.reason-unmatched");
    case "gitignore":
      return t("project-workspace.label.reason-gitignore");
    case "inside-git":
      return t("project-workspace.label.reason-inside-git");
    case "inside-lophn":
      return t("project-workspace.label.reason-inside-lophn");
    case "outside-link":
      return t("project-workspace.label.reason-outside-link");
    case "tracking-off":
      return t("project-workspace.label.reason-tracking-off");
    case "other":
      return t("project-workspace.label.reason-other");
  }
}

function Group(
  { kind, heading, entries }: {
    kind: "tracked" | "left-out";
    heading: string;
    entries: readonly PreviewEntry[];
  },
) {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, PREVIEW_ROWS);
  const more = entries.length - shown.length;
  return (
    <section className={styles.group} data-group={kind}>
      <h3 className={styles.groupHead}>
        {heading}
        <span className={styles.count}>{entries.length}</span>
      </h3>
      <ul className={styles.entries}>
        {shown.map((entry) => (
          <li
            key={`${entry.folder}\u0000${entry.path}`}
            className={styles.entry}
            data-entry={entry.path}
          >
            <span className={styles.entryPath}>{entry.path}</span>
            <span className={styles.entryReason}>
              {reasonText(reasonOf(entry.reason))}
            </span>
          </li>
        ))}
      </ul>
      {more > 0
        ? (
          <p className={styles.more}>
            {t("project-workspace.label.more-files", { count: more })}
          </p>
        )
        : null}
    </section>
  );
}

// 미리보기의 포함·제외 파일과 이유. 경로는 등록 폴더 기준 상대 경로다.
export function PreviewList({ groups }: { groups: PreviewGroups }) {
  return (
    <div className={styles.preview} data-preview-list="">
      <Group
        kind="tracked"
        heading={t("project-workspace.heading.tracked")}
        entries={groups.tracked}
      />
      <Group
        kind="left-out"
        heading={t("project-workspace.heading.left-out")}
        entries={groups.leftOut}
      />
    </div>
  );
}
