// 탭 본문의 범위. 탭의 기계(없으면 그 workspace의 기계)로 읽고 부른다. 그 기계가 붙어 있지 않으면 본문 대신 이름과 상태 한
// 줄이고, 붙으면 본문이 선다.
import { t } from "@lophn/i18n";
import type { ReactNode } from "react";

import type { TabItem } from "../../workspace/model.ts";
import {
  machineItemOf,
  useMachines,
  useMachinesView,
  useScopeMachine,
} from "./context.tsx";
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
  const machine = tab.machine ?? workspaceMachine;
  const scope = useScopeMachine();
  const source = useMachines();
  const view = useMachinesView();
  // 이미 그 기계의 범위다(workspace의 탭). 범위가 붙음을 이미 본다.
  if (machine === scope) return <>{children}</>;
  if (machine !== null) {
    const item = machineItemOf(source, view, machine);
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

// 창 전체 gate(`machine-gate.tsx`)와 같은 글이다.
function gateLine(machine: MachineItem): string {
  const name = machine.name;
  switch (machine.status) {
    case "removed":
      return t("machines.gate.removed", { name });
    case "offline":
      return t("machines.gate.offline", { name });
    case "update":
      return machine.update === "client"
        ? t("machine-update.viewer.desktop-client", { name })
        : t("machine-update.viewer.desktop-host", { name });
    default:
      return t("machines.gate.connecting", { name });
  }
}
