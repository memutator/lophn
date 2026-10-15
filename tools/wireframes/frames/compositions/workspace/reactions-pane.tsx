// Settings › Reactions. 새 일을 여는 domain event 다섯마다 Off, Open without asking, Ask를 고른다.
// 기본은 열고 묻지 않음이다. call을 닫는 event는 항목이 없다.
import { Select } from "@lophn/design/components";

import a from "../agents.module.css";
import c from "../compose.module.css";
import { type ReactionMode, REACTIONS } from "./data.ts";
import { NamedControl } from "./named-control.tsx";
import styles from "./workspace.module.css";

const OPTIONS: readonly { value: ReactionMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "open", label: "Open without asking" },
  { value: "ask", label: "Ask" },
];

export function ReactionsPane() {
  return (
    <div className={a.setPage}>
      <h1 className={c.searchTitle}>Reactions</h1>
      <p className={a.setLead}>
        When something happens, lophn can open a new agent session for it.
        Choose what happens for each event. By default lophn opens the session
        without asking.
      </p>
      <ul className={styles.group}>
        {REACTIONS.map((item) => (
          <li key={item.id} className={styles.reaction}>
            <NamedControl name={item.event} labelClass={styles.settingName}>
              {({ label, provide }) => (
                <>
                  <div className={styles.reactionInfo}>
                    {label}
                    <span className={styles.muted}>{item.when}</span>
                    <span className={styles.caption}>
                      Opens: {item.opens}
                    </span>
                  </div>
                  <div className={styles.settingControl}>
                    {provide(
                      <Select options={OPTIONS} defaultValue={item.mode} />,
                    )}
                  </div>
                </>
              )}
            </NamedControl>
          </li>
        ))}
      </ul>
      <p className={`${styles.muted} ${styles.section}`}>
        Ask puts a request in the waiting list and opens the session when you
        allow it. Events that close a task handed to an App Engineer are not
        listed; they always reach that App Engineer.
      </p>
    </div>
  );
}
