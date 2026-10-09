// 외부 연결 안내. 대상과 지금 필요한 행동 하나만 보이고, 확인된 시각만 적는다.
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ExternalGuide } from "./external-guide.ts";
import styles from "./dock.module.css";

const TEXT = {
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

export function ExternalNotice(
  { guide, onReconnect, onCheck }: {
    guide: ExternalGuide;
    onReconnect?: () => void;
    onCheck: () => void;
  },
) {
  const action = guide.action === "reconnect" && onReconnect === undefined
    ? null
    : guide.action;
  return (
    <div
      className={`${styles.notice} ${styles.external}`}
      role="status"
      data-external={guide.kind}
      data-external-connection={guide.connection}
      data-external-action={action ?? undefined}
      data-confirmed-retry={guide.retryAt ?? undefined}
    >
      <span>
        {t(TEXT[guide.kind], { connection: guide.connection })}
        {guide.retryAt === null ? null : (
          <>
            {" "}
            {t("conversation.notice.external-retry-at", {
              when: confirmedWhen(guide.retryAt),
            })}
          </>
        )}
      </span>
      {action === "reconnect"
        ? (
          <Button variant="ghost" size="sm" onClick={onReconnect}>
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
