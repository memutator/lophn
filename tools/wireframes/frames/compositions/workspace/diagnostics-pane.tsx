// Settings › Diagnostics. 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한 시각.
// 사람이 [Run checks]를 누를 때만 점검한다. 보안 점검은 없다.
import { Button, StatusMark } from "@lophn/design/components";
import { retryIcon } from "../../../../../packages/shell/renderer/icons/mod.ts";

import a from "../agents.module.css";
import c from "../compose.module.css";
import { DIAGNOSTICS } from "./data.ts";
import styles from "./workspace.module.css";

export function DiagnosticsPane() {
  return (
    <div className={`${a.setPage} ${styles.wide}`}>
      <h1 className={c.searchTitle}>Diagnostics</h1>
      <p className={a.setLead}>
        Whether each part of lophn can be used right now. Checks run only when
        you press the button.
      </p>
      <div className={styles.toolbar}>
        <span className={styles.muted}>Last run at 10:42:09</span>
        <Button icon={retryIcon}>Run checks</Button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Available</th>
              <th scope="col">Reason</th>
              <th scope="col">Checked at</th>
            </tr>
          </thead>
          <tbody>
            {DIAGNOSTICS.map((item) => (
              <tr key={item.name}>
                <td className={styles.productName}>{item.name}</td>
                <td>
                  <StatusMark
                    tone={item.available ? "good" : "critical"}
                    label={item.available ? "Available" : "Unavailable"}
                  />
                </td>
                <td>
                  {item.reason ?? <span className={styles.dim}>-</span>}
                </td>
                <td className={styles.mono}>{item.checkedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
