// 대기 목록 panel 틀(waiting-panel.tsx의 머리와 묶음 마크업, waiting.module.css). 실제 WaitingLayer는 job hold 종류를 모르고
// 실제 permission·activation 카드는 그대로 놓는다. job hold는 셋째 묶음 "Scheduled jobs"에 놓인다.
// `sj-shell-hold-card`가 이 틀을 쓰지 않고 WaitingPanel의 GROUPS와 card switch에 job hold를 더한다.
import { type ReactNode, useState } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";

import { ActivationCard } from "../../../../packages/shell/renderer/desktop/connection/waiting/cards/activation-card.tsx";
import { PermissionCard } from "../../../../packages/shell/renderer/desktop/connection/waiting/cards/permission-card.tsx";
import { cardOf } from "../../../../packages/shell/renderer/desktop/connection/waiting/model.ts";
import { useWaiting } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { notificationsIcon } from "../../../../packages/shell/renderer/icons/mod.ts";
import styles from "../../../../packages/shell/renderer/desktop/connection/waiting/waiting.module.css";
import type { JobHoldView } from "../../mock/jobs-hold-data.ts";
import { HoldCard, type HoldChoice, type HoldFailure } from "./hold-card.tsx";

const decided = () => Promise.resolve(true);

function Group(
  { title, count, children }: {
    title: string;
    count: number;
    children: ReactNode;
  },
) {
  return (
    <section className={styles.group} aria-label={title}>
      <div className={styles.groupHead}>
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

function Panel(
  { holds, onDecide }: {
    holds: readonly JobHoldView[];
    onDecide: (hold: JobHoldView, choice: HoldChoice) => Promise<HoldFailure>;
  },
) {
  const { entries } = useWaiting();
  const permissions = entries.filter((entry) => entry.kind === "permission");
  const activations = entries.filter((entry) => entry.kind === "activation");
  return (
    <section className={styles.panel} aria-label={t("waiting.label.panel")}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("waiting.label.panel")}</h2>
        <span className={styles.panelSub}>
          {t("waiting.label.panel-scope")}
        </span>
      </header>
      <div className={styles.panelBody}>
        {permissions.length === 0 ? null : (
          <Group
            title={t("waiting.label.group-permission")}
            count={permissions.length}
          >
            {permissions.map((entry) => (
              <PermissionCard
                key={entry.id}
                entry={entry}
                view={cardOf(entry)}
                onDecide={decided}
              />
            ))}
          </Group>
        )}
        {activations.length === 0 ? null : (
          <Group
            title={t("waiting.label.group-activation")}
            count={activations.length}
          >
            {activations.map((entry) => (
              <ActivationCard
                key={entry.id}
                entry={entry}
                view={cardOf(entry)}
                onDecide={decided}
              />
            ))}
          </Group>
        )}
        {holds.length === 0
          ? null
          : (
            <Group title="Scheduled jobs" count={holds.length}>
              {holds.map((hold) => (
                <HoldCard
                  key={hold.job_run.id}
                  hold={hold}
                  onDecide={(choice) => onDecide(hold, choice)}
                />
              ))}
            </Group>
          )}
      </div>
    </section>
  );
}

/** 위쪽 바의 알림 단추와 그 아래로 열려 있는 panel. */
export function HoldLayer(
  { holds, conflicts = [] }: {
    holds: readonly JobHoldView[];
    /** 앞 차례가 아직 돌아 [Start now]가 conflict로 막히는 job id. */
    conflicts?: readonly string[];
  },
) {
  const [rest, setRest] = useState(holds);
  const { count } = useWaiting();
  // 접수되면 JobChanged 뒤 목록을 다시 읽어 card가 빠진다.
  function onDecide(
    hold: JobHoldView,
    choice: HoldChoice,
  ): Promise<HoldFailure> {
    if (choice === "run_now" && conflicts.includes(hold.job.id)) {
      return Promise.resolve("conflict");
    }
    setRest((now) => now.filter((one) => one !== hold));
    return Promise.resolve(null);
  }
  return (
    <div className={styles.layer}>
      <IconButton
        icon={notificationsIcon}
        label={t("waiting.label.trigger", { count: count + rest.length })}
        aria-expanded
      />
      <span className={styles.badge} aria-hidden>{count + rest.length}</span>
      <div className={styles.floating}>
        <Panel holds={rest} onDecide={onDecide} />
      </div>
    </div>
  );
}
