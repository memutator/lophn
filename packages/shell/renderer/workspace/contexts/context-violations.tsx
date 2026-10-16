// Violations: 계약을 어긴 문서를 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄·
// [Send to Project Manager]로 보이고 위에 위반 수 안내와 [Send all to Project Manager]를 둔다.
// 위반이 없으면 "No violations."만. 넘기기는 core를 부르지 않는다. 부른 쪽이 그 project의
// Project Manager session을 연다.
// 문구 key는 아래만 t()로 쓴다:
//   contexts.button.violations-send
//   contexts.button.violations-send-all
//   contexts.empty.violations-none
//   contexts.label.violations-count
//   contexts.label.violations-rule
//   contexts.label.target-focus
import { type ReactNode, useEffect, useState } from "react";
import { Button, ErrorState } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  fileName,
  keyText,
  sortViolations,
} from "./context-violations-model.ts";
import styles from "./context-violations.module.css";
import type { ContextsSource, ViolationItem } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

export interface ContextViolationsProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 파일 이름을 누르면 그 문서 탭을 연다. */
  readonly onOpenDocument: OpenDocument;
  /** 이 위반들을 Project Manager에게 넘긴다(줄의 단추는 그 줄 하나, 머리의 단추는 전부). */
  readonly onSend: (violations: readonly ViolationItem[]) => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly violations: readonly ViolationItem[];
  };

export function ContextViolations(
  { source, context, onOpenDocument, onSend }: ContextViolationsProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoad({ state: "loading" });
    source.violations(context).then(
      (result) => {
        if (!current) return;
        setLoad(
          result.ok
            ? {
              state: "ready",
              violations: sortViolations(result.value.violations),
            }
            : { state: "failed" },
        );
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, context, attempt]);

  if (load.state === "loading") return null;
  if (load.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.target-focus")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  const { violations } = load;
  if (violations.length === 0) {
    return (
      <p className={styles.empty}>{t("contexts.empty.violations-none")}</p>
    );
  }
  return (
    <div>
      <div className={styles.bulk}>
        <span className={styles.count} data-violations-count>
          {t("contexts.label.violations-count", {
            count: violations.length,
          })}
        </span>
        <Button variant="primary" onClick={() => onSend(violations)}>
          {t("contexts.button.violations-send-all")}
        </Button>
      </div>
      <ul className={styles.rows}>
        {violations.map((violation) => (
          <li
            key={keyText(violation)}
            className={styles.row}
            data-violation
            data-path={violation.path}
          >
            <div>
              <p>
                <a
                  href="#"
                  className={styles.file}
                  data-violation-file
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenDocument(violation.path);
                  }}
                >
                  {fileName(violation.path)}
                </a>{" "}
                · <span data-violation-message>{violation.message}</span>
              </p>
              {violation.rule !== null && (
                <p className={styles.rule} data-violation-rule>
                  {t("contexts.label.violations-rule", {
                    rule: violation.rule,
                  })}
                </p>
              )}
            </div>
            <Button onClick={() => onSend([violation])}>
              {t("contexts.button.violations-send")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
