// 이 컴퓨터에서만 열리는 kind(편집기, browser 등)의 탭이 다른 기계의 것일 때 본문 자리. 이 컴퓨터의 것을 대신 열자는 뜻이 아니라서 단추가 없다.
import { t } from "@lophn/i18n";

import styles from "./only-here.module.css";

export function OnlyHere({ machine }: { machine: { name: string } }) {
  return (
    <div className={styles.column}>
      <p className={styles.text} data-machine-only-here="">
        {t("machines.notice.only-here", { name: machine.name })}
      </p>
    </div>
  );
}
