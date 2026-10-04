import { useEffect, useState } from "react";
import { t } from "@lophn/wording";
import {
  Button,
  connectionFailedIcon,
  connectionStaleIcon,
  Icon,
  iconPixels,
  retryIcon,
  Skeleton,
} from "@lophn/design/components";

import type { ConnectionState, CoreSource } from "./connection.ts";
import { initialConnection } from "./connection.ts";
import styles from "./connection.module.css";

/** main이 민 연결 상태를 따른다. */
export function useConnection(source: CoreSource): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>(
    initialConnection,
  );
  useEffect(() => source.subscribe(setConnection), [source]);
  return connection;
}

/** 다시 시도·다시 연결은 core 상태를 한 번 읽어 main이 연결을 다시 확인하게 한다. */
export function retryConnection(source: CoreSource): void {
  void source.call({
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  });
}

export interface ConnectionGateProps {
  connection: ConnectionState;
  onRetry: () => void;
}

// 준비 전·실패는 본문 대신 640px 기둥에 놓인다. 준비 전은 자리 모양만, 실패는 다음 행동
// 하나를 보인다(desktop#R7, wording#R10). 이전 lophn의 DaemonGate 모양이다.
export function ConnectionGate({ connection, onRetry }: ConnectionGateProps) {
  if (connection.state === "failed") {
    return (
      <div className={styles.gate}>
        <div
          className={styles.failed}
          role="status"
          data-connection="failed"
        >
          <Icon
            icon={connectionFailedIcon}
            pixels={iconPixels("large")}
            className={styles.critical}
          />
          <div className={styles.body}>
            <p className={styles.title}>{t("launcher.connection.failed")}</p>
            <div>
              <Button variant="primary" icon={retryIcon} onClick={onRetry}>
                {t("launcher.button.retry")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.gate}>
      <div
        className={styles.starting}
        role="status"
        data-connection={connection.state}
      >
        <h1 className={styles.heading}>
          {t("launcher.connection.starting")}
        </h1>
        <div className={styles.skeleton} aria-hidden="true">
          <span className={styles.block} />
          <span className={styles.lineLong}>
            <Skeleton />
          </span>
          <span className={styles.lineShort}>
            <Skeleton />
          </span>
          <span className={styles.lineMiddle}>
            <Skeleton />
          </span>
        </div>
      </div>
    </div>
  );
}

export interface ConnectionNoticeProps {
  connection: ConnectionState;
  onRetry: () => void;
  /** 확인 시각을 글로 바꾼다. 기본은 절대 시각이다. */
  formatTime?: (confirmedAt: number) => string;
}

// 단절은 마지막 화면을 그대로 두고 위에 한 줄로 최신 확인 못함·확인 시각·다시 연결을 보인다(desktop#R7).
export function ConnectionNotice(
  { connection, onRetry, formatTime = absoluteTime }: ConnectionNoticeProps,
) {
  if (connection.state !== "stale") return null;
  return (
    <div className={styles.notice} role="status" data-connection="stale">
      <span className={styles.noticeText}>
        <Icon
          icon={connectionStaleIcon}
          pixels={iconPixels("base")}
          className={styles.muted}
        />
        <span className={styles.message}>
          {t("launcher.connection.disconnected")}
        </span>
        {connection.confirmedAt !== null && (
          <span className={styles.confirmed}>
            {t("launcher.connection.confirmed-at", {
              when: formatTime(connection.confirmedAt),
            })}
          </span>
        )}
      </span>
      <Button icon={retryIcon} onClick={onRetry}>
        {t("launcher.button.reconnect")}
      </Button>
    </div>
  );
}

function absoluteTime(confirmedAt: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(confirmedAt));
}
