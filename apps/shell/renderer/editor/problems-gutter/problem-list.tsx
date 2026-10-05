import { editorIcons, Icon, iconPixels } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { type EditorProblem, sortProblems } from "./problems.ts";
import styles from "./problem-list.module.css";

export interface ProblemListProps {
  problems: readonly EditorProblem[];
  /** 줄을 고르면 편집기가 그 줄로 간다. */
  onSelect: (line: number) => void;
}

// 편집 칸 아래 형식 문제 목록. 최대 200px에서 scroll한다(shell/editor#R11).
export function ProblemList({ problems, onSelect }: ProblemListProps) {
  return (
    <section
      className={styles.list}
      aria-label={t("document.label.problems")}
      data-problem-list=""
    >
      <ul className={styles.items}>
        {sortProblems(problems).map((problem, index) => (
          <li key={`${problem.line ?? "whole"}-${index}`}>
            <button
              type="button"
              className={styles.item}
              data-severity={problem.severity}
              disabled={problem.line === null}
              onClick={() => {
                if (problem.line !== null) {
                  onSelect(problem.line);
                }
              }}
            >
              <Icon
                icon={editorIcons.problem}
                pixels={iconPixels("small")}
                className={styles.icon}
              />
              <span className={styles.where}>
                {problem.line === null
                  ? t("document.label.problem-whole")
                  : t("document.label.problem-line", { line: problem.line })}
              </span>
              <span className={styles.message}>{problem.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
