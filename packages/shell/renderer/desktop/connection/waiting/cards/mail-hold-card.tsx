// 늦게 닿은 다른 컴퓨터의 mail. [Start now]면 받을 agent가 돌고 [Skip]이면 보낸 쪽 call이 skipped로 닫힌다.
// 정한 항목은 `mail_holds` 변경 뒤 목록을 다시 읽을 때 빠진다. 이미 정했거나 만료됐으면 글을 두고 단추를 막는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../../icons/mod.ts";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { decideMailHold } from "../decide.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type MailHoldEntry = WaitingEntry & { kind: "mail_hold" };

export function MailHoldCard({
  entry,
  view,
  core,
}: {
  entry: MailHoldEntry;
  view: CardView;
  core: CoreSource;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"handled" | "failed" | null>(null);

  async function decide(choice: "run_now" | "skip") {
    setBusy(true);
    const result = await decideMailHold(core, entry, choice);
    setFailure(
      result.ok
        ? null
        : result.code === "conflict" || result.code === "not_found"
          ? "handled"
          : "failed",
    );
    setBusy(false);
  }

  const handled = failure === "handled";
  return (
    <article className={styles.request} data-mail-hold={entry.id}>
      <Head view={view} agent={entry.agent} />
      <div className={styles.reason}>
        <span className={styles.meta}>{view.times}</span>
      </div>
      {failure === null ? null : (
        <p className={styles.error}>
          {t(
            handled
              ? "waiting.notice.mail-conflict"
              : "waiting.notice.decide-failed",
          )}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy || handled}
          data-skip=""
          onClick={() => decide("skip")}
        >
          {t("waiting.button.skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={actionIcons.run}
          disabled={busy || handled}
          data-start-now=""
          onClick={() => decide("run_now")}
        >
          {t("waiting.button.start-now")}
        </Button>
      </div>
    </article>
  );
}
