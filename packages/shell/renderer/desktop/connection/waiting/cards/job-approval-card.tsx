// agent가 만든 job의 등록 승인. 한 번 승인하면 그 job은 정한 주기로 사람 없이 돈다. [Reject]는 job을 지운다.
// 정한 항목은 JobChanged 뒤 목록을 다시 읽을 때 빠진다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import { scheduleText } from "../../../jobs/model.ts";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { decideJobApproval } from "../decide.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type JobApprovalEntry = WaitingEntry & { kind: "job_approval" };

export function JobApprovalCard({
  entry,
  view,
  core,
}: {
  entry: JobApprovalEntry;
  view: CardView;
  core: CoreSource;
}) {
  const [busy, setBusy] = useState(false);
  // not_found·conflict는 먼저 정해진 것이라 글 없이 다시 읽어 card가 빠지게 둔다.
  const [failed, setFailed] = useState(false);

  async function decide(choice: "approve" | "reject") {
    setBusy(true);
    const result = await decideJobApproval(core, entry, choice);
    setFailed(
      !result.ok && result.code !== "not_found" && result.code !== "conflict",
    );
    setBusy(false);
  }

  return (
    <article className={styles.request} data-job-approval={entry.id}>
      <Head view={view} agent={entry.agent} />
      <div className={styles.reason}>
        <p className={styles.desc}>
          {t("waiting.notice.job-approval", {
            schedule: scheduleText(entry.job.every, entry.job.at),
          })}
        </p>
      </div>
      {failed ? (
        <p className={styles.error}>{t("waiting.notice.decide-failed")}</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          data-reject-job=""
          onClick={() => decide("reject")}
        >
          {t("waiting.button.reject-job")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          data-approve-job=""
          onClick={() => decide("approve")}
        >
          {t("waiting.button.approve-job")}
        </Button>
      </div>
    </article>
  );
}
