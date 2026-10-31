// 왼쪽 sidebar의 Jobs 줄에 붙어 오른쪽 옆으로 열리는 job 목록 panel. Inbox panel과 같은 층(`OverlayLayer`)이다.
// 줄을 누르면 Jobs 탭이 열리고 머리의 [Open in tab]도 같다. 열림 상태는 이 층이 가진다.
import { type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";

import { actionIcons } from "../../icons/mod.ts";
import { OverlayLayer } from "../../shell/overlay-layer.tsx";
import { JobRows } from "./job-rows.tsx";
import type { JobsSource } from "./source.ts";
import styles from "./jobs-layer.module.css";

export function JobsLayer({
  source,
  onOpenTab,
  renderTrigger,
}: {
  source: JobsSource;
  /** Jobs 탭을 연다. */
  onOpenTab: () => void;
  /** 여는 줄. */
  renderTrigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openTab = () => {
    setOpen(false);
    onOpenTab();
  };
  return (
    <OverlayLayer
      open={open}
      onOpenChange={setOpen}
      align="side"
      trigger={renderTrigger({ open, toggle: () => setOpen(!open) })}
    >
      <section
        className={styles.panel}
        aria-label={t("jobs.label.sidebar-tab")}
        data-jobs-overlay=""
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t("jobs.label.sidebar-tab")}</h2>
          <Tooltip content={t("jobs.button.open-tab")}>
            <IconButton
              size="sm"
              icon={actionIcons.openInTab}
              label={t("jobs.button.open-tab")}
              data-open-tab=""
              onClick={openTab}
            />
          </Tooltip>
        </header>
        <div className={styles.body}>
          <JobRows project={null} source={source} onOpen={openTab} />
        </div>
      </section>
    </OverlayLayer>
  );
}
