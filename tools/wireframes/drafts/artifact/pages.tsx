// project sidebar의 Artifacts 탭 두 장. renderer에 이 panel이 아직 없어 Drafts에 남아 있다(sidebar 화면 task가 옮긴다).
// 탭 줄은 renderer의 TabStrip이다.
import { Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import {
  artifactIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import { ARTIFACTS, SPENDING } from "../../mock/artifact/data.ts";
import styles from "./artifact.module.css";

const noop = () => {};

const SIDEBAR_TABS = ["explorer", "agent", "artifact"] as const;

function SidebarRows(
  { rows }: { rows: typeof ARTIFACTS },
) {
  if (rows.length === 0) {
    return <p className={styles.sideEmpty}>{t("artifact.empty.none")}</p>;
  }
  return (
    <ul className={styles.rows} aria-label={t("artifact.label.list")}>
      {rows.map((row) => (
        <li
          key={row.name}
          className={styles.row}
          data-selected={row.name === SPENDING.name ? "" : undefined}
        >
          <span className={styles.rowIcon}>
            <Icon icon={artifactIcons.kind} pixels={iconPixels("base")} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowHead}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowName}>{row.name}</span>
            </span>
            <span className={styles.rowDesc}>{row.description}</span>
          </span>
          <span className={styles.rowAction}>
            <IconButton
              icon={workspaceIcons.trash}
              label={t("artifact.button.delete")}
              size="sm"
              onClick={noop}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ArtifactSidebar(
  { rows }: { rows: typeof ARTIFACTS },
) {
  return (
    <nav className={styles.sidebar}>
      <TabStrip
        compact
        tabs={SIDEBAR_TABS.map((key) => ({
          key,
          title: t(`project-workspace.label.sidebar-tab-${key}`),
        }))}
        selected="artifact"
      />
      <div className={styles.sidebarBody}>
        <SidebarRows rows={rows} />
      </div>
    </nav>
  );
}

/** project sidebar의 Artifacts 탭. artifact가 있을 때의 목록이다. */
export function ArtifactSidebarListPage() {
  return (
    <div className={styles.sideLayout}>
      <ArtifactSidebar rows={ARTIFACTS} />
    </div>
  );
}

/** artifact가 하나도 없을 때의 Artifacts 탭이다. */
export function ArtifactSidebarEmptyPage() {
  return (
    <div className={styles.sideLayout}>
      <ArtifactSidebar rows={[]} />
    </div>
  );
}
