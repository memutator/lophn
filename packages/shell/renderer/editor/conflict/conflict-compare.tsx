// 충돌에서 디스크 쪽과 내 쪽을 나란히 보인다. 다른 줄은 +/− 기호와 배경으로 구별한다.
import { useMemo } from "react";
import { DiffMark } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";

import { compareLines } from "./compare.ts";
import styles from "./conflict-compare.module.css";

interface ConflictCompareProps {
  /** 지금 디스크 글. */
  disk: string;
  /** 편집기의 글(아직 저장하지 않았다). */
  mine: string;
}

interface Row {
  readonly disk: string | null;
  readonly mine: string | null;
  readonly changed: boolean;
}

export function ConflictCompare({ disk, mine }: ConflictCompareProps) {
  const rows = useMemo(
    () =>
      compareLines(disk, mine).map(
        (line): Row =>
          line.kind === "same"
            ? { disk: line.text, mine: line.text, changed: false }
            : line.kind === "delete"
              ? { disk: line.text, mine: null, changed: true }
              : { disk: null, mine: line.text, changed: true },
      ),
    [disk, mine],
  );
  const column = (side: "disk" | "mine") => (
    <div className={styles.column}>
      <div className={styles.head}>
        {side === "disk"
          ? t("document.label.compare-disk")
          : t("document.label.compare-mine")}
      </div>
      {rows.map((row, index) => {
        const text = row[side];
        const kind = side === "disk" ? "delete" : "add";
        return (
          <div
            key={index}
            className={styles.line}
            data-diff={row.changed && text !== null ? kind : undefined}
          >
            <span className={styles.sign}>
              {row.changed && text !== null ? <DiffMark kind={kind} /> : null}
            </span>
            <span>{text === null || text === "" ? " " : text}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div
      className={styles.compare}
      aria-label={t("document.title.compare-disk")}
      data-conflict-compare=""
    >
      {column("disk")}
      {column("mine")}
    </div>
  );
}
