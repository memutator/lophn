// core가 준비되지 않았거나 시작에 실패했을 때 Home 자리에 서는 화면. 준비 전·실패는 shell 틀 대신 연결 화면을 보이고,
// 시작 실패(sandbox, 높은 schema 등)는 다음 행동 하나를 보인다.
import { t } from "@lophn/i18n";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import { TopBar, Wordmark } from "../top-bar/top-bar.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { failureOf } from "./start-failure/model.ts";
import { StartFailureScreen } from "./start-failure/start-failure.tsx";
import styles from "./home-gate.module.css";

export function HomeGate({
  source,
  platform,
}: {
  source: CoreSource;
  /** 상단 바가 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
}) {
  const connection = useConnection(source);
  const retry = () => retryConnection(source);
  const failure = failureOf(connection);
  return (
    <div className={styles.window} data-space="home" data-gated="">
      <TopBar
        platform={platform}
        leading={<Wordmark>{t("launcher.label.wordmark")}</Wordmark>}
      />
      <main className={styles.body}>
        {failure !== null ? (
          <StartFailureScreen failure={failure} onRetry={retry} />
        ) : (
          <ConnectionGate connection={connection} onRetry={retry} />
        )}
      </main>
    </div>
  );
}
