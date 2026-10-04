import { useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { ConnectionState, CoreSource } from "./connection.ts";
import { initialConnection } from "./connection.ts";
import styles from "./connection.module.css";

export interface ConnectionNoticeProps {
  source: CoreSource;
  /** 확인 시각을 글로 바꾼다. 기본은 절대 시각이다. */
  formatTime?: (confirmedAt: number) => string;
}

// 준비 전·실패·단절을 구별하고 다음 행동 하나를 보인다(desktop#R7, wording#R10).
export function ConnectionNotice(
  { source, formatTime = absoluteTime }: ConnectionNoticeProps,
) {
  const [connection, setConnection] = useState<ConnectionState>(
    initialConnection,
  );
  useEffect(() => source.subscribe(setConnection), [source]);
  if (connection.state === "ready") return null;

  const retry = () => {
    void source.call({
      kind: "read",
      resource: "platform",
      method: "status",
      body: {},
    });
  };
  const failed = connection.state === "failed";
  return (
    <div
      className={styles.notice}
      role="status"
      data-connection={connection.state}
    >
      <p className={styles.message}>
        {t(
          connection.state === "starting"
            ? "launcher.connection.starting"
            : failed
            ? "launcher.connection.failed"
            : "launcher.connection.disconnected",
        )}
      </p>
      {connection.state === "stale" && connection.confirmedAt !== null && (
        <p className={styles.confirmed}>
          {t("launcher.connection.confirmed-at", {
            when: formatTime(connection.confirmedAt),
          })}
        </p>
      )}
      {connection.state !== "starting" && (
        <Button variant="primary" onClick={retry}>
          {t(failed ? "launcher.button.retry" : "launcher.button.reconnect")}
        </Button>
      )}
    </div>
  );
}

function absoluteTime(confirmedAt: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(confirmedAt));
}
