// 다른 기계 창이 아직 한 번도 붙지 않았거나 그 기계가 내 기기 명단에서 빠졌을 때 창 전체 자리에 서는 화면. 한 번 붙은 뒤의 끊김은
// 마지막 화면 위의 한 줄(ConnectionNotice)이라 여기서 그리지 않는다. 꺼진 기계와 판이 맞지 않는 기계(어느 쪽 lophn을 올릴지
// 말한다)는 창을 막지 않고 이 컴퓨터로 가는 길을 준다.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Shimmer } from "@lophn/ui/feedback";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../icons/mod.ts";
import type { ConnectionState } from "../connection/connection.ts";
import { useMachines, useMachinesView } from "./context.tsx";
import styles from "./machine-gate.module.css";
import type { MachineItem } from "./source.ts";

export function MachineGate({
  machine,
  connection,
  onRetry,
}: {
  machine: MachineItem;
  /** 이 창의 core 연결. 기계 목록이 마지막으로 본 때를 모르면 마지막으로 확인한 때를 쓴다. */
  connection: ConnectionState;
  onRetry: () => void;
}) {
  const source = useMachines();
  const view = useMachinesView();
  const thisComputer = view?.thisComputer ?? null;
  const seen =
    machine.lastSeenAt ??
    (connection.confirmedAt === null
      ? null
      : new Date(connection.confirmedAt).toISOString());
  const thisButton =
    source === null || thisComputer === null ? null : (
      <Button
        variant="primary"
        icon={actionIcons.open}
        data-machine-open-this=""
        onClick={() => void source.open(thisComputer.id)}
      >
        {t("machines.button.this-computer")}
      </Button>
    );
  const name = machine.name;

  return (
    <div className={styles.gate} data-machine-gate={machine.status}>
      {machine.status === "removed" ? (
        <>
          <p className={styles.title}>{t("machines.gate.removed", { name })}</p>
          <div className={styles.actions}>{thisButton}</div>
        </>
      ) : machine.status === "offline" || machine.status === "update" ? (
        <>
          <p className={styles.title}>
            {machine.status === "offline"
              ? t("machines.gate.offline", { name })
              : machine.update === "client"
                ? t("machine-update.viewer.desktop-client", { name })
                : t("machine-update.viewer.desktop-host", { name })}
          </p>
          {seen === null || machine.status === "update" ? null : (
            <p className={styles.help}>
              {t("machines.status.last-seen", {
                time: formatRelativeTime(new Date(seen), new Date()),
              })}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              icon={actionIcons.retry}
              data-machine-retry=""
              onClick={onRetry}
            >
              {t("common.button.retry")}
            </Button>
            {thisButton}
          </div>
        </>
      ) : (
        <div className={styles.connecting}>
          <Shimmer>{t("machines.gate.connecting", { name })}</Shimmer>
        </div>
      )}
    </div>
  );
}
