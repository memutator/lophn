// 보낸 session의 call 블록. 머리 줄은 받는 곳을 답 방식에 맞는 말로 보이고, 그 아래 맡긴 글 한 줄, 실패했으면 그 이유다.
// 상태는 thread를 읽은 때의 것이다. 답과 늦게 안 실패는 이 블록이 아니라 이어지는 새 메시지(ReceivedMessage)로 보인다.
// [Open conversation]은 받은 session을 연다. 답 없이 맡긴 일(handoff)은 사람이 거기서 이어 가야 하기 때문이다.
// 끝나지 않은 call은 [Cancel]로 사람이 취소한다.
// 다른 컴퓨터로 보낸 call은 받는 곳 뒤에 그 컴퓨터 이름이 붙고, 끝나기 전에는 배달 상태 한 줄이 보인다. 그 call의
// `StateChanged{agent_calls}`를 받으면 상태를 다시 읽고, [Open conversation]은 그 컴퓨터가 받은 session을 안 뒤에만 선다.
import { type ReactElement, useCallback, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { type MessageKey, t } from "@lophn/i18n";

import type { TransferAttachment } from "../../../../protocol/lophn-agent/calls.ts";
import { actionIcons, conversationIcons } from "../../icons/mod.ts";
import { useStateChanged } from "../../desktop/connection/core-read.ts";
import type {
  AgentTabSource,
  CallFailReason,
  CallReply,
  CallStatus,
  CallView,
  MailDelivery,
} from "../agent-tab-source.ts";
import { ToolStateMark } from "../activity/tool-state-mark.tsx";
import styles from "./thread.module.css";

function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  expired: "conversation.notice.call-fail-expired",
  skipped: "conversation.notice.call-fail-skipped",
  old_version: "conversation.notice.call-fail-old-version",
};

const DELIVERY: Record<MailDelivery, MessageKey> = {
  pending: "conversation.notice.call-delivery-pending",
  held: "conversation.notice.call-delivery-held",
  running: "conversation.notice.call-delivery-running",
  unknown: "conversation.notice.call-delivery-unknown",
};

interface CallBlockProps {
  call: CallView & { readonly attachments?: readonly TransferAttachment[] };
  attachments?: readonly TransferAttachment[];
  source: Pick<AgentTabSource, "callState" | "cancelCall">;
  /** 받은 session을 연다. machine은 다른 컴퓨터로 보낸 call의 그 컴퓨터다. 없는 창은 단추를 두지 않는다. */
  onOpenSession?:
    | ((session: string, machine: string | null) => void)
    | undefined;
}

export function CallBlock({
  call,
  attachments: propAttachments,
  source,
  onOpenSession,
}: CallBlockProps): ReactElement {
  // thread를 읽은 때의 상태에서 시작하고, 취소한 뒤에 다시 읽는다. call이 생기기 전이면 상태가 없다.
  const [status, setStatus] = useState<CallStatus | null>(call.status);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  const remote = status?.remote ?? null;
  // 다른 컴퓨터로 보낸 call은 끝날 때까지 상태가 밖에서 바뀐다(닿음, 대기 목록, 받아 돎).
  const following =
    call.call !== null && remote !== null && status?.state === "accepted";
  const reread = useCallback(() => {
    if (!following || call.call === null) return;
    void source.callState(call.call).then((read) => {
      if (read.ok) setStatus(read.value);
    });
  }, [following, call.call, source]);
  useStateChanged(
    following ? [{ name: "agent_calls", id: call.call }] : [],
    reread,
  );

  const cancel = async () => {
    if (call.call === null) return;
    setCancelling(true);
    const result = await source.cancelCall(call.call);
    setCancelFailed(!result.ok);
    // 이미 끝난 call이라 취소가 거절된 때도 지금 상태를 읽어 맞춘다.
    const read = await source.callState(call.call);
    if (read.ok) setStatus(read.value);
    setCancelling(false);
  };

  const failed = status?.state === "failed";
  // call이 생기기 전에 tool call이 실패했거나 거절·취소됐으면 그 표시를 붙인다.
  const unsent = status === null && call.toolState !== "running";
  const sessionToOpen = remote === null ? call.session : remote.session;
  const attachments = propAttachments ?? call.attachments ?? [];
  const attachmentState = failed
    ? t("settings-sync.state.transfer-failed")
    : remote?.delivery === "pending"
      ? t("settings-sync.state.transfer-queued")
      : remote?.delivery === "held"
        ? t("settings-sync.state.transfer-held-generic")
        : status?.state === "done" || remote?.delivery === "running"
          ? t("settings-sync.state.transfer-delivered")
          : null;
  return (
    <div
      className={styles.call}
      data-call={call.call ?? ""}
      data-state={status?.state ?? call.toolState}
    >
      <div className={styles.callHead}>
        <span className={styles.callTitle}>
          <span className={styles.callTo}>
            {t(TITLE[call.reply], { to: call.to })}
          </span>
          {remote !== null && !call.to.endsWith(` on ${remote.computer}`) ? (
            <span className={styles.callComputer} data-call-computer="">
              {remote.computer}
            </span>
          ) : null}
          {failed ? (
            <StatusMark
              tone="critical"
              label={t("conversation.label.call-failed")}
            />
          ) : null}
          {unsent ? <ToolStateMark state={call.toolState} /> : null}
        </span>
        {/* [Open conversation]이 늘 오른쪽 끝에 오도록 있다 없다 하는 [Cancel]을 앞에 둔다. */}
        <span className={styles.callActions}>
          {status?.state === "accepted" ? (
            <Button
              size="sm"
              variant="ghost"
              icon={actionIcons.stop}
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {t("conversation.button.call-cancel")}
            </Button>
          ) : null}
          {sessionToOpen !== null && onOpenSession !== undefined && !failed ? (
            <Button
              size="sm"
              trailingIcon={conversationIcons.openSession}
              data-call-open=""
              onClick={() =>
                onOpenSession(
                  sessionToOpen,
                  remote === null ? null : remote.machine,
                )
              }
            >
              {t("conversation.button.call-open")}
            </Button>
          ) : null}
        </span>
      </div>
      <p className={styles.callTask}>{call.task}</p>
      {attachments.length === 0 ? null : (
        <ul className={styles.refList} data-call-attachments="">
          {attachments.map((att) => (
            <li
              key={`${att.transfer}:${att.rel_path ?? att.name}`}
              className={styles.refRow}
              data-call-attachment={att.transfer}
            >
              <span className={styles.callComputer}>
                {`${att.name} (${formatAttachmentBytes(att.size)})`}
              </span>
              <span className={styles.callNote}>
                {t("settings-sync.label.attachment-inbox", {
                  transfer: att.transfer,
                  path: att.rel_path ?? att.name,
                })}
                {attachmentState === null ? "" : ` · ${attachmentState}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {remote?.delivery != null && status?.state === "accepted" ? (
        <p className={styles.callNote} data-call-delivery={remote.delivery}>
          {t(DELIVERY[remote.delivery], { computer: remote.computer })}
        </p>
      ) : null}
      {failed ? (
        <p className={styles.callNote}>
          {t(FAIL_DETAIL[status?.reason ?? "receiver_ended"])}
        </p>
      ) : null}
      {cancelFailed && status?.state === "accepted" ? (
        <p className={styles.callNote}>
          {t("conversation.notice.call-cancel-failed")}
        </p>
      ) : null}
    </div>
  );
}
