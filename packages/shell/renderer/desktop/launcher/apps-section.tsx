import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";
import {
  EmptyState,
  ErrorState,
  Icon,
  iconPixels,
  Skeleton,
  StatusMark,
} from "@lophn/design/components";
import { appSpaceIcons } from "../../icons/mod.ts";

import {
  appStatus,
  sortApps,
  statusLabel,
  statusTone,
} from "../lophn-space/apps/model.ts";
import type {
  AppRow,
  AppsSource,
  RunState,
} from "../lophn-space/apps/source.ts";
import styles from "./launcher.module.css";

export interface AppsSectionProps {
  source: AppsSource;
  /** 그 앱의 앱 공간을 연다. lophn 공간 apps 화면의 [Open]과 같은 길이다. */
  onApp: (app: string) => void;
  /** 앱이 없을 때의 다음 행동. */
  onLophn: () => void;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly AppRow[] };

// 프로젝트 section 아래의 앱 section. 보관하지 않은 앱만 카드로 보이고, 카드 전체가 그 앱 공간으로
// 가는 단추다(shell/desktop#R25). 목록과 실행 상태는 lophn 공간 apps 화면과 같은 통로로 읽는다.
export function AppsSection({ source, onApp, onLophn }: AppsSectionProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [runs, setRuns] = useState<Readonly<Record<string, RunState>> | null>(
    null,
  );

  const load = useCallback(async () => {
    const result = await source.list();
    if (!result.ok) {
      setLoaded({ state: "failed" });
      return;
    }
    const rows = sortApps(result.value).filter((row) => !row.archived);
    setLoaded({ state: "ready", rows });
    // core reader는 한 사람의 동시 읽기 수를 제한하므로 실행 상태를 하나씩 읽는다.
    const next: Record<string, RunState> = {};
    for (const row of rows) {
      const run = await source.runtime(row.id);
      if (run.ok) next[row.id] = run.value;
    }
    setRuns(next);
  }, [source]);

  // 처음 열 때와 core가 다시 준비될 때 읽는다.
  useEffect(() => {
    let previous: string | null = null;
    const stop = source.watch((state) => {
      if (state.state === "ready" && previous !== "ready") void load();
      previous = state.state;
    });
    if (previous === null) void load();
    return stop;
  }, [source, load]);

  let body: ReactNode;
  if (loaded.state === "loading") {
    body = (
      <ul className={styles.grid} data-cards="loading" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.skeletonCard}>
            <Skeleton lines={2} />
          </li>
        ))}
      </ul>
    );
  } else if (loaded.state === "failed") {
    body = (
      <div className={styles.emptyCard} data-cards="failed">
        <ErrorState
          target={t("launcher.label.apps")}
          onRetry={() => {
            setLoaded({ state: "loading" });
            void load();
          }}
        />
      </div>
    );
  } else if (loaded.rows.length === 0) {
    body = (
      <div className={styles.emptyCard} data-cards="empty">
        <EmptyState
          icon={appSpaceIcons.app}
          message={t("launcher.empty.no-apps")}
          action={{ label: t("launcher.button.lophn"), onSelect: onLophn }}
        />
      </div>
    );
  } else {
    body = (
      <ul className={styles.grid} data-cards="apps">
        {loaded.rows.map((row) => {
          const status = runs === null
            ? null
            : appStatus(row, runs[row.id] ?? null);
          return (
            <li key={row.id}>
              <article
                className={styles.card}
                data-card="app"
                data-app={row.id}
              >
                <div className={styles.cardHead}>
                  <button
                    type="button"
                    className={styles.cardOpen}
                    onClick={() => onApp(row.id)}
                  >
                    <Icon
                      icon={appSpaceIcons.app}
                      pixels={iconPixels("base")}
                      className={styles.cardIcon}
                    />
                    <span className={styles.cardTitle}>{row.name}</span>
                  </button>
                </div>
                {status === null
                  ? null
                  : (
                    <div className={styles.cardStatus} data-status={status}>
                      <StatusMark
                        tone={statusTone(status)}
                        label={statusLabel(status)}
                      />
                    </div>
                  )}
              </article>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className={styles.section} data-section="apps">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("launcher.heading.apps")}
          {loaded.state === "ready" && loaded.rows.length > 0
            ? <span className={styles.count}>{loaded.rows.length}</span>
            : null}
        </h2>
      </div>
      {body}
    </section>
  );
}
