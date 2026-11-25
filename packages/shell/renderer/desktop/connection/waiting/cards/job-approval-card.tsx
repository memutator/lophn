// agent가 만든 job의 등록 승인. 한 번 승인하면 그 job은 정한 주기로 사람 없이 돈다. [Reject]는 job을 지운다.
// 정한 항목은 `jobs` 변경 뒤 목록을 다시 읽을 때 빠진다.

import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useState } from "react";
import type { PermissionMode } from "../../../../../../protocol/lophn-agent/turn-values.ts";
import { useMachineNameOf } from "../../../jobs/machine-names.ts";
import { intervalText, scheduleText } from "../../../jobs/model.ts";
import { useMachinesView } from "../../../machines/context.tsx";
import { useMachineHub } from "../../../machines/scope.tsx";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { decideJobApproval } from "../decide.ts";
import type { CardView } from "../model.ts";
import { useInboxNamesOf } from "../names.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type JobApprovalEntry = WaitingEntry & { kind: "job_approval" };

// 다른 컴퓨터의 앱 event job은 trigger.source에 그 컴퓨터의 앱 id(`app_…`)가 들어 있다.
// 창의 목록(`InboxNamesProvider`)이 이미 읽은 앱 이름을 먼저 쓰고, 없으면(Settings의 대기 panel 등)
// 연결된 그 기계의 core에서 읽어 보인다. 꺼져 있거나 앱이 지워졌으면 id로 돌아간다.
function useRemoteTriggerAppName(
  sourceMachine: string | undefined,
  sourceApp: string | undefined,
): string | undefined {
  const namesOf = useInboxNamesOf();
  const machinesView = useMachinesView();
  const hub = useMachineHub();
  const targetMachine =
    sourceMachine === undefined
      ? undefined
      : machinesView?.thisComputer?.id === sourceMachine
        ? null
        : sourceMachine;
  const known =
    targetMachine === undefined || sourceApp === undefined
      ? undefined
      : namesOf(targetMachine).apps.get(sourceApp);
  const reachable =
    targetMachine !== undefined &&
    (targetMachine === null ||
      machinesView === null ||
      machinesView.machines.some(
        (one) => one.id === targetMachine && one.status === "connected",
      ));
  const lookupKey =
    sourceMachine !== undefined && sourceApp !== undefined
      ? `${sourceMachine}\0${sourceApp}`
      : null;
  const [fetched, setFetched] = useState<{
    readonly key: string;
    readonly name: string;
  } | null>(null);

  useEffect(() => {
    if (
      known !== undefined ||
      lookupKey === null ||
      targetMachine === undefined ||
      sourceApp === undefined ||
      hub === null ||
      !reachable
    ) {
      return;
    }
    let live = true;
    let apps: ReturnType<typeof hub.get>["apps"];
    try {
      apps = hub.get(targetMachine).apps;
    } catch {
      return;
    }
    void apps
      .get(sourceApp)
      .then((result) => {
        if (live && result.ok && result.value !== null) {
          setFetched({ key: lookupKey, name: result.value.name });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [known, lookupKey, targetMachine, sourceApp, hub, reachable]);

  if (known !== undefined) return known;
  return fetched?.key === lookupKey ? fetched.name : undefined;
}

export function JobApprovalCard({
  entry,
  view,
  core,
}: {
  entry: JobApprovalEntry;
  view: CardView;
  core: CoreSource;
}) {
  const machineNameOf = useMachineNameOf();
  const trigger = entry.job.trigger;
  const remoteAppName = useRemoteTriggerAppName(
    trigger?.source_machine,
    trigger?.source_machine === undefined
      ? undefined
      : (trigger.app ?? trigger.source),
  );
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

  const modeEntries = Object.entries(entry.job.participant_modes ?? {}) as [
    string,
    PermissionMode,
  ][];
  const modeEscalated = entry.job.approval_paused_reason === "mode_escalated";

  return (
    <article className={styles.request} data-job-approval={entry.id}>
      <Head view={view} agent={entry.agent} />
      <div className={styles.reason}>
        {modeEscalated ? (
          <p className={styles.error} data-mode-escalated="">
            {t("waiting.notice.job-mode-escalated")}
          </p>
        ) : null}
        <p className={styles.desc}>
          {trigger !== null
            ? t(
                trigger.source_machine !== undefined
                  ? "waiting.notice.job-approval-event-on"
                  : trigger.source === "lophn"
                    ? "waiting.notice.job-approval-lophn"
                    : "waiting.notice.job-approval-event",
                {
                  source:
                    trigger.source_machine === undefined
                      ? trigger.source
                      : (remoteAppName ?? trigger.source),
                  event: trigger.event,
                  interval: intervalText(trigger.min_interval),
                  // 사람이 승인하는 것이 다른 컴퓨터의 일이라 그 컴퓨터를 이름으로 말한다(명단에 없으면 기계 id).
                  machine:
                    trigger.source_machine === undefined
                      ? ""
                      : (machineNameOf(trigger.source_machine) ??
                        trigger.source_machine),
                },
              )
            : t("waiting.notice.job-approval", {
                schedule: scheduleText(entry.job.every!, entry.job.at),
              })}
        </p>
        {trigger?.pass_event === true ? (
          <p className={styles.desc} data-pass-event="">
            {t("waiting.notice.job-pass-event")}
          </p>
        ) : null}
      </div>
      {modeEntries.length > 0 ? (
        <dl className={styles.facts} data-job-modes="">
          <dt>{t("waiting.label.job-modes")}</dt>
          <dd>
            {modeEntries
              .map(
                ([participant, mode]) =>
                  `${participant}: ${t(`settings.label.mode-${mode}`)}`,
              )
              .join(" · ")}
          </dd>
        </dl>
      ) : null}
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
