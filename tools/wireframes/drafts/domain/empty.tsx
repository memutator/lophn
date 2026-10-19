// domain이 0개인 project의 sidebar 둘(A, B)을 나란히 놓는다.
import { t } from "@lophn/wording";
import { DomainChips, DomainList } from "./parts.tsx";
import {
  AgentTabBody,
  DraftSidebar,
  SIDEBAR_KEYS,
  SIDEBAR_KEYS_NO_DOMAIN,
} from "./project-frame.tsx";
import styles from "./domain.module.css";

export function DomainEmptyPair() {
  return (
    <div className={styles.twoUp} style={{ position: "absolute", inset: 0 }}>
      <div className={styles.twoUpCell}>
        <p className={styles.twoUpCap}>A</p>
        <div className={styles.twoUpBox}>
          <DraftSidebar keys={SIDEBAR_KEYS} selected="domain">
            <DomainList domains={[]} />
          </DraftSidebar>
        </div>
      </div>
      <div className={styles.twoUpCell}>
        <p className={styles.twoUpCap}>B</p>
        <div className={styles.twoUpBox}>
          <DraftSidebar keys={SIDEBAR_KEYS_NO_DOMAIN} selected="agent">
            <DomainChips domains={[]} />
            <p className={styles.empty}>{t("domain.empty.project")}</p>
            <AgentTabBody />
          </DraftSidebar>
        </div>
      </div>
    </div>
  );
}
