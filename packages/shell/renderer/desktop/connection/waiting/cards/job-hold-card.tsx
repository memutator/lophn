// job이 놓친 차례. [Start now]나 [Skip]으로 정한다. 정한 항목은 JobChanged 뒤 목록을 다시 읽을 때 빠진다.
// 앞 차례가 아직 돌면 [Start now]가 conflict로 막히고 card는 남는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { decideJobHold } from "../decide.ts";
import { type CardView, jobHoldNote } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type JobHoldEntry = WaitingEntry & { kind: "job_hold" };

export function JobHoldCard({
  entry,
  view,
  core,
}: {
  entry: JobHoldEntry;
  view: CardView;
  core: CoreSource;
}) {
  const [busy, setBusy] = useState(false);
  // not_found는 먼저 지워진 것이라 글 없이 다시 읽어 card가 빠지게 둔다.
  const [failure, setFailure] = useState<"conflict" | "failed" | null>(null);

  async function decide(choice: "run_now" | "skip") {
    setBusy(true);
    const result = await decideJobHold(core, entry, choice);
    setFailure(
      result.ok || result.code === "not_found"
        ? null
        : result.code === "conflict"
          ? "conflict"
          : "failed",
    );
    setBusy(false);
  }

  return (
    <article className={styles.request} data-job-hold={entry.id}>
      <Head view={view} agent={entry.agent} />
      <div className={styles.reason}>
        <p className={styles.desc}>{jobHoldNote(entry.hold)}</p>
      </div>
      {failure === null ? null : (
        <p className={styles.error}>
          {t(
            failure === "conflict"
              ? "waiting.notice.job-conflict"
              : "waiting.notice.decide-failed",
          )}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          data-skip=""
          onClick={() => decide("skip")}
        >
          {t("waiting.button.skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          data-start-now=""
          onClick={() => decide("run_now")}
        >
          {t("waiting.button.start-now")}
        </Button>
      </div>
    </article>
  );
}
