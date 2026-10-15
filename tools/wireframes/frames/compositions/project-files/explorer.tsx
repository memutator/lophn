// project sidebar의 Explorer 쪽 부품. 확장자·폴더별 아이콘이 붙는 파일 tree, 연결 폴더(루트)를 고르는 menu,
// Explorer · Context · Agent를 가르는 segmented toggle. 설계 Tree는 행에 아이콘을 못 달아서 같은 CSS Module로 다시 짠 look-alike다.
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  FileIcon,
  Icon,
  iconPixels,
  Menu,
  TabStrip,
  type TreeNode,
} from "@lophn/design/components";

import { visibleRows } from "../../../../../packages/design/components/tree/model.ts";
import treeStyles from "../../../../../packages/design/components/tree/tree.module.css";
import { type FileRoot, ROOTS } from "./file-data.ts";
import styles from "./files.module.css";

export type SidebarMode = "explorer" | "context" | "agent";

const MODES: readonly { id: SidebarMode; label: string }[] = [
  { id: "explorer", label: "Explorer" },
  { id: "context", label: "Context" },
  { id: "agent", label: "Agent" },
];

/** 한 번에 하나만 보이는 세 모양을 가르는 줄. 공용 TabStrip과 같은 밑줄 글자 탭이다. */
export function ModeToggle(
  { mode, onMode }: { mode: SidebarMode; onMode: (mode: SidebarMode) => void },
) {
  return (
    <TabStrip
      compact
      tabs={MODES.map((item) => ({ key: item.id, title: item.label }))}
      selected={mode}
      onSelect={(key) => onMode(key as SidebarMode)}
    />
  );
}

/** 파일과 폴더 행에 FileIcon을 단 tree. 가지는 눌러 펴고 접고, 파일은 누르면 연다. */
export function FileTree(
  { nodes, expanded, onToggle, currentId, selectedId, onOpen, label }: {
    nodes: readonly TreeNode[];
    expanded: ReadonlySet<string>;
    onToggle: (id: string) => void;
    currentId?: string;
    /** 오른쪽 클릭 메뉴가 열린 행. 배경으로 보인다. */
    selectedId?: string;
    onOpen: (id: string) => void;
    label: string;
  },
) {
  return (
    <div role="tree" aria-label={label} className={treeStyles.tree}>
      {visibleRows(nodes, expanded).map((row) => (
        <div
          key={row.id}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.branch ? row.expanded : undefined}
          aria-current={row.id === currentId ? "page" : undefined}
          tabIndex={-1}
          data-current={row.id === currentId || undefined}
          data-selected={row.id === selectedId || undefined}
          className={treeStyles.row}
          onClick={() => (row.branch ? onToggle(row.id) : onOpen(row.id))}
        >
          {row.id === currentId && <span className={treeStyles.marker} />}
          {Array.from(
            { length: row.indent },
            (_, step) => <span key={step} className={treeStyles.indent} />,
          )}
          <span className={treeStyles.twisty}>
            {row.branch && (
              <Icon
                icon={row.expanded ? ChevronDown : ChevronRight}
                pixels={iconPixels("small")}
              />
            )}
          </span>
          <span className={styles.treeIcon}>
            <FileIcon
              name={row.label}
              folder={row.branch}
              open={row.expanded}
            />
          </span>
          <span className={treeStyles.label}>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function rootLabel(root: FileRoot): ReactNode {
  return (
    <span className={styles.rootLabel}>
      <span className={styles.rootName}>
        {root.parent === undefined
          ? root.label
          : `${root.parent} / ${root.label}`}
      </span>
      <span className={styles.rootPath}>{root.path}</span>
    </span>
  );
}

/** tree 머리. 연결한 폴더나 그 하위 폴더 가운데 어느 것을 루트로 볼지 고른다. */
export function RootPicker(
  { root, onRoot, open, onOpenChange }: {
    root: FileRoot;
    onRoot: (root: FileRoot) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  },
) {
  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          className={styles.rootHead}
          aria-label="Root folder"
        >
          <Icon icon={ChevronDown} pixels={iconPixels("small")} />
          <span className={styles.rootTitle}>
            {root.parent === undefined
              ? root.label
              : `${root.parent} / ${root.label}`}
          </span>
        </button>
      }
      items={ROOTS.map((item) => ({
        id: item.id,
        textValue: item.label,
        label: rootLabel(item),
        leading: <FileIcon name={item.label} folder />,
      }))}
      onSelect={(id) => {
        const next = ROOTS.find((item) => item.id === id);
        if (next) onRoot(next);
      }}
    />
  );
}
