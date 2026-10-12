import { type ReactNode, useEffect, useRef } from "react";
import { t } from "@lophn/wording";

import { useViewCover } from "../../app-frame/embedded-view.tsx";
import { INFO_PANEL_WIDTH, type InfoPanelPlacement } from "../model.ts";
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
  /** overlay를 Escape·바깥 click으로 닫는다(shell/editor#R6). */
  onClose?: () => void;
  /** 탭 본문. 없으면 빈 안내를 둔다. 내용은 편집기의 정보 패널(editor/info-panel)이 그린다. */
  children?: ReactNode;
}

// 정보 패널 자리. 탭 줄과 틀만 두고 본문은 편집기의 정보 패널이 채운다.
export function InfoPanel(
  { placement, tab, onTab, onClose, children }: InfoPanelProps,
) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // 좁은 창에서 본문을 덮는 동안 앱 view는 숨지 않고 덮이지 않은 폭으로 준다(app-frame#R36).
  useViewCover(ref, placement === "overlay");
  // overlay일 때만 Escape와 바깥 click으로 닫는다. dock이면 본문 옆 열이라 그대로 둔다.
  useEffect(() => {
    if (placement !== "overlay") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close.current?.();
    };
    const onPointer = (event: PointerEvent) => {
      const panel = ref.current;
      const target = event.target;
      if (!panel || !(target instanceof Node) || panel.contains(target)) return;
      // Radix가 body에 띄운 popover(고르기 목록)는 패널의 일부다.
      if (
        target instanceof Element &&
        target.closest("[data-radix-popper-content-wrapper]")
      ) return;
      close.current?.();
    };
    const owner = ref.current?.ownerDocument ?? document;
    owner.addEventListener("keydown", onKey);
    owner.addEventListener("pointerdown", onPointer, true);
    return () => {
      owner.removeEventListener("keydown", onKey);
      owner.removeEventListener("pointerdown", onPointer, true);
    };
  }, [placement]);
  if (placement === "hidden") return null;
  return (
    <aside
      ref={ref}
      className={`${styles.slot} ${
        placement === "overlay" ? styles.overlay : ""
      }`}
      data-info-panel={placement}
      style={{ width: `${INFO_PANEL_WIDTH}px` }}
    >
      <div className={styles.head} role="tablist">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className={styles.trigger}
            aria-selected={item === tab}
            data-info-tab={item}
            onClick={() => onTab(item)}
          >
            {t(TAB_LABEL[item])}
          </button>
        ))}
      </div>
      <div className={styles.body} data-info-body="">
        {children ?? t("project-workspace.info.empty")}
      </div>
    </aside>
  );
}
