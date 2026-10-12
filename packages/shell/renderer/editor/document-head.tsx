import type { ReactNode, Ref } from "react";
import { IconButton, Kbd, Tooltip } from "@lophn/design/components";
import { editorIcons, workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { currentPlatform } from "../desktop/top-bar/platform.ts";
import styles from "./document-head.module.css";

export interface DocumentHeadProps {
  title: string;
  /** 메타 줄 하나. 지금 결과나 다음 행동 하나만 둔다. */
  meta: ReactNode;
  editing: boolean;
  /** 본문을 다 읽기 전에는 편집으로 바꾸지 않는다. */
  canEdit: boolean;
  onToggleEdit: () => void;
  infoOpen: boolean;
  onToggleInfo?: () => void;
  onMenu: (anchor: HTMLElement) => void;
  titleRef?: Ref<HTMLHeadingElement>;
}

/** CommandOrControl+E를 이 OS의 글자로 보인다. */
export function editShortcut(): readonly string[] {
  return currentPlatform() === "mac" ? ["⌘", "E"] : ["Ctrl", "E"];
}

function Labeled(
  { label, shortcut }: { label: string; shortcut?: readonly string[] },
) {
  return (
    <span className={styles.tip}>
      {label}
      {shortcut ? <Kbd keys={shortcut} /> : null}
    </span>
  );
}

// 문서 머리: 제목 20px·메타 12px·편집 ghost·정보 패널·메뉴. 읽기 화면에 primary는 없다.
export function DocumentHead(
  {
    title,
    meta,
    editing,
    canEdit,
    onToggleEdit,
    infoOpen,
    onToggleInfo,
    onMenu,
    titleRef,
  }: DocumentHeadProps,
) {
  const editLabel = editing
    ? t("document.button.read")
    : t("document.button.edit");
  const infoLabel = t("project-workspace.button.info-panel");
  const menuLabel = t("document.button.menu");
  return (
    <div className={styles.head} data-document-head="">
      <div className={styles.text}>
        <h1 className={styles.title} ref={titleRef} data-document-title="">
          {title}
        </h1>
        <p className={styles.meta} data-document-meta="">{meta}</p>
      </div>
      <div className={styles.actions}>
        <Tooltip
          content={<Labeled label={editLabel} shortcut={editShortcut()} />}
        >
          <IconButton
            icon={editing ? editorIcons.read : editorIcons.edit}
            label={editLabel}
            variant="ghost"
            aria-pressed={editing}
            aria-keyshortcuts="Control+E Meta+E"
            disabled={!canEdit}
            data-edit-toggle=""
            onClick={onToggleEdit}
          />
        </Tooltip>
        {onToggleInfo
          ? (
            <Tooltip content={infoLabel}>
              <IconButton
                icon={workspaceIcons.infoPanel}
                label={infoLabel}
                variant="ghost"
                aria-pressed={infoOpen}
                data-document-info=""
                onClick={onToggleInfo}
              />
            </Tooltip>
          )
          : null}
        <Tooltip content={menuLabel}>
          <IconButton
            icon={editorIcons.menu}
            label={menuLabel}
            variant="ghost"
            aria-haspopup="menu"
            data-document-menu=""
            onClick={(event) => onMenu(event.currentTarget)}
          />
        </Tooltip>
      </div>
    </div>
  );
}

export interface StickyHeadBarProps {
  title: string;
  section: string | null;
}

// 문서 제목이 scroll 칸 위로 사라지면 붙는 32px 머리. 제목과 지금 절이 보인다.
export function StickyHeadBar({ title, section }: StickyHeadBarProps) {
  return (
    <div className={styles.sticky} data-sticky-head="" aria-hidden="true">
      <span className={styles.stickyTitle}>{title}</span>
      {section === null
        ? null
        : (
          <span className={styles.stickySection} data-sticky-section="">
            {section}
          </span>
        )}
    </div>
  );
}
