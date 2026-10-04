import { t } from "@lophn/wording";
import { EmptyState, launcherEmptyIcon } from "@lophn/design/components";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  ConnectionNotice,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import { LophnEntry, TopBar, Wordmark } from "../top-bar/top-bar.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import styles from "./launcher.module.css";

export interface LauncherProps {
  source: CoreSource;
  /** 확인 시각의 표시. 테스트가 고정한다. */
  formatTime?: (confirmedAt: number) => string;
  /** lophn 관리 공간으로 이동한다. */
  onLophn: () => void;
  /** 상단 바가 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
}

// 이전 lophn 런처 모양: 48px 바 아래 1040px 가운데 기둥. 준비 전·실패는 기둥 대신 연결 화면을
// 보이고, 단절은 마지막 화면 위에 한 줄을 더한다. 카드는 실제 read 결과로만 채운다(desktop#R7, R25).
export function Launcher(
  { source, formatTime, onLophn, platform }: LauncherProps,
) {
  const connection = useConnection(source);
  const retry = () => retryConnection(source);
  const gated = connection.state === "starting" ||
    connection.state === "failed";
  return (
    <div
      className={styles.window}
      data-space="launcher"
      data-gated={gated ? "" : undefined}
    >
      <TopBar
        platform={platform}
        leading={<Wordmark>{t("launcher.label.wordmark")}</Wordmark>}
        trailing={gated ? undefined : <LophnEntry onLophn={onLophn} />}
      />
      <main className={styles.scroll}>
        {gated
          ? <ConnectionGate connection={connection} onRetry={retry} />
          : (
            <div className={styles.page} data-column="launcher">
              <ConnectionNotice
                connection={connection}
                onRetry={retry}
                formatTime={formatTime}
              />
              <section className={styles.emptyCard} data-cards="empty">
                <EmptyState
                  icon={launcherEmptyIcon}
                  message={t("launcher.empty.no-cards")}
                  action={{
                    label: t("launcher.button.lophn"),
                    onSelect: onLophn,
                  }}
                />
              </section>
            </div>
          )}
      </main>
    </div>
  );
}
