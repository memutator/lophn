import { useEffect, useState } from "react";
import {
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  iconPixels,
  lophnSpaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ContextsSource, FocusRow } from "../source.ts";
import styles from "../../documents/documents.module.css";

export interface FocusListProps {
  source: ContextsSource;
  /** 보관·해제 뒤 올라간다. 목록을 다시 읽는다. */
  revision: number;
  current: string | null;
  onOpen: (id: string) => void;
  /** 대화 도크를 연다. Focus는 대화에서 함께 만든다(flow build-context). */
  onAsk?: () => void;
}

type Listed =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly FocusRow[] };

// Focus 목록. 사람이 지은 이름과 목적만 보이고 중간 계층은 없다(desktop#R28). 보관한 Focus는
// 사람이 고를 때만 함께 보인다.
export function FocusList(
  { source, revision, current, onOpen, onAsk }: FocusListProps,
) {
  const [showArchived, setShowArchived] = useState(false);
  const [listed, setListed] = useState<Listed>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void source.list(showArchived ? "all" : "active").then((result) => {
      if (!live) return;
      setListed(
        result.ok ? { kind: "ready", rows: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, showArchived, revision, attempt]);

  return (
    <div className={styles.section} data-focus-list="">
      <div className={styles.toolbar}>
        <Checkbox
          label={t("contexts.label.show-archived")}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
      </div>
      {listed.kind === "failed"
        ? (
          <ErrorState
            target={t("contexts.label.target-list")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        )
        : null}
      {listed.kind === "ready" && listed.rows.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.contexts}
            message={t("contexts.empty.no-focus")}
            action={onAsk
              ? { label: t("contexts.button.ask"), onSelect: onAsk }
              : {
                label: t("contexts.label.show-archived"),
                onSelect: () => setShowArchived(true),
              }}
          />
        )
        : null}
      {listed.kind === "ready" && listed.rows.length > 0
        ? (
          <ul className={styles.rows}>
            {listed.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-focus={row.id}
                  aria-current={row.id === current ? "true" : undefined}
                  onClick={() => onOpen(row.id)}
                >
                  <span className={styles.rowHead}>
                    <Icon
                      icon={row.archived
                        ? lophnSpaceIcons.archive
                        : lophnSpaceIcons.contexts}
                      pixels={iconPixels("base")}
                      className={styles.rowIcon}
                    />
                    <span className={styles.rowTitle}>{row.title}</span>
                  </span>
                  <span className={styles.snippet}>{row.purpose}</span>
                  <span className={styles.meta}>
                    <span>
                      {t("contexts.label.item-count", { count: row.items })}
                    </span>
                    {row.archived
                      ? <span>{t("contexts.label.archived")}</span>
                      : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  );
}
