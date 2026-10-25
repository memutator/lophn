// 보낸 session의 call 블록. 일반 tool 한 줄 대신 받는 곳, 맡긴 글 한 줄, 답 방식을 보인다. 누르면 그때의 상태를
// 읽어 보이고, 상태가 바뀌어도 따로 알리지 않는다. 끝나지 않은 call은 머리 줄 오른쪽 [Cancel]로 사람이 취소한다.
// 답과 실패는 이 블록 안이 아니라 이어지는 새 메시지(ReceivedMessage)로 보인다. [Open conversation]은 받은 session을
// 연다. 답 없이 맡긴 일은 사람이 거기서 이어 가야 하기 때문이다.
import { type ReactElement, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { type MessageKey, t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import type {
  AgentTabSource,
  CallFailReason,
  CallReply,
  CallStatus,
  CallView,
} from "../agent-tab-source.ts";
import styles from "./thread.module.css";

const REPLY_LABEL: Record<CallReply, MessageKey> = {
  none: "conversation.label.call-reply-none",
  result: "conversation.label.call-reply-result",
  conversation: "conversation.label.call-reply-conversation",
};

const FAIL_DETAIL: Record<CallFailReason, MessageKey> = {
  not_found: "conversation.notice.call-fail-not-found",
  closed: "conversation.notice.call-fail-closed",
  receiver_ended: "conversation.notice.call-fail-receiver-ended",
  lophn_restarted: "conversation.notice.call-fail-lophn-restarted",
};

/** 상태 하나를 사람이 읽는 말로. */
function statusText(
  call: Pick<CallView, "to" | "reply">,
  status: CallStatus,
): {
  tone: "good" | "neutral" | "critical";
  label: string;
  detail: string;
} {
  const { to, reply } = call;
  switch (status.state) {
    case "accepted":
      return reply === "conversation"
        ? {
          tone: "neutral",
          label: t("conversation.label.call-working-together"),
          detail: t("conversation.notice.call-working-together", { to }),
        }
        : {
          tone: "neutral",
          label: t("conversation.label.call-in-progress"),
          detail: t("conversation.notice.call-waiting", { to }),
        };
    case "done":
      return reply === "none"
        ? {
          tone: "good",
          label: t("conversation.label.call-delivered"),
          detail: t("conversation.notice.call-delivered"),
        }
        : {
          tone: "good",
          label: t("conversation.label.call-answered"),
          detail: t("conversation.notice.call-answered"),
        };
    case "failed":
      return {
        tone: "critical",
        label: t("conversation.label.call-failed"),
        detail: t(FAIL_DETAIL[status.reason ?? "receiver_ended"]),
      };
    case "cancelled":
      return {
        tone: "neutral",
        label: t("conversation.label.call-cancelled"),
        detail: t("conversation.notice.call-cancelled"),
      };
  }
}

interface CallBlockProps {
  call: CallView;
  source: Pick<AgentTabSource, "callState" | "cancelCall">;
  /** 받은 session을 연다. 없는 창은 단추를 두지 않는다. */
  onOpenSession?: ((session: string) => void) | undefined;
  defaultOpen?: boolean;
}

export function CallBlock(
  { call, source, onOpenSession, defaultOpen = false }: CallBlockProps,
): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  // thread를 읽은 때의 상태에서 시작하고, 열 때와 취소한 뒤에 다시 읽는다.
  const [status, setStatus] = useState<CallStatus>(call.status);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  const read = async () => {
    const result = await source.callState(call.call);
    setFailed(!result.ok);
    if (result.ok) setStatus(result.value);
  };
  const toggle = () => {
    if (!open) void read();
    setOpen(!open);
  };
  const cancel = async () => {
    setCancelling(true);
    const result = await source.cancelCall(call.call);
    setCancelFailed(!result.ok);
    // 이미 끝난 call이라 취소가 거절된 때도 지금 상태를 읽어 맞춘다.
    await read();
    setCancelling(false);
  };

  const text = statusText(call, status);
  return (
    <div
      className={styles.call}
      data-call={call.call}
      data-state={status.state}
    >
      <div className={styles.callHead}>
        <button
          type="button"
          className={styles.callToggle}
          aria-expanded={open}
          onClick={toggle}
        >
          <Icon
            icon={open ? commonIcons.collapse : commonIcons.expand}
            pixels={iconPixels("small")}
          />
          <span className={styles.callTo}>
            {t("conversation.title.call-handed", { to: call.to })}
          </span>
          <span className={styles.callMode}>
            {t(REPLY_LABEL[call.reply])}
          </span>
        </button>
        {call.session !== null && onOpenSession !== undefined
          ? (
            <Button
              size="sm"
              variant="ghost"
              data-call-open=""
              onClick={() => onOpenSession(call.session!)}
            >
              {t("conversation.button.call-open")}
            </Button>
          )
          : null}
        {status.state === "accepted"
          ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {t("conversation.button.call-cancel")}
            </Button>
          )
          : null}
      </div>
      <p className={styles.callTask}>{call.task}</p>
      {cancelFailed && status.state === "accepted"
        ? (
          <p className={styles.callAsOf}>
            {t("conversation.notice.call-cancel-failed")}
          </p>
        )
        : null}
      {open
        ? (
          <div className={styles.callStatus} data-call-status="">
            <StatusMark tone={text.tone} label={text.label} />
            <p className={styles.callDetail}>{text.detail}</p>
            <p className={styles.callAsOf}>
              {t(
                failed
                  ? "conversation.notice.call-unreadable"
                  : "conversation.notice.call-as-of",
              )}
            </p>
          </div>
        )
        : null}
    </div>
  );
}
