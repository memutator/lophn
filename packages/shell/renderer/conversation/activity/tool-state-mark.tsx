import type { ReactElement } from "react";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import type { ToolCallState } from "./model.ts";

// 실패·거절·취소한 tool call의 표시. 도는 중과 성공은 표시가 없다. 색은 허락 결과 줄(approval-card)과 같다.
export function ToolStateMark({
  state,
}: {
  state: ToolCallState;
}): ReactElement | null {
  switch (state) {
    case "error":
      return (
        <StatusMark
          tone="critical"
          label={t("conversation.label.tool-call-failed")}
        />
      );
    case "denied":
      return (
        <StatusMark
          tone="critical"
          label={t("conversation.label.tool-call-denied")}
        />
      );
    case "cancelled":
      return (
        <StatusMark
          tone="neutral"
          label={t("conversation.label.tool-call-cancelled")}
        />
      );
    default:
      return null;
  }
}
