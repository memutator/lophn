// 대화 안 오류 메시지. provider가 요청을 거절하는 등 server 요청이 실패하면 어떤 오류인지와 [Retry]가 대화에 남는다.
// turn이 끝난 이유는 `turn-failure.ts`가 사람의 말로 옮긴다.
import { type ReactElement, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { actionIcons } from "../../icons/mod.ts";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import type { AgentTabSource } from "../agent-tab-source.ts";
import type { ProviderKeyFix } from "./provider-key.ts";
import { failedText } from "./turn-failure.ts";
import styles from "./thread.module.css";

interface ProviderErrorProps {
  /** 실패한 turn. [Retry]가 그 turn의 입력을 같은 session에 다시 보낸다. */
  turn: string;
  /** turn이 끝난 이유나 provider 오류 code. */
  code: string;
  /** 어떤 오류인지. core가 준 글이고, code가 turn이 끝난 이유면 쓰지 않는다. */
  message: string;
  /** provider 호출이 실패했을 때 판정 길과 request id. 원인 갈래를 DB 없이 알게 한다. */
  evidence?: {
    verdict_path: string | null;
    request_id: string | null;
    http_status?: number | null;
  };
  source: Pick<AgentTabSource, "retryTurn">;
  /** `capabilities.retry`. 꺼져 있으면 [Retry]가 없다. 기본은 true다. */
  canRetry?: boolean;
  /** provider key가 없거나 안 맞아 멈췄을 때(`configuration_unavailable`)의 [Enter key]. 없으면 단추가 없다. */
  providerKey?: ProviderKeyFix | undefined;
}

export function ProviderError({
  turn,
  code,
  message,
  evidence,
  source,
  canRetry = true,
  providerKey,
}: ProviderErrorProps): ReactElement {
  const detail = failedText(code, evidence?.http_status, message);
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
        {evidence?.verdict_path != null ? (
          <p className={styles.errorDetail}>
            {t("conversation.error.verdict-path", {
              path: evidence.verdict_path,
            })}
          </p>
        ) : null}
        {evidence?.request_id != null ? (
          <p className={styles.errorDetail}>
            {t("conversation.error.request-id", { id: evidence.request_id })}
          </p>
        ) : null}
        {state === "failed" ? (
          <p className={styles.errorDetail}>
            {t("conversation.notice.retry-failed")}
          </p>
        ) : null}
      </div>
      {code === "configuration_unavailable" && providerKey !== undefined ? (
        <Button
          size="sm"
          icon={
            providerKey.name === null ? actionIcons.open : actionIcons.connect
          }
          onClick={providerKey.run}
        >
          {providerKey.name === null
            ? t("conversation.button.provider-key-open")
            : t("conversation.button.provider-key", {
                name: providerKey.name,
              })}
        </Button>
      ) : null}
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
