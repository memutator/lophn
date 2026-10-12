import { t } from "@lophn/wording";

import { coverageNotes } from "../model.ts";
import type { Coverage } from "../source.ts";
import styles from "./documents.module.css";

/** format 이름을 화면 말로. 모르는 이름은 그대로 쓴다. */
export function formatLabel(format: string): string {
  return t("documents.label.format-name", { format });
}

// 검색·view 결과 판단에 필요한 지연·누락만 한 줄씩 보인다.
// index·재생성 과정은 보이지 않고 지금 상태만 말한다.
export function CoverageNotices({ coverage }: { coverage: Coverage | null }) {
  const notes = coverageNotes(coverage);
  if (notes.length === 0) return null;
  return (
    <div className={styles.section} data-coverage="">
      {notes.map((note) => (
        <p key={note} className={styles.notice} data-coverage-note={note}>
          {note === "lagging"
            ? t("documents.notice.lagging")
            : note === "rebuilding"
            ? t("documents.notice.rebuilding")
            : t("documents.notice.omissions", {
              count: coverage?.omissions ?? 0,
            })}
        </p>
      ))}
    </div>
  );
}
