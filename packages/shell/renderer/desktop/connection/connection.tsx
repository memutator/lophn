import { useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { Button, Icon, iconPixels, Skeleton } from "@lophn/design/components";
import {
  connectionFailedIcon,
  connectionStaleIcon,
  retryIcon,
} from "../../icons/mod.ts";

import type { ConnectionState, CoreSource } from "./connection.ts";
import { initialConnection } from "./connection.ts";
import type { ProviderFacts } from "./provider-state.ts";
import styles from "./connection.module.css";

/** main이 민 연결 상태를 따른다. */
export function useConnection(source: CoreSource): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>(() =>
    source.current?.() ?? initialConnection
  );
  useEffect(() => source.subscribe(setConnection), [source]);
  return connection;
}

const NO_CONNECTION: CoreSource = {
  subscribe: () => () => {},
  call: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "core bridge is missing" },
    }),
};

/**
 * 통로가 없는 창(테스트·다른 창)에서도 훅 순서를 같게 두고 ready를 보인다 — 통로가 없다는
 * 것은 끊김을 알 길이 없다는 뜻이므로 끊김 줄을 걸지 않는다. 통로가 있으면 useConnection과
 * 같다.
 */
export function useConnectionSafe(
  core: CoreSource | undefined,
): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>(
    () => core?.current?.() ?? { state: "ready", confirmedAt: null },
  );
  useEffect(
    () => (core ?? NO_CONNECTION).subscribe(setConnection),
    [core],
  );
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
// 하나를 보인다. 이전 lophn의 DaemonGate 모양이다.
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

// 단절은 마지막 화면을 그대로 두고 위에 한 줄로 최신 확인 못함·확인 시각·다시 연결을 보인다.
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

export interface ProviderNoticeProps {
  /** 대화 입력칸의 끊김 안내 위에 놓인다. provider를 읽지 못했으면 null이다. */
  facts: ProviderFacts | null;
  /** 설정의 연결 자리로 연다. 없으면 행동만 말한다. */
  onSettings?: () => void;
  /** 다시 읽는다. provider 판정이 바뀔 만한 때에 부른다. */
  onRefresh?: () => void;
}

// provider 끊김: 로컬 문서·앱·터미널은 그대로 두고 대화에만 필요한 행동 한 줄(설정으로
// 연결·다시 연결)을 보인다. core가 준비되지 않았거나 아직 읽지 못했으면 null이다.
export function ProviderNotice(
  { facts, onSettings, onRefresh }: ProviderNoticeProps,
) {
  if (facts === null || usableFacts(facts)) return null;
  return (
    <div className={styles.notice} role="status" data-provider="unusable">
      <span className={styles.noticeText}>
        <Icon
          icon={connectionStaleIcon}
          pixels={iconPixels("base")}
          className={styles.muted}
        />
        <span className={styles.message}>
          {t("conversation.notice.provider-lost")}
        </span>
      </span>
      {onSettings
        ? (
          <Button variant="ghost" onClick={onSettings}>
            {t("settings.label.tab-connections")}
          </Button>
        )
        : null}
      {onRefresh && facts.providers === null
        ? (
          <Button variant="ghost" onClick={onRefresh}>
            {t("document.button.check-again")}
          </Button>
        )
        : null}
    </div>
  );
}

function usableFacts(facts: ProviderFacts): boolean {
  return facts.providers !== null && facts.usable;
}
