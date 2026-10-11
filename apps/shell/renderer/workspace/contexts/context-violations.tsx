// Violations: 계약을 어긴 문서를 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄·
// [Send to Context Engineer]로 보이고 위에 [Send all to Context Engineer]를 둔다(shell/workspace#R19).
// 이미 넘긴 줄은 "Context Engineer is on it", 위반이 없으면 "No violations."만. 구현은 ctx-I44.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.violations-send
//   contexts.button.violations-send-all
//   contexts.empty.violations-none
//   contexts.error.violations-send-failed
//   contexts.label.violations-on-it
//   contexts.label.violations-rule
//   common.error.load-failed
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button, ErrorState } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  fileName,
  keyText,
  sortViolations,
  violationKey,
} from "./context-violations-model.ts";
import styles from "./context-violations.module.css";
import type { ContextsSource, StoredViolation } from "./source.ts";
import type { OpenDocument } from "./shared.ts";

export interface ContextViolationsProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 파일 이름을 누르면 그 문서 탭을 연다. */
  readonly onOpenDocument: OpenDocument;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly violations: readonly StoredViolation[];
    /** 이미 넘긴 위반의 keyText. */
    readonly handedOff: ReadonlySet<string>;
  };

export function ContextViolations(
  { source, context, onOpenDocument }: ContextViolationsProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

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
              handedOff: new Set(result.value.handed_off.map(keyText)),
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

  // 넘긴 줄만 상태 글로 바꾼다. 실패하면 줄은 그대로고 오류 글만 보인다.
  const handOff = useCallback(
    async (violations: readonly StoredViolation[] | null) => {
      setSending(true);
      setSendFailed(false);
      let succeeded = false;
      try {
        const result = await source.handOffViolations(
          violations === null
            ? { context }
            : { context, violations: violations.map(violationKey) },
        );
        succeeded = result.ok;
      } catch {
        succeeded = false;
      }
      setSending(false);
      if (!succeeded) {
        setSendFailed(true);
        return;
      }
      setLoad((previous) => {
        if (previous.state !== "ready") return previous;
        const handedOff = new Set(previous.handedOff);
        for (const violation of violations ?? previous.violations) {
          handedOff.add(keyText(violation));
        }
        return { ...previous, handedOff };
      });
    },
    [source, context],
  );

  if (load.state === "loading") return null;
  if (load.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.target-focus")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  if (load.violations.length === 0) {
    return (
      <p className={styles.empty}>{t("contexts.empty.violations-none")}</p>
    );
  }
  const pending = load.violations.some((violation) =>
    !load.handedOff.has(keyText(violation))
  );
  return (
    <div>
      {pending && (
        <div className={styles.bulk}>
          <Button disabled={sending} onClick={() => void handOff(null)}>
            {t("contexts.button.violations-send-all")}
          </Button>
        </div>
      )}
      {sendFailed && (
        <p className={styles.error} role="alert" data-violations-error>
          {t("contexts.error.violations-send-failed")}
        </p>
      )}
      <ul className={styles.rows}>
        {load.violations.map((violation) => (
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
            {load.handedOff.has(keyText(violation))
              ? (
                <span className={styles.status} data-violation-status>
                  {t("contexts.label.violations-on-it")}
                </span>
              )
              : (
                <Button
                  disabled={sending}
                  onClick={() => void handOff([violation])}
                >
                  {t("contexts.button.violations-send")}
                </Button>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}
