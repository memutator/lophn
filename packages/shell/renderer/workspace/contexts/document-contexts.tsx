// 문서 탭 Info › Contexts: 이 문서가 들어 있는 context를 이름과 [Open]으로 나열한다.
// 하나도 없으면 비었음 글.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.document-open
//   contexts.empty.document-none
//   contexts.label.document-role
//   common.error.load-failed
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ContainingContext, ContextsSource } from "./source.ts";
import styles from "./document-contexts.module.css";

export interface DocumentContextsProps {
  readonly source: ContextsSource;
  readonly project: string;
  /** project 폴더 기준 상대 경로. */
  readonly path: string;
  /** [Open]. context ID를 넘긴다. */
  readonly onOpenContext: (context: string) => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "loaded";
    readonly contexts: readonly ContainingContext[];
  };

export function DocumentContexts(
  { source, project, path, onOpenContext }: DocumentContextsProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoad({ state: "loading" });
    source.containing(project, path).then(
      (result) => {
        if (current) {
          setLoad(
            result.ok
              ? { state: "loaded", contexts: result.value }
              : { state: "failed" },
          );
        }
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, project, path, attempt]);

  return (
    <Loading
      loading={load.state === "loading"}
      placeholder={<Skeleton lines={2} />}
    >
      {load.state === "failed" && (
        <ErrorState
          target={t("contexts.label.target-list")}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      )}
      {load.state === "loaded" && load.contexts.length === 0 && (
        <p className={styles.empty} data-empty>
          {t("contexts.empty.document-none")}
        </p>
      )}
      {load.state === "loaded" && load.contexts.length > 0 && (
        <ul className={styles.list}>
          {load.contexts.map((item) => (
            <li
              key={item.context}
              className={styles.row}
              data-containing={item.context}
            >
              <div className={styles.text}>
                <span className={styles.name} data-containing-name>
                  {item.title}
                </span>
                <span className={styles.role} data-containing-role>
                  {roleOf(item.types)}
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => onOpenContext(item.context)}
              >
                {t("contexts.button.document-open")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

/** 문서가 그 context에서 맡은 종류들: "as an Experiment, as a Finding". */
function roleOf(types: readonly string[]): string {
  return types
    .map((type) =>
      t("contexts.label.document-role", {
        article: articleOf(type),
        type,
      })
    )
    .join(", ");
}

/** 종류 이름 앞의 관사. 모음으로 시작하면 an, 아니면 a. */
function articleOf(type: string): "an" | "a" {
  return /^[aeiou]/i.test(type) ? "an" : "a";
}
