// 다른 기계 창의 Settings 자리. 그 기계의 설정은 그 기계에서 바꾸고, 짝지은 기계의 관리는 이 컴퓨터 창의 Settings › Remote가 한다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../icons/mod.ts";
import { useMachines, useMachinesView } from "./context.tsx";
import styles from "./remote-settings.module.css";

export function RemoteSettings({ machine }: { machine: { name: string } }) {
  const source = useMachines();
  const thisComputer = useMachinesView()?.thisComputer ?? null;
  return (
    <div className={styles.column}>
      <p className={styles.text} data-machine-settings="">
        {t("machines.notice.settings-elsewhere", { name: machine.name })}
      </p>
      {source === null || thisComputer === null ? null : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon={actionIcons.open}
            data-machine-open-this=""
            onClick={() => void source.open(thisComputer.id)}
          >
            {t("machines.button.open-this-computer")}
          </Button>
        </div>
      )}
    </div>
  );
}
