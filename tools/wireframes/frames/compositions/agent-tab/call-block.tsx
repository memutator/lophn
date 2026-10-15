// 보낸 session의 call 블록. 일반 tool 한 줄 대신 받는 곳, 맡긴 글 한 줄, 답 방식을 보인다. 누르면 그때의 상태를 읽어
// 보이고, 상태가 바뀌어도 따로 알리지 않는다. 끝나지 않은 call은 머리 줄 오른쪽 [Cancel]로 사람이 취소한다.
// 답과 실패는 이 블록 안이 아니라 이어지는 새 메시지(ReceivedMessage)로 보인다.
import { useState } from "react";
import { Button, Icon, iconPixels, StatusMark } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import {
  type CallState,
  type CallView,
  type FailReason,
  REPLY_TEXT,
} from "./data.ts";
import t from "./agent-tab.module.css";

const FAIL_TEXT: Record<FailReason, string> = {
  receiver_ended: "The other session ended before it answered.",
  closed: "That session is closed.",
  not_allowed: "This agent is not allowed to hand work to that agent.",
};

/** 상태 하나를 사람이 읽는 말로. */
function statusOf(call: CallView): {
  tone: "good" | "neutral" | "critical";
  label: string;
  detail: string;
} {
  switch (call.state) {
    case "accepted":
      return {
        tone: "neutral",
        label: call.reply === "conversation"
          ? "Working together"
          : "In progress",
        detail: call.reply === "conversation"
          ? `${call.to} is working on it. Messages go back and forth until it reports.`
          : `Waiting for the answer from ${call.to}.`,
      };
    case "done":
      return {
        tone: "good",
        label: call.reply === "none" ? "Delivered" : "Answered",
        detail: call.reply === "none"
          ? "The task reached the session. No answer was asked for."
          : "The answer is in the messages below.",
      };
    case "failed":
      return {
        tone: "critical",
        label: "Failed",
        detail: FAIL_TEXT[call.reason ?? "receiver_ended"],
      };
    case "cancelled":
      return {
        tone: "neutral",
        label: "Cancelled",
        detail: "It was cancelled before it finished.",
      };
  }
}

export function CallBlock(
  { call, defaultOpen = false }: { call: CallView; defaultOpen?: boolean },
) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<CallState>(call.state);
  const view = { ...call, state };
  const status = statusOf(view);
  return (
    <div className={t.call} data-state={state}>
      <div className={t.callHead}>
        <button
          type="button"
          className={t.callToggle}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon
            icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
            pixels={iconPixels("small")}
          />
          <span className={t.callTo}>Handed to {call.to}</span>
          <span className={t.callMode}>{REPLY_TEXT[call.reply]}</span>
        </button>
        {state === "accepted"
          ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState("cancelled")}
            >
              Cancel
            </Button>
          )
          : null}
      </div>
      <p className={t.callTask}>{call.task}</p>
      {open
        ? (
          <div className={t.callStatus}>
            <StatusMark tone={status.tone} label={status.label} />
            <p className={t.callDetail}>{status.detail}</p>
            <p className={t.callAsOf}>
              Read when you opened this. Later changes are not announced.
            </p>
          </div>
        )
        : null}
    </div>
  );
}
