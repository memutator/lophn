// 탭 본문의 범위. 탭의 기계(없으면 그 workspace의 기계)로 읽고 부른다. 그 기계가 붙어 있지 않으면 본문 대신 기계 이름, 상태,
// 마지막으로 본 때 한 줄이고(탭과 저장한 값은 그대로다), 붙으면 본문을 새로 mount해 이어진다(터미널은 `terminal_ref`로 다시 붙는다).
// 명단에서 빠진 기계의 탭은 removed 한 줄이고 사람이 닫는다. 탭이 앱이고(`hereApp`) 이 컴퓨터에 그 앱이 있으면 탭의 기계와
// 상관없이 이 컴퓨터의 범위다.
import { formatRelativeTime, t } from "@lophn/i18n";
import type { ReactNode } from "react";

import { useAppHere } from "../../app-frame/app-machine.tsx";
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
  hereApp,
  children,
}: {
  tab: TabItem;
  workspaceMachine: MachineRef;
  /** 그 탭 kind의 `hereApp`. 이 컴퓨터에 이 앱이 있으면 그 기계의 상태 안내보다 이 컴퓨터의 본문이 앞선다. */
  hereApp?: string | undefined;
  children: ReactNode;
}) {
  const machine = tab.machine ?? workspaceMachine;
  const scope = useScopeMachine();
  const source = useMachines();
  const view = useMachinesView();
  const here = useAppHere(hereApp, machine);
  if (here === undefined) return null;
  if (here) return <MachineScope machine={null}>{children}</MachineScope>;
  if (machine === null && scope === null) return <>{children}</>;
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
