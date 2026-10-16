// project sidebar의 Explorer 쪽: 루트 머리(연결 폴더·하위 폴더 고르기)와 종류 아이콘이 붙은 파일 tree.
// 오른쪽 클릭 menu는 Open·Rename·Delete를 낼 뿐이고 실제 실행은 부르는 쪽이 한다.
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  FileIcon,
  Icon,
  iconPixels,
  Menu,
  MenuIcon,
} from "@lophn/design/components";
import { editorIcons, workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ProjectFolderView, WorkspaceSource } from "../source.ts";
import { type FileRow, useFileTree } from "./use-file-tree.ts";
import styles from "./project-sidebar.module.css";

/** 파일 행의 오른쪽 클릭 menu 항목. Rename·Delete의 실행과 확인은 부르는 쪽이 한다. */
export type FileAction = "open" | "rename" | "delete";

/** tree의 루트가 될 수 있는 폴더: 연결 폴더와 그 하위 폴더. */
interface RootChoice {
  /** 절대 경로. */
  readonly path: string;
  /** 하위 폴더면 속한 연결 폴더의 이름. */
  readonly parent?: string;
  readonly name: string;
  readonly found: boolean;
}

const baseName = (path: string) =>
  path.split("/").filter((part) => part !== "").at(-1) ?? path;

export function rootChoices(
  folders: readonly ProjectFolderView[],
): readonly RootChoice[] {
  return folders.flatMap((folder) => {
    const parent = baseName(folder.path);
    return [
      { path: folder.path, name: parent, found: folder.found },
      ...folder.subfolders.map((sub) => ({
        path: `${folder.path.replace(/\/+$/, "")}/${sub.path}`,
        parent,
        name: baseName(sub.path),
        found: folder.found,
      })),
    ];
  });
}

const rootTitle = (root: RootChoice) =>
  root.parent === undefined ? root.name : `${root.parent} / ${root.name}`;

/** tree 머리. `▾ PHRONER`를 누르면 연결 폴더와 하위 폴더 가운데 루트를 고른다. */
function RootPicker(
  { roots, root, onRoot }: {
    roots: readonly RootChoice[];
    root: RootChoice;
    onRoot: (path: string) => void;
  },
) {
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={styles.rootHead}
          aria-label={t("project-workspace.label.root-folder")}
          data-root-head=""
        >
          <Icon icon={ChevronDown} pixels={iconPixels("small")} />
          <span className={styles.rootTitle}>{rootTitle(root)}</span>
          {root.found
            ? null
            : (
              <span className={styles.rootMissing} data-root-missing="">
                {t("project-workspace.label.folder-missing")}
              </span>
            )}
        </button>
      }
      items={roots.map((item) => ({
        id: item.path,
        textValue: rootTitle(item),
        data: { "data-root": item.path },
        leading: (
          <MenuIcon>
            <FileIcon name={item.name} folder />
          </MenuIcon>
        ),
        label: (
          <span className={styles.rootLabel}>
            <span className={styles.rootName}>{rootTitle(item)}</span>
            <span className={styles.rootPath}>
              {item.found
                ? item.path
                : t("project-workspace.label.folder-missing")}
            </span>
          </span>
        ),
      }))}
      onSelect={onRoot}
    />
  );
}

function Row(
  { row, current, selected, onActivate, onMenu }: {
    row: FileRow;
    current: boolean;
    selected: boolean;
    onActivate: (row: FileRow) => void;
    onMenu: (row: FileRow, at: { x: number; y: number }) => void;
  },
) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      onActivate(row);
    } else if (event.key === "ArrowRight" && row.folder && !row.expanded) {
      onActivate(row);
    } else if (event.key === "ArrowLeft" && row.folder && row.expanded) {
      onActivate(row);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const sibling = event.key === "ArrowDown"
        ? event.currentTarget.nextElementSibling
        : event.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement) sibling.focus();
    } else return;
    event.preventDefault();
  };
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.folder ? row.expanded : undefined}
      aria-current={current ? "page" : undefined}
      tabIndex={0}
      data-file={row.id}
      data-current={current || undefined}
      data-selected={selected || undefined}
      className={styles.treeRow}
      style={{
        paddingLeft: `calc(var(--space-2) + var(--tree-indent) * ${row.depth})`,
      }}
      onClick={() => onActivate(row)}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(row, { x: event.clientX, y: event.clientY });
      }}
    >
      {current && <span className={styles.treeMarker} />}
      <span className={styles.twisty}>
        {row.folder && (
          <Icon
            icon={row.expanded ? ChevronDown : ChevronRight}
            pixels={iconPixels("small")}
          />
        )}
      </span>
      <span className={styles.treeIcon}>
        <FileIcon name={row.name} folder={row.folder} open={row.expanded} />
      </span>
      <span className={styles.treeLabel}>{row.name}</span>
    </div>
  );
}

interface ExplorerProps {
  source: WorkspaceSource;
  folders: readonly ProjectFolderView[];
  /** 지금 편집기에서 열려 있는 파일의 절대 경로. */
  current?: string | null;
  onOpenFile: (path: string) => void;
  onFileAction: (action: FileAction, path: string) => void;
}

export function Explorer(
  { source, folders, current = null, onOpenFile, onFileAction }: ExplorerProps,
): ReactNode {
  const roots = rootChoices(folders);
  // 고른 루트는 화면 상태일 뿐이라 저장하지 않는다. 처음은 첫 연결 폴더다.
  const [chosen, setChosen] = useState<string | null>(null);
  const root = roots.find((item) => item.path === chosen) ?? roots[0];
  const tree = useFileTree(source, root?.found ? root.path : null);
  const [menu, setMenu] = useState<
    { row: FileRow; x: number; y: number } | null
  >(null);
  if (root === undefined) return null;
  const activate = (row: FileRow) => {
    if (row.folder) tree.toggle(row.id);
    else onOpenFile(row.id);
  };
  const items = menu === null ? [] : [
    ...(menu.row.folder ? [] : [{
      id: "open",
      label: t("project-workspace.button.file-open"),
      leading: <MenuIcon icon={editorIcons.read} />,
    }]),
    {
      id: "rename",
      label: t("project-workspace.button.file-rename"),
      leading: <MenuIcon icon={editorIcons.edit} />,
    },
    {
      id: "delete",
      label: t("project-workspace.button.file-delete"),
      leading: <MenuIcon icon={workspaceIcons.trash} />,
    },
  ];
  return (
    <section className={styles.section} data-explorer="">
      <RootPicker roots={roots} root={root} onRoot={setChosen} />
      <div
        role="tree"
        aria-label={t("project-workspace.label.files-in", {
          folder: rootTitle(root),
        })}
        className={styles.tree}
      >
        {tree.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            current={row.id === current}
            selected={menu?.row.id === row.id}
            onActivate={activate}
            onMenu={(target, at) => setMenu({ row: target, ...at })}
          />
        ))}
      </div>
      {tree.failed
        ? (
          <p className={styles.empty} role="alert">
            {t("project-workspace.error.files-failed")}
          </p>
        )
        : null}
      {menu === null ? null : (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          items={items}
          onSelect={(id) => {
            onFileAction(id as FileAction, menu.row.id);
            setMenu(null);
          }}
        />
      )}
    </section>
  );
}
