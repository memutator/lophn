// 알림 줄 하나. Notifications(휘발)와 History(영구)가 같이 쓴다. 줄을 누르면 그 앱이 열린다(앱이 없는 기록은 열지 않는다).
// 오른쪽 끝 열은 줄마다 같은 자리다: action 단추, 지우기(휘발)나 읽음 표시(안 읽은 영구).

import { formatRelativeTime, type MessageKey, t } from "@lophn/i18n";
import { Button, IconButton } from "@lophn/ui/primitives";
import type {
  Notice,
  NoticeAction,
} from "../../../../../protocol/apps/notice.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { KIND_LABEL } from "./notice-kinds.ts";
import styles from "./waiting.module.css";

// action은 종류로만 그린다. 종류를 더하면 여기에 단추 모양을 더한다.
const ACTION_BUTTON = {
  open_home_skill: {
    label: "waiting.button.ask-lophn",
    icon: actionIcons.send,
  },
} as const satisfies Record<
  NoticeAction["kind"],
  { label: MessageKey; icon: (typeof actionIcons)[keyof typeof actionIcons] }
>;

export function NoticeRow({
  row,
  onOpen,
  onDismiss,
  onAction,
}: {
  row: Notice;
  onOpen: (app: string) => void;
  /** 휘발 줄은 지우고, 안 읽은 영구 줄은 읽음으로 바꾼다. 읽은 줄에는 단추가 없다. */
  onDismiss: (id: string) => void;
  /** 있으면 action이 있는 줄에 단추를 그린다. action은 영구 기록(program)만 가져 History가 준다. */
  onAction?: (row: Notice, action: NoticeAction) => void;
}) {
  const unread = row.read_at === null;
  // 휘발 줄은 늘 안 읽은 줄이라 읽음 표시는 영구 줄만 그린다.
  const marked = row.persistent && unread;
  const app = row.app;
  const action = row.action === null ? null : ACTION_BUTTON[row.action.kind];
  return (
    <div
      className={`${styles.request} ${app === null ? "" : styles.finished}`}
      data-kind="notice"
      data-persistent={row.persistent || undefined}
      data-unread={unread || undefined}
      onClick={() => app !== null && onOpen(app)}
    >
      <div className={styles.who}>
        {row.persistent ? (
          <span className={styles.unreadSlot}>
            {unread ? (
              <span
                className={styles.unreadDot}
                role="img"
                aria-label={t("waiting.label.unread")}
              />
            ) : null}
          </span>
        ) : null}
        <div className={styles.whoText}>
          <p className={styles.title}>{row.title}</p>
          {row.body === "" ? null : (
            <span className={styles.meta}>{row.body}</span>
          )}
          <span className={styles.meta}>
            {[
              row.app_name,
              row.kind === "app" ? null : t(KIND_LABEL[row.kind]),
              formatRelativeTime(new Date(row.created_at), new Date()),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        </div>
        {action === null ||
        row.action === null ||
        onAction === undefined ? null : (
          <Button
            size="sm"
            icon={action.icon}
            data-notice-action={row.action.kind}
            onClick={(event) => {
              // 줄을 누른 것(앱 열기)으로 올라가지 않게 한다.
              event.stopPropagation();
              onAction(row, row.action!);
            }}
          >
            {t(action.label)}
          </Button>
        )}
        {row.persistent && !unread ? (
          <span className={styles.slot} />
        ) : (
          <IconButton
            size="sm"
            icon={marked ? actionIcons.confirm : actionIcons.remove}
            label={t(
              marked
                ? "waiting.button.mark-read"
                : "waiting.button.dismiss-notice",
            )}
            data-dismiss-notice=""
            onClick={(event) => {
              event.stopPropagation();
              onDismiss(row.id);
            }}
          />
        )}
      </div>
    </div>
  );
}
