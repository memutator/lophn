// Lophn Workspace › Apps. 목록과 보관·다시 꺼내기뿐이다. 앱 등록은 이 화면의 일이 아니다.
import { Button, Icon, iconPixels, StatusMark } from "@lophn/design/components";
import {
  appSpaceIcons,
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { APPS, ARCHIVED_APPS, type RunState } from "./data.ts";
import styles from "./workspace.module.css";

const RUN: Record<
  RunState,
  { tone: "good" | "warning" | "neutral"; label: string }
> = {
  running: { tone: "good", label: "Running" },
  stopped: { tone: "neutral", label: "Stopped" },
  preparing: { tone: "neutral", label: "Preparing" },
  unavailable: { tone: "warning", label: "Unavailable" },
};

export function AppsScreen() {
  return (
    <div className={styles.screen}>
      <div className={styles.appsPage}>
        <p className={styles.muted}>
          Apps are registered by lophn or by you, not from this screen. Open an
          app to go to its app space.
        </p>
        <h2 className={styles.groupTitle}>Apps</h2>
        <ul className={styles.rows}>
          {APPS.map((app) => (
            <li key={app.name} className={styles.row}>
              <span className={styles.rowMain}>
                <Icon
                  icon={appSpaceIcons.app}
                  pixels={iconPixels("base")}
                  className={styles.rowIcon}
                />
                <span className={styles.rowName}>{app.name}</span>
                <StatusMark
                  tone={RUN[app.run].tone}
                  label={RUN[app.run].label}
                />
              </span>
              <span className={styles.actions}>
                <Button size="sm">Open</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={lophnSpaceIcons.archive}
                >
                  Archive
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <h2 className={styles.groupTitle}>Archived</h2>
        <ul className={styles.rows}>
          {ARCHIVED_APPS.map((name) => (
            <li key={name} className={styles.row}>
              <span className={styles.rowMain}>
                <Icon
                  icon={appSpaceIcons.app}
                  pixels={iconPixels("base")}
                  className={styles.rowIcon}
                />
                <span className={styles.rowName}>{name}</span>
              </span>
              <Button size="sm" icon={lophnSpaceIcons.unarchive}>
                Unarchive
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
