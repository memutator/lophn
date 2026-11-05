// tab 하나에 하는 일의 menu. tab 줄의 오른쪽 클릭과 card 머리의 ⋯가 같은 항목을 쓴다. 항목만 만들고 일은 호출자가 한다.
import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";

import { useKeyLabel } from "../commands/react.tsx";
import { editorIcons, shellIcons, workspaceIcons } from "../icons/mod.ts";
import styles from "./tab-menu.module.css";

export type TabAction =
  | "rename"
  | "close"
  | "close-others"
  | "close-pane-others"
  | "close-group"
  | "close-right"
  | "close-saved"
  | "close-all"
  | "keep-open"
  | "float"
  | "split-right"
  | "split-down"
  | "split-remove"
  | "unstack"
  | "unsplit"
  | "detach"
  | "copy-path"
  | "copy-relative-path"
  | "reveal";

// menu 항목 옆에 보일 키의 binding id. 키는 누른 tab이 아니라 고른 tab에 하지만 같은 일이다.
const TAB_BINDING: Record<TabAction, string> = {
  rename: "tab.rename",
  close: "tab.close",
  "close-others": "tab.close-others",
  "close-pane-others": "pane.close-others",
  "close-group": "pane.close-group",
  "close-right": "tab.close-right",
  "close-saved": "tab.close-saved",
  "close-all": "tab.close-all",
  "keep-open": "tab.keep-open",
  float: "tab.float",
  "split-right": "pane.split",
  "split-down": "pane.split-down",
  "split-remove": "pane.remove",
  unstack: "pane.unstack",
  unsplit: "pane.unsplit",
  detach: "tab.detach",
  "copy-path": "tab.copy-path",
  "copy-relative-path": "tab.copy-relative-path",
  reveal: "tab.reveal",
};

/** menu를 여는 tab의 사정. 없는 항목은 그리지 않고, 있어도 못 하는 항목은 흐리게 둔다. */
export interface TabMenuState {
  /** kind가 rename을 선언했다. */
  readonly renamable: boolean;
  readonly preview: boolean;
  /** 디스크 파일 tab이다(Copy path, Reveal). */
  readonly file: boolean;
  /** detached 창 통로가 있고 kind가 noDetach가 아니다. */
  readonly canDetach: boolean;
  /** tab이 든 group의 leaf 수. group에 들지 않았으면 0. */
  readonly group: number;
  /** tab이 보이는 칸이 다른 tab도 돌려 본다(Close others in pane, Move out of pane). */
  readonly stacked?: boolean;
  /** 옆에 붙일 plain tab이 있고 group이 가득 차지 않았다(Split right·down을 할 수 있다). */
  readonly canSplit: boolean;
  /** desk에 이 칸 말고 tab이 있다. */
  readonly hasOthers: boolean;
  /** 이 칸 오른쪽에 tab이 있다. */
  readonly hasRight: boolean;
}

// Split right·down은 늘 있다(group 안에서는 그 leaf 옆에 다음 plain tab을 붙인다). 칸이 여러 tab을 돌려 보면
// 칸에서 꺼내기(Move out of pane)가 오고, group 구성원이면 그 뒤에 꺼내기(Remove from split)와 풀기가 온다: leaf가
// 둘이면 Unsplit 하나, 셋 이상이면 Remove from split과 Unsplit all.
function splitItems(state: TabMenuState): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: "split-right",
      label: t("shell.button.tab-split-right"),
      leading: <MenuIcon icon={shellIcons.split} />,
      disabled: !state.canSplit,
      separatorBefore: true,
    },
    {
      id: "split-down",
      label: t("shell.button.tab-split-down"),
      leading: <MenuIcon icon={shellIcons.splitDown} />,
      disabled: !state.canSplit,
    },
  ];
  if (state.stacked === true) {
    items.push({
      id: "unstack",
      label: t("shell.button.tab-unstack"),
      leading: <MenuIcon icon={shellIcons.splitRemove} />,
    });
  }
  if (state.group >= 3) {
    items.push({
      id: "split-remove",
      label: t("shell.button.tab-split-remove"),
      leading: <MenuIcon icon={shellIcons.splitRemove} />,
    });
  }
  if (state.group >= 2) {
    items.push({
      id: "unsplit",
      label: t(
        state.group >= 3
          ? "shell.button.tab-unsplit-all"
          : "shell.button.tab-unsplit",
      ),
      leading: <MenuIcon icon={shellIcons.unsplit} />,
    });
  }
  return items;
}

/**
 * `extra`는 탭 본문이 올린 맨 위 묶음(card-head.tsx)이고 기본 항목과 구분선으로 나뉜다. `label`은 binding id의
 * 키 이름(`useKeyLabel`)이고 주면 키가 있는 기본 항목이 `shortcut`을 단다.
 */
export function tabMenuItems(
  state: TabMenuState,
  extra: readonly MenuItem[] = [],
  label?: (bindingId: string) => string | null,
): MenuItem[] {
  const items = baseItems(state).map((item) => {
    const key = label?.(TAB_BINDING[item.id as TabAction]);
    return key == null ? item : { ...item, shortcut: key };
  });
  return extra.length === 0
    ? items
    : [...extra, { ...items[0]!, separatorBefore: true }, ...items.slice(1)];
}

function baseItems(state: TabMenuState): MenuItem[] {
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
    ...(state.stacked === true
      ? [
          {
            id: "close-pane-others",
            label: t("shell.button.tab-close-pane-others"),
            leading: <MenuIcon icon={workspaceIcons.closePaneOthers} />,
          },
        ]
      : []),
    ...(state.group >= 2
      ? [
          {
            id: "close-group",
            label: t("shell.button.tab-close-group"),
            leading: <MenuIcon icon={workspaceIcons.closeGroup} />,
          },
        ]
      : []),
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
  const label = useKeyLabel();
  return (
    <Menu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      trigger={
        <span className={styles.anchor} style={{ left: at.x, top: at.y }} />
      }
      items={tabMenuItems(state, [], label)}
      onSelect={(id) => {
        onSelect(id as TabAction);
        onClose();
      }}
    />
  );
}
