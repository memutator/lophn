// Settings 안의 기계 고르기. 이 컴퓨터와 명단의 다른 컴퓨터 중 설정을 열 기계를 고른다. 다른 기계를 고르면 그 기계의 core에 걸린
// 항목(`MACHINE_PANES`)만 서고, 나머지 항목은 이 컴퓨터의 설정 한 줄이다.
import { t } from "@lophn/i18n";
import { Field, type MachineOption, MachineSelector } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";

import { statusParts } from "../machines/status.tsx";
import type { MachineRef } from "../machines/scope.tsx";
import type { MachineItem, MachineStatus } from "../machines/source.ts";
import styles from "./machine-picker.module.css";

// 이 컴퓨터의 option 값. 기계 id(`mch_`)와 겹치지 않는다.
const HERE = "here";

function optionStatus(status: MachineStatus): MachineOption["status"] {
  switch (status) {
    case "connected":
      return "online";
    case "connecting":
      return "connecting";
    case "update":
      return "update";
    case "offline":
    case "removed":
      return "offline";
  }
}

export function MachinePicker({
  machine,
  machines,
  onPick,
}: {
  machine: MachineRef;
  /** 명단의 다른 컴퓨터. */
  machines: readonly MachineItem[];
  onPick: (machine: MachineRef) => void;
}) {
  const options: MachineOption[] = [
    {
      id: HERE,
      name: t("machines.button.this-computer"),
      status: "online",
      current: true,
    },
    ...machines.map((one) => ({
      id: one.id,
      name: one.name,
      status: optionStatus(one.status),
      detail: one.status === "connected" ? undefined : statusParts(one).label,
      disabled: one.status !== "connected",
    })),
  ];
  return (
    <div className={styles.picker} data-settings-machine="">
      <Field label={t("settings.label.machine-picker")}>
        <MachineSelector
          size="sm"
          machines={options}
          value={machine ?? HERE}
          onValueChange={(value) =>
            onPick(value === null || value === HERE ? null : value)
          }
        />
      </Field>
    </div>
  );
}

/** 다른 기계를 골랐을 때 서지 않는 항목을 대신하는 한 줄. */
export function ThisComputerOnly({
  onThisComputer,
}: {
  onThisComputer: () => void;
}) {
  return (
    <div className={styles.elsewhere} data-settings-elsewhere="">
      <p>{t("settings.notice.this-computer-only")}</p>
      <Button size="sm" variant="secondary" onClick={onThisComputer}>
        {t("settings.button.this-computer-settings")}
      </Button>
    </div>
  );
}

/** 고른 기계의 설정을 열 수 없는 까닭 한 줄. */
export function SettingsGate({
  reason,
  name,
}: {
  reason: "connecting" | "offline" | "removed" | "no-grant";
  name: string;
}) {
  return (
    <p className={styles.gate} data-machine-settings={reason}>
      {reason === "no-grant"
        ? t("machines.notice.settings-no-grant", { name })
        : t(`machines.gate.${reason}`, { name })}
    </p>
  );
}
