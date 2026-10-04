import { t } from "@lophn/wording";
import { EmptyState, folderOpenIcon } from "@lophn/design/components";

import type { CoreSource } from "../connection/connection.ts";
import { ConnectionNotice } from "../connection/connection.tsx";
import { TopBar } from "../top-bar/top-bar.tsx";
import styles from "./launcher.module.css";

export interface LauncherProps {
  source: CoreSource;
  /** 확인 시각의 표시. 테스트가 고정한다. */
  formatTime?: (confirmedAt: number) => string;
  /** lophn 관리 공간으로 이동한다. */
  onLophn: () => void;
}

// 최대폭 1040px 가운데 기둥. 카드는 실제 read 결과로만 채운다(desktop#R25).
export function Launcher({ source, formatTime, onLophn }: LauncherProps) {
  return (
    <div className={styles.launcher} data-space="launcher">
      <TopBar onLophn={onLophn} />
      <main className={styles.column}>
        <ConnectionNotice source={source} formatTime={formatTime} />
        <section className={styles.cards} data-cards="empty">
          <EmptyState
            icon={folderOpenIcon}
            message={t("launcher.empty.no-cards")}
            action={{ label: t("launcher.button.lophn"), onSelect: onLophn }}
          />
        </section>
      </main>
    </div>
  );
}
