// 바뀐 파일 목록: Conflicts·Staged Changes·Changes 묶음, flat/tree 보기, 파일·디렉터리·묶음 단위 조작, 오른쪽 클릭 menu.
// 한 번 누르면 git_diff preview 탭, 두 번 누르거나 Enter면 고정 탭이다. hunk 단위 조작은 없다(정한 것 13).
import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { FileIcon, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import type { SourceControlFile } from "../../../../protocol/projects/source-control.ts";
import {
  editorIcons,
  sourceControlIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import {
  baseName,
  buildTree,
  dirName,
  isDeleteConflict,
  letterOf,
  type Section,
  type TreeNode,
} from "./model.ts";
import type { ChangesView } from "./store.ts";
import styles from "./source-control.module.css";

export type FileAction =
  | "stage"
  | "unstage"
  | "discard"
  | "open-file"
  | "open-diff"
  | "open-diff-keep"
  | "mark-resolved"
  | "keep-file"
  | "keep-deletion"
  | "copy-path"
  | "copy-relative-path"
  | "reveal-explorer"
  | "reveal-os";

export interface ChangesProps {
  readonly section: Section;
  readonly files: readonly SourceControlFile[];
  readonly view: ChangesView;
  readonly readOnly: boolean;
  readonly closedDirs: ReadonlySet<string>;
  readonly onToggleDir: (key: string) => void;
  /** OS 파일 관리자(이 컴퓨터만). */
  readonly canRevealOs: boolean;
  readonly onAction: (
    action: FileAction,
    files: readonly SourceControlFile[],
    section: Section,
  ) => void;
}

const LETTER_TONE: Record<string, string> = {
  M: "modified",
  A: "added",
  U: "added",
  D: "deleted",
  R: "renamed",
  C: "conflicted",
};

function StatBadge({
  file,
  section,
}: {
  file: SourceControlFile;
  section: Section;
}) {
  const stat = section === "staged" ? file.staged_stat : file.unstaged_stat;
  if (stat === null || stat === undefined) return null;
  return (
    <span className={styles.stat}>
      {stat.additions > 0 ? (
        <span className={styles.statAdd}>+{stat.additions}</span>
      ) : null}
      {stat.deletions > 0 ? (
        <span className={styles.statDel}>-{stat.deletions}</span>
      ) : null}
    </span>
  );
}

function hoverActions(section: Section, conflict: boolean) {
  if (section === "conflicts") {
    return conflict
      ? (["keep-file", "keep-deletion"] as const)
      : (["open-file", "mark-resolved"] as const);
  }
  return section === "staged"
    ? (["open-file", "unstage"] as const)
    : (["open-file", "discard", "stage"] as const);
}

const ACTION_ICON = {
  stage: sourceControlIcons.stage,
  unstage: sourceControlIcons.unstage,
  discard: sourceControlIcons.discard,
  "open-file": editorIcons.edit,
  "mark-resolved": sourceControlIcons.resolved,
  "keep-file": sourceControlIcons.stage,
  "keep-deletion": workspaceIcons.trash,
} as const;

const ACTION_LABEL = {
  stage: "source-control.button.stage",
  unstage: "source-control.button.unstage",
  discard: "source-control.button.discard",
  "open-file": "source-control.button.open-file",
  "mark-resolved": "source-control.button.mark-resolved",
  "keep-file": "source-control.button.keep-file",
  "keep-deletion": "source-control.button.keep-deletion",
} as const;

const WRITES = new Set<FileAction>([
  "stage",
  "unstage",
  "discard",
  "mark-resolved",
  "keep-file",
  "keep-deletion",
]);

export function Changes(props: ChangesProps) {
  const [menu, setMenu] = useState<{
    files: readonly SourceControlFile[];
    folder: boolean;
    x: number;
    y: number;
  } | null>(null);
  const { section, readOnly, onAction } = props;

  const openMenu = (
    event: MouseEvent,
    files: readonly SourceControlFile[],
    folder: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ files, folder, x: event.clientX, y: event.clientY });
  };

  const menuItems = (
    files: readonly SourceControlFile[],
    folder: boolean,
  ): MenuItem[] => {
    const one = files.length === 1 && !folder;
    const conflict = files.some((file) => isDeleteConflict(file));
    const writes: MenuItem[] = readOnly
      ? []
      : section === "conflicts"
        ? [
            {
              id: "mark-resolved",
              label: t("source-control.button.mark-resolved"),
              leading: <MenuIcon icon={sourceControlIcons.resolved} />,
            },
            ...(conflict
              ? [
                  {
                    id: "keep-file",
                    label: t("source-control.button.keep-file"),
                  },
                  {
                    id: "keep-deletion",
                    label: t("source-control.button.keep-deletion"),
                  },
                ]
              : []),
          ]
        : section === "staged"
          ? [
              {
                id: "unstage",
                label: t("source-control.button.unstage"),
                leading: <MenuIcon icon={sourceControlIcons.unstage} />,
              },
            ]
          : [
              {
                id: "stage",
                label: t("source-control.button.stage"),
                leading: <MenuIcon icon={sourceControlIcons.stage} />,
              },
              {
                id: "discard",
                label: t("source-control.button.discard"),
                leading: <MenuIcon icon={sourceControlIcons.discard} />,
              },
            ];
    return [
      ...(one
        ? [
            {
              id: section === "conflicts" ? "open-file" : "open-diff-keep",
              label:
                section === "conflicts"
                  ? t("source-control.button.open-in-editor")
                  : t("source-control.button.open-diff"),
            },
            ...(section === "conflicts"
              ? []
              : [
                  {
                    id: "open-file",
                    label: t("source-control.button.open-file"),
                  },
                ]),
          ]
        : []),
      ...writes.map((item, at) =>
        at === 0 && one ? { ...item, separatorBefore: true } : item,
      ),
      {
        id: "copy-path",
        label: t("source-control.button.copy-path"),
        leading: <MenuIcon icon={workspaceIcons.copy} />,
        separatorBefore: true,
      },
      {
        id: "copy-relative-path",
        label: t("source-control.button.copy-relative-path"),
      },
      ...(one
        ? [
            {
              id: "reveal-explorer",
              label: t("source-control.button.reveal-explorer"),
            },
            ...(props.canRevealOs
              ? [
                  {
                    id: "reveal-os",
                    label: t("project-workspace.button.explorer-reveal"),
                    leading: <MenuIcon icon={workspaceIcons.revealInFiles} />,
                  },
                ]
              : []),
          ]
        : []),
    ];
  };

  const fileRow = (file: SourceControlFile, depth: number): ReactNode => {
    const letter = letterOf(file, section);
    const name = baseName(file.path);
    const dir = dirName(file.path);
    const actions = hoverActions(section, isDeleteConflict(file)).filter(
      (action) => !readOnly || !WRITES.has(action),
    );
    return (
      <div
        key={`${section}:${file.path}`}
        role="treeitem"
        tabIndex={0}
        aria-selected={false}
        className={styles.fileRow}
        style={{
          paddingLeft: `calc(var(--space-2) + ${depth} * var(--tree-indent))`,
        }}
        data-sc-file={file.path}
        data-sc-section={section}
        aria-label={
          file.orig_path === undefined
            ? file.path
            : `${file.orig_path} → ${file.path}`
        }
        onClick={() =>
          onAction(
            section === "conflicts" ? "open-file" : "open-diff",
            [file],
            section,
          )
        }
        onDoubleClick={() =>
          onAction(
            section === "conflicts" ? "open-file" : "open-diff-keep",
            [file],
            section,
          )
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onAction(
              section === "conflicts" ? "open-file" : "open-diff-keep",
              [file],
              section,
            );
          }
        }}
        onContextMenu={(event) => openMenu(event, [file], false)}
      >
        <span className={styles.fileIcon}>
          <FileIcon name={name} size={14} />
        </span>
        <span
          className={styles.fileName}
          data-deleted={letter === "D" || undefined}
        >
          {name}
        </span>
        {props.view === "flat" && dir !== "" ? (
          <span className={styles.fileDir}>{dir}</span>
        ) : (
          <span className={styles.fileDir} />
        )}
        <span className={styles.rowActions}>
          {actions.map((action) => (
            <IconButton
              key={action}
              size="sm"
              icon={ACTION_ICON[action]}
              label={t(ACTION_LABEL[action])}
              data-sc-action={action}
              onClick={(event) => {
                event.stopPropagation();
                onAction(action, [file], section);
              }}
            />
          ))}
        </span>
        <StatBadge file={file} section={section} />
        <span className={styles.letter} data-tone={LETTER_TONE[letter]}>
          {letter}
        </span>
      </div>
    );
  };

  const dirRow = (node: Extract<TreeNode, { kind: "dir" }>, depth: number) => {
    const key = `${section}:${node.path}`;
    const open = !props.closedDirs.has(key);
    const writes: ("stage" | "unstage" | "discard")[] = readOnly
      ? []
      : section === "staged"
        ? ["unstage"]
        : section === "changes"
          ? ["discard", "stage"]
          : [];
    return [
      <div
        key={`dir:${key}`}
        role="treeitem"
        tabIndex={0}
        aria-selected={false}
        aria-expanded={open}
        className={styles.fileRow}
        style={{
          paddingLeft: `calc(var(--space-2) + ${depth} * var(--tree-indent))`,
        }}
        data-sc-dir={node.path}
        onClick={() => props.onToggleDir(key)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onToggleDir(key);
          }
        }}
        onContextMenu={(event) => openMenu(event, node.files, true)}
      >
        <span className={styles.fileIcon}>
          <Icon
            icon={open ? ChevronDown : ChevronRight}
            pixels={iconPixels("small")}
          />
        </span>
        <span className={styles.fileName}>{node.name}</span>
        <span className={styles.fileDir} />
        <span className={styles.rowActions}>
          {writes.map((action) => (
            <IconButton
              key={action}
              size="sm"
              icon={ACTION_ICON[action]}
              label={t(ACTION_LABEL[action])}
              onClick={(event) => {
                event.stopPropagation();
                onAction(action, node.files, section);
              }}
            />
          ))}
        </span>
      </div>,
      ...(open
        ? node.children.flatMap((child) => nodeRows(child, depth + 1))
        : []),
    ];
  };

  const nodeRows = (node: TreeNode, depth: number): ReactNode[] =>
    node.kind === "file" ? [fileRow(node.file, depth)] : dirRow(node, depth);

  const rows =
    props.view === "flat"
      ? props.files.map((file) => fileRow(file, 0))
      : buildTree(props.files).flatMap((node) => nodeRows(node, 0));

  return (
    <div role="tree" className={styles.fileList} data-sc-list={section}>
      {rows}
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
          items={menuItems(menu.files, menu.folder)}
          returnFocus={false}
          onSelect={(id) => {
            const files = menu.files;
            setMenu(null);
            onAction(id as FileAction, files, section);
          }}
        />
      )}
    </div>
  );
}
