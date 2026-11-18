// 다른 기계 창의 Settings에서 열지 않는 자리. 두 까닭이다: 이 컴퓨터의 shell이나 OS에 붙은 항목(Appearance, Browser…)과
// 이 컴퓨터가 그 기계에서 터미널 입력을 허락받지 못해 그 기계의 설정을 바꾸지 못할 때. 둘 다 한 줄과 [Open this computer]다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../icons/mod.ts";
import { useMachines, useMachinesView } from "./context.tsx";
import styles from "./remote-settings.module.css";

export function RemoteSettings({
  machine,
  reason,
}: {
  machine: { name: string };
  /** this-computer: 이 컴퓨터에 붙은 항목. no-grant: 그 기계가 이 컴퓨터의 사람 route를 열지 않았다. */
  reason: "this-computer" | "no-grant";
}) {
  const source = useMachines();
  const thisComputer = useMachinesView()?.thisComputer ?? null;
  return (
    <div className={styles.column}>
      <p className={styles.text} data-machine-settings={reason}>
        {reason === "this-computer"
          ? t("machines.notice.settings-elsewhere", { name: machine.name })
          : t("machines.notice.settings-no-grant", { name: machine.name })}
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
