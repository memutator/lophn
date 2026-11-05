// 앱 공유 요청. 앱 workspace의 agent가 이 앱을 다른 agent(와 coding agent)에게 할당해 달라고 청했다.
// 승인하면 그 agent들의 할당에 앱이 더해지고 coding agent를 골랐으면 그쪽에도 공유 skill이 간다. 거절하면 아무것도 바뀌지 않는다.
// 정한 항목은 ShareRequestClosed가 목록에서 뺀다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { decideShare } from "../decide.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type ShareEntry = WaitingEntry & { kind: "share" };

export function ShareCard({
  entry,
  view,
  core,
}: {
  entry: ShareEntry;
  view: CardView;
  core: CoreSource;
}) {
  const [busy, setBusy] = useState(false);
  // not_found·conflict는 먼저 정해졌거나 새 요청이 대신한 것이라 글 없이 다시 읽어 card가 바뀌게 둔다.
  const [failed, setFailed] = useState(false);

  async function decide(choice: "approve" | "reject") {
    setBusy(true);
    const result = await decideShare(core, entry, choice);
    setFailed(
      !result.ok && result.code !== "not_found" && result.code !== "conflict",
    );
    setBusy(false);
  }

  return (
    <article className={styles.request} data-share-request={entry.id}>
      <Head view={view} agent={entry.agent} />
      {entry.request.reason === "" ? null : (
        <div className={styles.reason}>
          <p className={styles.desc}>{entry.request.reason}</p>
        </div>
      )}
      {failed ? (
        <p className={styles.error}>{t("waiting.notice.decide-failed")}</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy}
          data-reject-share=""
          onClick={() => decide("reject")}
        >
          {t("waiting.button.reject-share")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          data-approve-share=""
          onClick={() => decide("approve")}
        >
          {t("waiting.button.approve-share")}
        </Button>
      </div>
    </article>
  );
}
