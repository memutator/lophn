// title bar 왼쪽의 기계 고르기. 지금 창이 어느 기계를 보는지 이름으로 늘 보이고, 누르면 이 컴퓨터와 짝지은 기계의 목록이다.
// 짝지은 기계가 없고 이 창이 이 컴퓨터면 그리지 않는다(한 대만 쓰는 사람의 화면은 그대로다).
import { type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { Popover } from "@lophn/ui/overlay";

import { shellIcons } from "../../icons/mod.ts";
import { useMachines, useMachinesView } from "./context.tsx";
import styles from "./machine-switcher.module.css";
import { MachineStatus } from "./status.tsx";

export function MachineSwitcher({
  onPairAnother,
}: {
  /** 어디로 갈지(Settings › Remote 등)는 부르는 쪽이 정한다. */
  onPairAnother: () => void;
}) {
  const source = useMachines();
  const view = useMachinesView();
  const [open, setOpen] = useState(false);
  if (source === null || view === null) return null;
  const win = source.thisWindow();
  const current = win ?? view.thisComputer;
  if (current === null) return null;
  if (win === null && view.machines.length === 0) return null;

  const pick = (id: string) => {
    setOpen(false);
    void source.open(id);
  };
  const row = (id: string, name: string, status: ReactNode) => (
    <button
      key={id}
      type="button"
      className={styles.row}
      data-current={id === current.id || undefined}
      data-machine-row={id}
      onClick={() => pick(id)}
    >
      <span className={styles.lead}>
        {id === current.id ? (
          <Icon icon={shellIcons.current} pixels={16} />
        ) : null}
      </span>
      <span className={styles.name}>{name}</span>
      <span className={styles.status}>{status}</span>
    </button>
  );

  return (
    <span className={styles.slot}>
      <Popover
        placement="corner"
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            className={styles.button}
            data-machine-button=""
            aria-label={t("machines.button.switcher", { name: current.name })}
          >
            <span className={styles.label}>{current.name}</span>
            <Icon icon={shellIcons.expand} pixels={12} />
          </button>
        }
      >
        <div className={styles.list}>
          {view.thisComputer === null
            ? null
            : row(
                view.thisComputer.id,
                view.thisComputer.name,
                t("machines.button.this-computer"),
              )}
          {view.machines.map((machine) =>
            row(machine.id, machine.name, <MachineStatus machine={machine} />),
          )}
          <div className={styles.separator} />
          <button
            type="button"
            className={styles.row}
            data-machine-pair-another=""
            onClick={() => {
              setOpen(false);
              onPairAnother();
            }}
          >
            <span className={styles.lead}>
              <Icon icon={shellIcons.add} pixels={16} />
            </span>
            <span className={styles.name}>
              {t("machines.button.pair-another")}
            </span>
          </button>
        </div>
      </Popover>
    </span>
  );
}
