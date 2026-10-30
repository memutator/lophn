// 보낸 session의 call 블록. 머리 줄은 받는 곳을 답 방식에 맞는 말로 보이고, 그 아래 맡긴 글 한 줄, 실패했으면 그 이유다.
// 상태는 thread를 읽은 때의 것이다. 답과 늦게 안 실패는 이 블록이 아니라 이어지는 새 메시지(ReceivedMessage)로 보인다.
// [Open conversation]은 받은 session을 연다. 답 없이 맡긴 일(handoff)은 사람이 거기서 이어 가야 하기 때문이다.
// 끝나지 않은 call은 [Cancel]로 사람이 취소한다.
import { type ReactElement, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { type MessageKey, t } from "@lophn/i18n";

import { conversationIcons } from "../../icons/mod.ts";
import type {
  AgentTabSource,
  CallFailReason,
  CallReply,
  CallStatus,
  CallView,
} from "../agent-tab-source.ts";
import styles from "./thread.module.css";

const TITLE = {
  none: "conversation.title.call-handoff",
  result: "conversation.title.call-asked",
  conversation: "conversation.title.call-working-with",
} as const satisfies Record<CallReply, MessageKey>;

const FAIL_DETAIL: Record<CallFailReason, MessageKey> = {
  not_found: "conversation.notice.call-fail-not-found",
  closed: "conversation.notice.call-fail-closed",
  receiver_ended: "conversation.notice.call-fail-receiver-ended",
  lophn_restarted: "conversation.notice.call-fail-lophn-restarted",
};

interface CallBlockProps {
  call: CallView;
  source: Pick<AgentTabSource, "callState" | "cancelCall">;
  /** 받은 session을 연다. 없는 창은 단추를 두지 않는다. */
  onOpenSession?: ((session: string) => void) | undefined;
}

export function CallBlock({
  call,
  source,
  onOpenSession,
}: CallBlockProps): ReactElement {
  // thread를 읽은 때의 상태에서 시작하고, 취소한 뒤에 다시 읽는다.
  const [status, setStatus] = useState<CallStatus>(call.status);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    const result = await source.cancelCall(call.call);
    setCancelFailed(!result.ok);
    // 이미 끝난 call이라 취소가 거절된 때도 지금 상태를 읽어 맞춘다.
    const read = await source.callState(call.call);
    if (read.ok) setStatus(read.value);
    setCancelling(false);
  };

  const failed = status.state === "failed";
  return (
    <div
      className={styles.call}
      data-call={call.call}
      data-state={status.state}
    >
      <div className={styles.callHead}>
        <span className={styles.callTitle}>
          <span className={styles.callTo}>
            {t(TITLE[call.reply], { to: call.to })}
          </span>
          {failed ? (
            <StatusMark
              tone="critical"
              label={t("conversation.label.call-failed")}
            />
          ) : null}
        </span>
        {/* [Open conversation]이 늘 오른쪽 끝에 오도록 있다 없다 하는 [Cancel]을 앞에 둔다. */}
        <span className={styles.callActions}>
          {status.state === "accepted" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {t("conversation.button.call-cancel")}
            </Button>
          ) : null}
          {call.session !== null && onOpenSession !== undefined && !failed ? (
            <Button
              size="sm"
              trailingIcon={conversationIcons.openSession}
              data-call-open=""
              onClick={() => onOpenSession(call.session!)}
            >
              {t("conversation.button.call-open")}
            </Button>
          ) : null}
        </span>
      </div>
      <p className={styles.callTask}>{call.task}</p>
      {failed ? (
        <p className={styles.callNote}>
          {t(FAIL_DETAIL[status.reason ?? "receiver_ended"])}
        </p>
      ) : null}
      {cancelFailed && status.state === "accepted" ? (
        <p className={styles.callNote}>
          {t("conversation.notice.call-cancel-failed")}
        </p>
      ) : null}
    </div>
  );
}
