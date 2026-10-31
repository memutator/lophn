// tab 하나에 하는 일의 menu. tab 줄의 오른쪽 클릭과 card 머리의 ⋯가 같은 항목을 쓴다. 항목만 만들고 일은 호출자가 한다.
import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";

import { editorIcons, shellIcons, workspaceIcons } from "../icons/mod.ts";
import type { SplitDir } from "./desk-model.ts";
import styles from "./tab-menu.module.css";

export type TabAction =
  | "rename"
  | "close"
  | "close-others"
  | "close-right"
  | "close-saved"
  | "close-all"
  | "keep-open"
  | "float"
  | "split-right"
  | "split-down"
  | "unsplit"
  | "detach"
  | "copy-path"
  | "copy-relative-path"
  | "reveal";

/** menu를 여는 tab의 사정. 없는 항목은 그리지 않고, 있어도 못 하는 항목은 흐리게 둔다. */
export interface TabMenuState {
  /** kind가 rename을 선언했다. */
  readonly renamable: boolean;
  readonly preview: boolean;
  /** 디스크 파일 tab이다(Copy path, Reveal). */
  readonly file: boolean;
  /** detached 창 통로가 있고 kind가 noDetach가 아니다. */
  readonly canDetach: boolean;
  /** tab이 split 구성원이면 그 split의 방향. 아니면 null. */
  readonly split: SplitDir | null;
  /** 이웃 tab이 있어 split할 수 있다. */
  readonly canSplit: boolean;
  /** desk에 이 칸 말고 tab이 있다. */
  readonly hasOthers: boolean;
  /** 이 칸 오른쪽에 tab이 있다. */
  readonly hasRight: boolean;
}

// split이 아니면 Split right·down, split이면 다른 방향 하나와 Unsplit이다.
function splitItems(state: TabMenuState): MenuItem[] {
  const right: MenuItem = {
    id: "split-right",
    label: t("shell.button.tab-split-right"),
    leading: <MenuIcon icon={shellIcons.split} />,
    disabled: state.split === null && !state.canSplit,
  };
  const down: MenuItem = {
    id: "split-down",
    label: t("shell.button.tab-split-down"),
    leading: <MenuIcon icon={shellIcons.splitDown} />,
    disabled: state.split === null && !state.canSplit,
  };
  const items =
    state.split === null
      ? [right, down]
      : state.split === "row"
        ? [down]
        : [right];
  if (state.split !== null) {
    items.push({
      id: "unsplit",
      label: t("shell.button.tab-unsplit"),
      leading: <MenuIcon icon={shellIcons.unsplit} />,
    });
  }
  return [{ ...items[0]!, separatorBefore: true }, ...items.slice(1)];
}

export function tabMenuItems(state: TabMenuState): MenuItem[] {
  return [
    ...(state.renamable
      ? [
          {
            id: "rename",
            label: t("shell.button.tab-rename"),
            leading: <MenuIcon icon={editorIcons.edit} />,
          },
        ]
      : []),
    {
      id: "close",
      label: t("shell.button.tab-close"),
      leading: <MenuIcon icon={workspaceIcons.close} />,
    },
    {
      id: "close-others",
      label: t("shell.button.tab-close-others"),
      leading: <MenuIcon icon={workspaceIcons.closeOthers} />,
      disabled: !state.hasOthers,
    },
    {
      id: "close-right",
      label: t("shell.button.tab-close-right"),
      leading: <MenuIcon icon={workspaceIcons.closeRight} />,
      disabled: !state.hasRight,
    },
    {
      id: "close-saved",
      label: t("shell.button.tab-close-saved"),
      leading: <MenuIcon icon={workspaceIcons.closeSaved} />,
    },
    {
      id: "close-all",
      label: t("shell.button.tab-close-all"),
      leading: <MenuIcon icon={workspaceIcons.closeAll} />,
    },
    ...splitItems(state),
    {
      id: "float",
      label: t("shell.button.tab-float"),
      leading: <MenuIcon icon={shellIcons.float} />,
    },
    ...(state.canDetach
      ? [
          {
            id: "detach",
            label: t("shell.button.tab-detach"),
            leading: <MenuIcon icon={shellIcons.detach} />,
          },
        ]
      : []),
    ...(state.file
      ? [
          {
            id: "copy-path",
            label: t("shell.button.tab-copy-path"),
            leading: <MenuIcon icon={workspaceIcons.copyPath} />,
            separatorBefore: true,
          },
          {
            id: "copy-relative-path",
            label: t("shell.button.tab-copy-relative-path"),
            leading: <MenuIcon icon={workspaceIcons.copyRelativePath} />,
          },
          {
            id: "reveal",
            label: t("shell.button.tab-reveal"),
            leading: <MenuIcon icon={workspaceIcons.revealInExplorer} />,
          },
        ]
      : []),
    ...(state.preview
      ? [
          {
            id: "keep-open",
            label: t("shell.button.tab-keep-open"),
            leading: <MenuIcon icon={workspaceIcons.keepOpen} />,
            separatorBefore: true,
          },
        ]
      : []),
  ];
}

/** tab 줄 오른쪽 클릭 menu. 누른 화면 좌표에 열리고 고르거나 밖을 누르면 닫힌다. */
export function TabContextMenu({
  at,
  state,
  onSelect,
  onClose,
}: {
  at: { x: number; y: number };
  state: TabMenuState;
  onSelect: (action: TabAction) => void;
  onClose: () => void;
}) {
  return (
    <Menu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      trigger={
        <span className={styles.anchor} style={{ left: at.x, top: at.y }} />
      }
      items={tabMenuItems(state)}
      onSelect={(id) => {
        onSelect(id as TabAction);
        onClose();
      }}
    />
  );
}
