// 앱 공간의 운영 패널 틀. 720px로 열고, 창이 1,024px 이상이면 본문 옆
// 열로 앱 view 자리를 밀며 그보다 좁으면 본문을 덮는다. 덮는 동안 앱 view는 숨지 않고 패널이
// 덮지 않는 영역으로 줄며, 닫으면 원래 bounds로 돌아온다(useViewCover). 패널 안 내용(version,
// access 등)은 app-detail이 채운다.
import { type ReactNode, useRef } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { useViewCover } from "./embedded-view.tsx";
import styles from "./ops-panel-frame.module.css";

const OPS_PANEL_WIDTH = 720;
/** 이 창 폭보다 좁으면 패널은 본문을 덮는다. */
const OPS_PANEL_DOCK_MIN = 1024;

type OpsPanelPlacement = "hidden" | "docked" | "overlay";

export function opsPanelPlacement(
  open: boolean,
  windowWidth: number,
): OpsPanelPlacement {
  if (!open) return "hidden";
  return windowWidth < OPS_PANEL_DOCK_MIN ? "overlay" : "docked";
}

interface OpsPanelFrameProps {
  placement: OpsPanelPlacement;
  onClose: () => void;
  children?: ReactNode;
}

export function OpsPanelFrame(
  { placement, onClose, children }: OpsPanelFrameProps,
) {
  const ref = useRef<HTMLElement>(null);
  useViewCover(ref, placement === "overlay");
  if (placement === "hidden") return null;
  const close = t("common.button.close");
  return (
    <aside
      ref={ref}
      className={`${styles.panel} ${
        placement === "overlay" ? styles.overlay : ""
      }`}
      data-ops-panel={placement}
      aria-label={t("app-space.heading.app-details")}
      style={{ width: `${OPS_PANEL_WIDTH}px` }}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>{t("app-space.heading.app-details")}</h2>
        <Tooltip content={close}>
          <IconButton
            icon={workspaceIcons.close}
            label={close}
            size="sm"
            data-ops-panel-close=""
            onClick={onClose}
          />
        </Tooltip>
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
