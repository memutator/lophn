import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";
import { Button, Icon } from "@lophn/ui/primitives";
import { Shimmer } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { actionIcons, connectionStaleIcon } from "../../icons/mod.ts";

import type { MachineItem } from "../machines/source.ts";
import type { ConnectionState, CoreSource } from "./connection.ts";
import { initialConnection } from "./connection.ts";
import styles from "./connection.module.css";

/** main이 민 연결 상태를 따른다. */
export function useConnection(source: CoreSource): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>(
    () => source.current?.() ?? initialConnection,
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

// 준비 전은 시작 화면 card 가운데 640px 기둥에 흐르는 한 줄만 보인다.
export function ConnectionGate({
  connection,
}: {
  connection: ConnectionState;
}) {
  return (
    <div className={styles.gate}>
      <div className={styles.starting} data-connection={connection.state}>
        <Shimmer>{t("home.connection.starting")}</Shimmer>
      </div>
    </div>
  );
}

interface ConnectionNoticeProps {
  connection: ConnectionState;
  /** 다른 기계의 창이면 그 기계. 판이 어긋났으면(status update) 끊김 대신 어느 쪽 lophn을 올릴지 말한다. */
  machine?: MachineItem | null;
  onRetry: () => void;
  /** 확인 시각을 글로 바꾼다. 기본은 절대 시각이다. */
  formatTime?: (confirmedAt: number) => string;
}

// 단절은 마지막 화면을 그대로 두고 위에 한 줄로 최신 확인 못함·확인 시각·다시 연결을 보인다.
export function ConnectionNotice({
  connection,
  machine = null,
  onRetry,
  formatTime = absoluteTime,
}: ConnectionNoticeProps) {
  if (connection.state !== "stale") return null;
  // MachineGate와 같은 글이다. 다시 연결은 판을 맞춘 뒤에야 된다.
  const message =
    machine?.status !== "update"
      ? t("home.connection.disconnected")
      : machine.update === "client"
        ? t("machine-update.viewer.desktop-client", { name: machine.name })
        : t("machine-update.viewer.desktop-host", { name: machine.name });
  return (
    <div className={styles.notice} role="status" data-connection="stale">
      <span className={styles.noticeText}>
        <Icon
          icon={connectionStaleIcon}
          pixels={iconPixels("base")}
          className={styles.muted}
        />
        <span
          className={styles.message}
          data-machine-update={machine?.update ?? undefined}
        >
          {message}
        </span>
        {connection.confirmedAt !== null && (
          <span className={styles.confirmed}>
            {t("home.connection.confirmed-at", {
              when: formatTime(connection.confirmedAt),
            })}
          </span>
        )}
      </span>
      <Button icon={actionIcons.retry} onClick={onRetry}>
        {t("home.button.reconnect")}
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

// provider 끊김: 로컬 문서·앱·터미널은 그대로 두고 대화에만 필요한 행동 한 줄(설정으로
// 연결·다시 연결)을 보인다. core가 준비되지 않았거나 아직 읽지 못했으면 null이다.
