// 시작 실패. 높은 schema, hash가 다른 이력, 손상 원본 세 경우를 한 창에 나란히 놓는다. 각 경우의 본문은 renderer의
// StartFailureScreen이다. 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내를 준다.
import {
  TopBar,
  Wordmark,
} from "../../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { schemaFailure } from "../../../../../packages/shell/renderer/desktop/launcher/start-failure/model.ts";
import { StartFailureScreen } from "../../../../../packages/shell/renderer/desktop/launcher/start-failure/start-failure.tsx";
import launcher from "../../../../../packages/shell/renderer/desktop/launcher/launcher.module.css";
import styles from "../../../drafts/workspace/workspace.module.css";

const CASES = [
  { caption: "Data from a newer version", reason: "newer_schema" },
  { caption: "History does not match", reason: "history_mismatch" },
  { caption: "Damaged data", reason: "damaged_original" },
] as const;

export function StartFailures() {
  return (
    <div className={launcher.window} data-space="launcher" data-gated="">
      <TopBar platform="linux" leading={<Wordmark>lophn</Wordmark>} />
      <main className={styles.failures}>
        {CASES.map((one) => (
          <section key={one.caption} className={styles.failureCase}>
            <span className={styles.caption}>{one.caption}</span>
            <div className={styles.failureFrame}>
              <StartFailureScreen
                failure={schemaFailure(one.reason)}
                onRetry={() => {}}
              />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
