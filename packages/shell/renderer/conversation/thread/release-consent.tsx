// release.activate가 사람의 동의를 기다린다고 답한 자리의 카드. 동의 자체는 대기 panel에서 한다.
// 기다리는지는 대기 목록에 그 release 줄이 있는지로 읽는다. 닫힌 뒤 허락인지 거절인지는 알려 하지 않는다.
import type { ReactElement } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { useWaiting } from "../../desktop/connection/events/hooks.tsx";
import { useWaitingPanel } from "../../desktop/connection/waiting/waiting-layer.tsx";
import styles from "./thread.module.css";

export function ReleaseConsent({ release }: { release: string }): ReactElement {
  const { entries } = useWaiting();
  const { setOpen } = useWaitingPanel();
  const waiting = entries.find(
    (entry) => entry.kind === "activation" && entry.id === release,
  );
  return (
    <div
      className={styles.call}
      data-release-consent={release}
      data-state={waiting !== undefined ? "waiting" : "handled"}
    >
      <div className={styles.callHead}>
        <span className={styles.callTitle}>
          <span className={styles.callTo}>
            {waiting?.kind === "activation"
              ? t("conversation.title.consent-waiting", {
                  app: waiting.request.app_name,
                })
              : t("conversation.title.consent-handled")}
          </span>
        </span>
        {waiting !== undefined ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("conversation.button.consent-review")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
