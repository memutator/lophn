// 대화 안 오류 메시지. provider가 요청을 거절하는 등 server 요청이 실패하면 어떤 오류인지와 [Retry]가 대화에 남는다.
import { type ReactElement, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import type { AgentTabSource } from "../agent-tab-source.ts";
import styles from "./thread.module.css";

interface ProviderErrorProps {
  /** 실패한 turn. [Retry]가 그 turn의 입력을 같은 session에 다시 보낸다. */
  turn: string;
  /** 어떤 오류인지. core가 준 글이다. */
  message: string;
  source: Pick<AgentTabSource, "retryTurn">;
}

export function ProviderError({
  turn,
  message,
  source,
}: ProviderErrorProps): ReactElement {
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
        <p className={styles.errorDetail}>{message}</p>
        {state === "failed" ? (
          <p className={styles.errorDetail}>
            {t("conversation.notice.retry-failed")}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        disabled={state === "sending"}
        onClick={() => void retry()}
      >
        {t("conversation.button.retry")}
      </Button>
    </div>
  );
}
