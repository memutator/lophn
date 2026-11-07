// 대화 안 오류 메시지. provider가 요청을 거절하는 등 server 요청이 실패하면 어떤 오류인지와 [Retry]가 대화에 남는다.
// turn이 끝난 이유(code)는 사람의 말로 옮긴다. 원시 이유("configuration unavailable")는 무엇을 하라는지 말하지 못한다.
import { type ReactElement, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { actionIcons } from "../../icons/mod.ts";
import { StatusMark } from "@lophn/ui/feedback";
import { type MessageKey, t } from "@lophn/i18n";

import { TURN_FAILED_REASONS } from "../../../../protocol/lophn-agent/turn-values.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import styles from "./thread.module.css";

interface ProviderErrorProps {
  /** 실패한 turn. [Retry]가 그 turn의 입력을 같은 session에 다시 보낸다. */
  turn: string;
  /** turn이 끝난 이유나 provider 오류 code. */
  code: string;
  /** 어떤 오류인지. core가 준 글이고, code가 turn이 끝난 이유면 쓰지 않는다. */
  message: string;
  source: Pick<AgentTabSource, "retryTurn">;
  /** `capabilities.retry`. 꺼져 있으면 [Retry]가 없다. 기본은 true다. */
  canRetry?: boolean;
}

type FailedReason = (typeof TURN_FAILED_REASONS)[number];

// 이유마다 문구 하나. 이유가 늘면 type이 이 표를 채우게 한다.
const FAILED_TEXT = {
  model_error: "conversation.error.turn-model-error",
  tool_error: "conversation.error.turn-tool-error",
  context_limit: "conversation.error.turn-context-limit",
  model_attempt_limit: "conversation.error.turn-model-attempt-limit",
  stall_limit: "conversation.error.turn-stall-limit",
  active_limit: "conversation.error.turn-active-limit",
  repeated_tool_failure: "conversation.error.turn-repeated-tool-failure",
  effect_unknown: "conversation.error.turn-effect-unknown",
  clock_uncertain: "conversation.error.turn-clock-uncertain",
  configuration_unavailable:
    "conversation.error.turn-configuration-unavailable",
  model_required: "conversation.error.turn-model-required",
  target_unavailable: "conversation.error.turn-target-unavailable",
  no_answer: "conversation.error.turn-no-answer",
  internal: "conversation.error.turn-internal",
} as const satisfies Record<FailedReason, MessageKey>;

export function ProviderError({
  turn,
  code,
  message,
  source,
  canRetry = true,
}: ProviderErrorProps): ReactElement {
  const detail =
    code in FAILED_TEXT ? t(FAILED_TEXT[code as FailedReason]) : message;
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const retry = async () => {
    setState("sending");
    const result = await source.retryTurn(turn);
    setState(result.ok ? "idle" : "failed");
  };
  return (
    <div className={styles.error} role="alert" data-provider-error={turn}>
      <div className={styles.errorText}>
        <StatusMark
          tone="critical"
          label={t("conversation.notice.request-failed")}
        />
        <p className={styles.errorDetail}>{detail}</p>
        {state === "failed" ? (
          <p className={styles.errorDetail}>
            {t("conversation.notice.retry-failed")}
          </p>
        ) : null}
      </div>
      {canRetry ? (
        <Button
          size="sm"
          icon={actionIcons.retry}
          disabled={state === "sending"}
          onClick={() => void retry()}
        >
          {t("conversation.button.retry")}
        </Button>
      ) : null}
    </div>
  );
}
