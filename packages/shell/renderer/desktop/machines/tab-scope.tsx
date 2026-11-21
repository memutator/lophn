// 탭 본문의 범위. 탭의 기계(없으면 그 workspace의 기계)로 읽고 부른다. 그 기계가 붙어 있지 않으면 본문 대신 기계 이름, 상태,
// 마지막으로 본 때 한 줄이고(탭과 저장한 값은 그대로다), 붙으면 본문을 새로 mount해 이어진다(터미널은 `terminal_ref`로 다시 붙는다).
// 명단에서 빠진 기계의 탭은 removed 한 줄이고 사람이 닫는다.
import { formatRelativeTime, t } from "@lophn/i18n";
import type { ReactNode } from "react";

import type { TabItem } from "../../workspace/model.ts";
import { machineItemOf, useMachinesView, useScopeMachine } from "./context.tsx";
import styles from "./only-here.module.css";
import { type MachineRef, MachineScope } from "./scope.tsx";
import type { MachineItem } from "./source.ts";

export function TabScope({
  tab,
  workspaceMachine,
  children,
}: {
  tab: TabItem;
  workspaceMachine: MachineRef;
  children: ReactNode;
}) {
  const scope = useScopeMachine();
  const view = useMachinesView();
  // 다른 기계의 workspace에 둔 이 컴퓨터의 탭은 `machine`에 이 컴퓨터의 id를 든다. 이 컴퓨터로 그린다.
  const raw = tab.machine ?? workspaceMachine;
  const machine = raw === view?.thisComputer?.id ? null : raw;
  if (machine === null && scope === null) return <>{children}</>;
  if (machine !== null) {
    const item = machineItemOf(view, machine);
    if (item.status !== "connected") {
      return (
        <div className={styles.column}>
          <p className={styles.text} data-machine-tab-gate={item.status}>
            {gateLine(item)}
          </p>
        </div>
      );
    }
  }
  return <MachineScope machine={machine}>{children}</MachineScope>;
}

function gateLine(machine: MachineItem): string {
  const name =
    machine.name === "" ? t("machines.label.unknown-name") : machine.name;
  switch (machine.status) {
    case "removed":
      return t("projects.notice.tab-machine-removed", { name });
    case "offline":
      return machine.lastSeenAt === null
        ? t("machines.gate.offline", { name })
        : t("projects.notice.tab-machine-offline", {
            name,
            time: formatRelativeTime(new Date(machine.lastSeenAt), new Date()),
          });
    case "update":
      return machine.update === "client"
        ? t("machine-update.viewer.desktop-client", { name })
        : t("machine-update.viewer.desktop-host", { name });
    default:
      return t("machines.gate.connecting", { name });
  }
}
