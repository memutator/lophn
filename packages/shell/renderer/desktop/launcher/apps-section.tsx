import type { ReactNode } from "react";
import { t } from "@lophn/wording";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { appSpaceIcons, commonIcons, launcherIcons } from "../../icons/mod.ts";

import type { AppRow } from "../../apps/source.ts";
import { CardMenu } from "./card-menu.tsx";
import type { Loaded } from "./model.ts";
import styles from "./launcher.module.css";

interface AppsSectionProps {
  apps: Loaded<AppRow>;
  /** 그 앱의 앱 공간을 연다. */
  onApp: (app: string) => void;
  /** 새 앱 창을 연다. */
  onNew: () => void;
  /** 앱을 보관한다. 복원은 Archived 묶음에서 한다. */
  onArchive: (app: AppRow) => void;
  onRetry: () => void;
}

// 프로젝트 section 아래의 앱 section. 보관하지 않은 앱만 카드로 보이고, 카드 전체가 그 앱 공간으로
// 가는 단추다. 보관은 ⋯ 메뉴에 있다.
export function AppsSection({
  apps,
  onApp,
  onNew,
  onArchive,
  onRetry,
}: AppsSectionProps) {
  const newApp = t("launcher.button.new-app");
  let body: ReactNode;
  if (apps.state === "loading") {
    body = (
      <ul className={styles.grid} data-cards="loading" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.skeletonCard}>
            <Skeleton lines={2} />
          </li>
        ))}
      </ul>
    );
  } else if (apps.state === "failed") {
    body = (
      <div className={styles.emptyCard} data-cards="failed">
        <ErrorState target={t("launcher.label.apps")} onRetry={onRetry} />
      </div>
    );
  } else if (apps.items.length === 0) {
    body = (
      <div className={styles.emptyCard} data-cards="empty">
        <EmptyState
          icon={appSpaceIcons.app}
          message={t("launcher.empty.no-apps")}
          action={{ label: newApp, onSelect: onNew }}
        />
      </div>
    );
  } else {
    body = (
      <ul className={styles.grid} data-cards="apps">
        {apps.items.map((row) => (
          <li key={row.id}>
            <article className={styles.card} data-card="app" data-app={row.id}>
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
                <span className={styles.cardAside}>
                  <CardMenu
                    name={row.name}
                    items={[
                      {
                        id: "archive",
                        label: t("launcher.button.archive"),
                        icon: commonIcons.archive,
                      },
                    ]}
                    onSelect={() => onArchive(row)}
                  />
                </span>
              </div>
            </article>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className={styles.section} data-section="apps">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("launcher.heading.apps")}
          {apps.state === "ready" && apps.items.length > 0 ? (
            <span className={styles.count}>{apps.items.length}</span>
          ) : null}
        </h2>
        <Tooltip content={newApp}>
          <IconButton
            icon={launcherIcons.register}
            label={newApp}
            data-new-app=""
            onClick={onNew}
          />
        </Tooltip>
      </div>
      {body}
    </section>
  );
}
