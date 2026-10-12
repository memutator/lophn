import { useEffect, useState } from "react";
import {
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  iconPixels,
  Tooltip,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { placeTitle } from "../model.ts";
import type { Catalog, LophnSource, SeriesRow } from "../source.ts";
import styles from "../documents/documents.module.css";

export interface SeriesPanelProps {
  source: LophnSource;
  catalog: Catalog;
  /** 등록·보관 뒤 올라간다. 목록을 다시 읽는다. */
  revision: number;
  current: string | null;
  onOpen: (id: string) => void;
  onRegister: () => void;
}

type Listed =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly rows: readonly SeriesRow[] };

// 자리마다 등록한 series 목록. 보관한 가족은 사람이 고를 때만 함께 보인다.
export function SeriesPanel(
  { source, catalog, revision, current, onOpen, onRegister }: SeriesPanelProps,
) {
  const [showArchived, setShowArchived] = useState(false);
  const [listed, setListed] = useState<Listed>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void source.seriesList(showArchived ? "all" : "active").then((result) => {
      if (!live) return;
      setListed(
        result.ok ? { kind: "ready", rows: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, showArchived, revision, attempt]);

  const registerLabel = t("documents.button.register-series");
  return (
    <div className={styles.section} data-panel="series">
      <div className={styles.toolbar}>
        <Checkbox
          label={t("documents.label.show-archived-series")}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        <Tooltip content={registerLabel}>
          <IconButton
            icon={lophnSpaceIcons.add}
            label={registerLabel}
            variant="secondary"
            data-register-series=""
            onClick={onRegister}
          />
        </Tooltip>
      </div>
      {listed.kind === "failed"
        ? (
          <ErrorState
            target={t("documents.label.target-series-list")}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        )
        : null}
      {listed.kind === "ready" && listed.rows.length === 0
        ? (
          <EmptyState
            icon={lophnSpaceIcons.series}
            message={t("documents.empty.no-series")}
            action={{ label: registerLabel, onSelect: onRegister }}
          />
        )
        : null}
      {listed.kind === "ready" && listed.rows.length > 0
        ? (
          <ul className={styles.rows} data-series-list="">
            {listed.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-series={row.id}
                  aria-current={row.id === current ? "true" : undefined}
                  onClick={() => onOpen(row.id)}
                >
                  <span className={styles.rowHead}>
                    <Icon
                      icon={row.archived
                        ? lophnSpaceIcons.archive
                        : lophnSpaceIcons.series}
                      pixels={iconPixels("base")}
                      className={styles.rowIcon}
                    />
                    <span className={styles.rowTitle}>{row.title}</span>
                  </span>
                  <span className={styles.meta}>
                    <span>
                      {t("documents.label.series-meta", {
                        place: placeTitle(catalog, row.place) ?? row.name,
                        count: row.members,
                      })}
                    </span>
                    {row.archived
                      ? <span>{t("documents.label.archived")}</span>
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
