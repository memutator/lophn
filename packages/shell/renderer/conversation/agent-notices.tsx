// 대화 입력 위의 안내 한 줄. 로컬 문서·앱·터미널은 그대로 두고 대화에만 필요한
// 행동 하나를 말한다. 확인된 시각만 적는다.
import type { ReactElement } from "react";
import { Button, Icon, iconPixels } from "@lophn/design/components";
import { connectionStaleIcon } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { AgentNotice } from "./agent-source.ts";
import styles from "./agent-notices.module.css";

const EXTERNAL_TEXT = {
  waiting: "conversation.notice.external-waiting",
  "connection-failed": "conversation.notice.external-failed",
  unknown: "conversation.notice.external-unknown",
} as const;

function confirmedWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export interface AgentNoticesProps {
  notices: readonly AgentNotice[];
  /** 일이 돌고 있다. 진행 중인 run의 일시 실패는 harness가 retry하므로 끝난 뒤에만 연결 실패를 말한다. */
  working: boolean;
  /** 설정의 연결 자리로 간다. 없으면 행동 단추를 두지 않는다. */
  onConnections?: (() => void) | undefined;
  onCheck: () => void;
}

export function AgentNotices(
  { notices, working, onConnections, onCheck }: AgentNoticesProps,
): ReactElement | null {
  const shown = notices.filter((notice) =>
    !(notice.kind === "external" && notice.state === "connection-failed" &&
      working)
  );
  if (shown.length === 0) return null;
  return (
    <div className={styles.notices}>
      {shown.map((notice) =>
        notice.kind === "provider-lost"
          ? (
            <div
              key="provider-lost"
              className={styles.notice}
              role="status"
              data-provider="unusable"
            >
              <span className={styles.text}>
                <Icon
                  icon={connectionStaleIcon}
                  pixels={iconPixels("base")}
                  className={styles.muted}
                />
                {t("conversation.notice.provider-lost")}
              </span>
              {onConnections
                ? (
                  <Button variant="ghost" size="sm" onClick={onConnections}>
                    {t("settings.label.tab-connections")}
                  </Button>
                )
                : null}
            </div>
          )
          : (
            <ExternalLine
              key={`external-${notice.state}`}
              notice={notice}
              onConnections={onConnections}
              onCheck={onCheck}
            />
          )
      )}
    </div>
  );
}

function ExternalLine(
  { notice, onConnections, onCheck }: {
    notice: Extract<AgentNotice, { kind: "external" }>;
    onConnections: (() => void) | undefined;
    onCheck: () => void;
  },
): ReactElement {
  const action = notice.action === "reconnect" && onConnections === undefined
    ? null
    : notice.action;
  return (
    <div
      className={styles.notice}
      role="status"
      data-external={notice.state}
      data-external-connection={notice.connection}
      data-external-action={action ?? undefined}
      data-confirmed-retry={notice.retryAt ?? undefined}
    >
      <span className={styles.text}>
        {t(EXTERNAL_TEXT[notice.state], { connection: notice.connection })}
        {notice.retryAt === null ? null : (
          <>
            {" "}
            {t("conversation.notice.external-retry-at", {
              when: confirmedWhen(notice.retryAt),
            })}
          </>
        )}
      </span>
      {action === "reconnect"
        ? (
          <Button variant="ghost" size="sm" onClick={onConnections}>
            {t("launcher.button.reconnect")}
          </Button>
        )
        : null}
      {action === "check"
        ? (
          <Button variant="ghost" size="sm" onClick={onCheck}>
            {t("conversation.button.check-result")}
          </Button>
        )
        : null}
    </div>
  );
}
