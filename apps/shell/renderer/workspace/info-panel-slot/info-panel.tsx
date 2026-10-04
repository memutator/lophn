import { t } from "@lophn/wording";

import type { InfoPanelPlacement } from "../model.ts";
import styles from "./info-panel.module.css";

export type InfoTab = "info" | "versions" | "contexts";

const TABS: readonly InfoTab[] = ["info", "versions", "contexts"];

const TAB_LABEL: Record<
  InfoTab,
  | "project-workspace.label.info-tab-info"
  | "project-workspace.label.info-tab-versions"
  | "project-workspace.label.info-tab-contexts"
> = {
  info: "project-workspace.label.info-tab-info",
  versions: "project-workspace.label.info-tab-versions",
  contexts: "project-workspace.label.info-tab-contexts",
};

export interface InfoPanelProps {
  placement: InfoPanelPlacement;
  tab: InfoTab;
  onTab: (tab: InfoTab) => void;
}

// 정보 패널 자리. 내용(버전 이력·비교)은 T18이 채운다. 여기는 자리만 둔다.
export function InfoPanel({ placement, tab, onTab }: InfoPanelProps) {
  if (placement === "hidden") return null;
  return (
    <aside
      className={`${styles.slot} ${
        placement === "overlay" ? styles.overlay : ""
      }`}
      data-info-panel={placement}
    >
      <div className={styles.tabs} role="tablist">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={item === tab}
            data-info-tab={item}
            onClick={() => onTab(item)}
          >
            {t(TAB_LABEL[item])}
          </button>
        ))}
      </div>
      <div className={styles.body} data-info-body="">
        {t("project-workspace.info.empty")}
      </div>
    </aside>
  );
}
