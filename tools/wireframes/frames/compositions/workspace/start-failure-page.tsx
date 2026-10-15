// 시작 실패. 높은 schema, hash가 다른 이력, 손상 원본 세 경우를 한 창에 나란히 놓는다.
// 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내를 준다.
import { Button, Icon, iconPixels } from "@lophn/design/components";
import {
  connectionFailedIcon,
  retryIcon,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { Wordmark } from "../../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { WireTopBar } from "../../chrome/title-bar.tsx";
import launcher from "../../../../../packages/shell/renderer/desktop/launcher/launcher.module.css";
import styles from "./workspace.module.css";

interface Failure {
  readonly caption: string;
  readonly title: string;
  readonly text: string;
  readonly update: string;
  readonly details: string;
}

const FAILURES: readonly Failure[] = [
  {
    caption: "Data from a newer version",
    title: "This data is from a newer lophn",
    text:
      "lophn did not start. It left your data exactly as it was, and this version can't read it.",
    update: "Update lophn to the newer version, then start it again.",
    details: "schema 14 found, this version reads up to 12",
  },
  {
    caption: "History does not match",
    title: "The saved history does not match",
    text:
      "lophn did not start. The history in your data differs from what this version expects, and lophn did not change it.",
    update:
      "Update lophn, or start the version that wrote this data. Then try again.",
    details: "step 7 hash differs from the recorded hash",
  },
  {
    caption: "Damaged data",
    title: "Your data can't be read",
    text:
      "lophn did not start. The data file is damaged. lophn did not repair or replace it, so the original is still there.",
    update:
      "Update lophn and try again. If it still fails, keep the folder as it is.",
    details: "ledger file failed its integrity check",
  },
];

export function StartFailures() {
  return (
    <div className={launcher.window} data-space="launcher" data-gated="">
      <WireTopBar leading={<Wordmark>lophn</Wordmark>} />
      <main className={styles.failures}>
        {FAILURES.map((failure) => (
          <section key={failure.caption} className={styles.failureCase}>
            <span className={styles.caption}>{failure.caption}</span>
            <div className={styles.failureFrame} role="alert">
              <Icon
                icon={connectionFailedIcon}
                pixels={iconPixels("large")}
                className={styles.failureIcon}
              />
              <h1 className={styles.failureTitle}>{failure.title}</h1>
              <p className={styles.failureText}>{failure.text}</p>
              <p className={styles.failureTextSmall}>{failure.update}</p>
              <Button variant="primary" icon={retryIcon}>Try again</Button>
              <p className={styles.failureDetails}>{failure.details}</p>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
