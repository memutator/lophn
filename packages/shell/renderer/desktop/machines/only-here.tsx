// 다른 기계 창에서 끈 기능(터미널, 편집기, browser 등)의 탭이 설 자리. 이 컴퓨터의 것을 대신 열자는 뜻이 아니라서 단추가 없다.
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
