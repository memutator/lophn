// 정보 패널의 컨텍스트 탭(shell/editor#R6). 이 문서를 직접 담은 Focus를 32px 행으로 보이고,
// 고르면 lophn 공간 contexts 화면에서 그 Focus를 연다.
import { useEffect, useState } from "react";
import {
  editorIcons,
  ErrorState,
  Icon,
  iconPixels,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { DocumentContext, VersionSource } from "../versions/source.ts";
import styles from "./info-panel.module.css";

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: readonly DocumentContext[] };

export function ContextsTab(
  { document, source, onOpen }: {
    document: string;
    source: VersionSource;
    /** 고른 Focus를 연다. 없으면 행은 이름만 보인다. */
    onOpen?: (context: string) => void;
  },
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoaded({ kind: "loading" });
    void source.contexts(document).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok ? { kind: "ready", value: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, document, attempt]);

  if (loaded.kind === "loading") return <Skeleton shape="line" lines={3} />;
  if (loaded.kind === "failed") {
    return (
      <ErrorState
        target={t("document.label.contexts-target")}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  if (loaded.value.length === 0) {
    return <p className={styles.muted}>{t("document.empty.contexts")}</p>;
  }
  return (
    <ul className={styles.list} data-info-contexts="">
      {loaded.value.map((context) => {
        const body = (
          <>
            <Icon
              icon={editorIcons.context}
              pixels={iconPixels("small")}
              className={styles.rowIcon}
            />
            <span className={styles.who}>{context.title}</span>
          </>
        );
        return (
          <li key={context.id} className={styles.row}>
            {onOpen
              ? (
                <button
                  type="button"
                  className={styles.rowButton}
                  data-open-context={context.id}
                  onClick={() => onOpen(context.id)}
                >
                  {body}
                </button>
              )
              : body}
          </li>
        );
      })}
    </ul>
  );
}
