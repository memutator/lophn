// project sidebar의 Explorer 쪽: 루트 머리(연결 폴더·하위 폴더 고르기, 새 파일·새 폴더·Refresh·Collapse All 단추)와
// 종류 아이콘이 붙은 파일 tree. VS Code Explorer처럼 새 파일·폴더와 이름 바꾸기는 tree 안 입력으로 하고, 지우기는
// OS 휴지통으로 보내며, 끌어 옮기기와 오른쪽 클릭 menu, 키보드 이동, 열린 탭 자동 드러내기가 있다.
// 디스크를 바꾸는 일은 source가 하고, 열린 탭을 정리해야 하는 이름 바꾸기·옮기기·지우기는 부르는 쪽(onMove, onTrash)이 한다.
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import { FileIcon, Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import { editorIcons, workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { FileConfirm } from "../file-actions.tsx";
import type {
  FileOpResult,
  ProjectFolderView,
  WorkspaceSource,
} from "../source.ts";
import { checkNewName, checkRename, renameRange } from "./explorer-names.ts";
import { NameRow, Row } from "./explorer-row.tsx";
import {
  type FileRow,
  joinPath,
  parentOf,
  useFileTree,
} from "./use-file-tree.ts";
import styles from "./project-sidebar.module.css";

/** 열린 탭을 정리하는 쪽의 답. 사람이 저장 안 된 탭을 닫지 않기로 하면 cancelled다. */
export type TabAwareResult =
  | FileOpResult
  | { readonly ok: false; readonly code: "cancelled" };

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

const contains = (folder: string, path: string) =>
  path.startsWith(`${folder.replace(/\/+$/, "")}/`);

/** tree 머리 왼쪽. `▾ PHRONER`를 누르면 연결 폴더와 하위 폴더 가운데 루트를 고른다. */
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

/** 머리에 마우스를 올리거나 focus가 들어오면 보이는 단추 넷. */
function HeadActions(
  { disabled, onNewFile, onNewFolder, onRefresh, onCollapseAll }: {
    disabled: boolean;
    onNewFile: () => void;
    onNewFolder: () => void;
    onRefresh: () => void;
    onCollapseAll: () => void;
  },
) {
  const actions = [
    {
      key: "new-file",
      icon: workspaceIcons.newFile,
      label: t("project-workspace.button.explorer-new-file"),
      run: onNewFile,
    },
    {
      key: "new-folder",
      icon: workspaceIcons.newFolder,
      label: t("project-workspace.button.explorer-new-folder"),
      run: onNewFolder,
    },
    {
      key: "refresh",
      icon: workspaceIcons.refresh,
      label: t("project-workspace.button.explorer-refresh"),
      run: onRefresh,
    },
    {
      key: "collapse-all",
      icon: workspaceIcons.collapseAll,
      label: t("project-workspace.button.explorer-collapse-all"),
      run: onCollapseAll,
    },
  ] as const;
  return (
    <div
      className={styles.headActions}
      role="toolbar"
      aria-label={t("project-workspace.label.explorer-actions")}
    >
      {actions.map((action) => (
        <Tooltip key={action.key} content={action.label}>
          <IconButton
            size="sm"
            icon={action.icon}
            label={action.label}
            disabled={disabled}
            data-explorer-action={action.key}
            onClick={action.run}
          />
        </Tooltip>
      ))}
    </div>
  );
}

type Draft =
  | { readonly kind: "file" | "folder"; readonly parent: string }
  | {
    readonly kind: "rename";
    readonly path: string;
    readonly folder: boolean;
  };

type Dialog =
  | {
    readonly kind: "trash";
    readonly path: string;
    readonly folder: boolean;
    readonly failed: boolean;
  }
  | {
    readonly kind: "move";
    readonly from: string;
    readonly toDir: string;
    readonly error: "exists" | "failed" | null;
  };

interface ExplorerProps {
  source: WorkspaceSource;
  folders: readonly ProjectFolderView[];
  /** 지금 편집기에서 열려 있는 파일의 절대 경로. 바뀌면 tree가 그 파일을 펼쳐 고른다. */
  current?: string | null;
  onOpenFile: (path: string) => void;
  /** 방금 만든 파일을 고정 tab으로 연다. */
  onOpenPinned: (path: string) => void;
  /** 이름 바꾸기와 옮기기. 열린 탭의 경로를 따라 바꾸는 일까지 한다. */
  onMove: (from: string, to: string) => Promise<TabAwareResult>;
  /** 휴지통으로 보내기. 열린 탭을 닫는 일까지 한다. */
  onTrash: (path: string) => Promise<TabAwareResult>;
}

const PENDING_MS = 2000;

export function Explorer(
  {
    source,
    folders,
    current = null,
    onOpenFile,
    onOpenPinned,
    onMove,
    onTrash,
  }: ExplorerProps,
): ReactNode {
  const roots = rootChoices(folders);
  // 고른 루트는 화면 상태일 뿐이라 저장하지 않는다. 처음은 첫 연결 폴더다.
  const [chosen, setChosen] = useState<string | null>(null);
  const root = roots.find((item) => item.path === chosen) ?? roots[0];
  const tree = useFileTree(source, root?.found ? root.path : null);
  const [selection, setSelection] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<
    { target: FileRow | null; x: number; y: number } | null
  >(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);
  // 다음 render에 줄이 생기면 보이게 하고(선택적으로 focus도) 비운다. 줄이 늦게 생겨도 잠시 기다린다.
  const goal = useRef<{ id: string; focus: boolean; until: number } | null>(
    null,
  );
  const typed = useRef({ text: "", at: 0 });

  const rowElement = (id: string) =>
    [
      ...treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ??
        [],
    ]
      .find((element) => element.dataset.file === id);
  const show = (id: string, focus: boolean) => {
    goal.current = { id, focus, until: Date.now() + PENDING_MS };
  };
  useEffect(() => {
    const wanted = goal.current;
    if (wanted === null) return;
    if (Date.now() > wanted.until) {
      goal.current = null;
      return;
    }
    const element = rowElement(wanted.id);
    if (element === undefined) return;
    goal.current = null;
    if (wanted.focus) element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "nearest" });
  });

  // 고른 탭의 파일을 tree에서 펼쳐 고른다. 다른 연결 폴더의 파일이면 그 폴더로 루트를 옮긴다.
  useEffect(() => {
    if (current === null || root === undefined) return;
    if (!contains(root.path, current)) {
      const owner = roots.find((item) => contains(item.path, current));
      if (owner !== undefined) setChosen(owner.path);
      return;
    }
    tree.reveal(current);
    setSelection(current);
    show(current, false);
  }, [current, root?.path]);

  if (root === undefined) return null;

  const rowOf = (id: string | null) =>
    tree.rows.find((row) => row.id === id) ?? null;
  const selectedRow = rowOf(selection);
  /** 새로 만들 자리: 고른 폴더, 파일이면 그 파일의 폴더, 아무것도 없으면 루트. */
  const targetFolder = (row: FileRow | null) =>
    row === null ? root.path : row.folder ? row.id : parentOf(row.id);

  const activate = (row: FileRow) => {
    setSelection(row.id);
    if (row.folder) tree.toggle(row.id);
    else onOpenFile(row.id);
  };

  const focusRow = (row: FileRow | undefined) => {
    if (row === undefined) return;
    setSelection(row.id);
    rowElement(row.id)?.focus();
  };

  // ---- 새 파일·새 폴더·이름 바꾸기 ----

  const startCreate = (kind: "file" | "folder", row: FileRow | null) => {
    const parent = targetFolder(row);
    if (parent !== root.path) tree.expand(parent);
    setDraft({ kind, parent });
  };
  const startRename = (row: FileRow) =>
    setDraft({ kind: "rename", path: row.id, folder: row.folder });

  const finishDraft = (restore: string | null) => {
    setDraft(null);
    if (restore !== null) show(restore, true);
  };

  const submitCreate = async (
    d: Extract<Draft, { kind: "file" | "folder" }>,
    value: string,
  ): Promise<string | null> => {
    const check = checkNewName(value, d.parent, tree.entriesOf);
    const path = joinPath(d.parent, check.parts.join("/"));
    const result = await source.create(path, d.kind);
    if (!result.ok) {
      return result.code === "conflict"
        ? t("project-workspace.error.explorer-name-exists", { name: value })
        : result.code === "invalid_input"
        ? t("project-workspace.error.explorer-name-invalid", { name: value })
        : t("project-workspace.error.explorer-action-failed");
    }
    tree.reveal(path);
    tree.refresh();
    setSelection(path);
    // 새 파일은 편집기가 focus를 받는다. 폴더만 tree에서 이어 간다.
    finishDraft(d.kind === "folder" ? path : null);
    if (d.kind === "file") {
      show(path, false);
      onOpenPinned(path);
    }
    return null;
  };

  const submitRename = async (
    d: Extract<Draft, { kind: "rename" }>,
    value: string,
  ): Promise<string | null> => {
    const name = value.trim();
    if (name === d.path.slice(d.path.lastIndexOf("/") + 1)) {
      finishDraft(d.path);
      return null;
    }
    const to = joinPath(parentOf(d.path), name);
    const result = await onMove(d.path, to);
    if (result.ok) {
      tree.refresh();
      setSelection(to);
      finishDraft(to);
      return null;
    }
    if (result.code === "cancelled") {
      finishDraft(d.path);
      return null;
    }
    return result.code === "conflict"
      ? t("project-workspace.error.explorer-name-exists", { name })
      : result.code === "invalid_input"
      ? t("project-workspace.error.explorer-name-invalid", { name })
      : t("project-workspace.error.explorer-action-failed");
  };

  const problemOf = (d: Draft) => (value: string): string | null => {
    if (value.trim() === "") return null;
    const check = d.kind === "rename"
      ? checkRename(value, d.path, tree.entriesOf)
      : checkNewName(value, d.parent, tree.entriesOf);
    return check.problem === "exists"
      ? t("project-workspace.error.explorer-name-exists", {
        name: value.trim(),
      })
      : check.problem === "invalid"
      ? t("project-workspace.error.explorer-name-invalid", {
        name: value.trim(),
      })
      : null;
  };

  const nameRow = (d: Draft, depth: number) => {
    const folder = d.kind === "rename" ? d.folder : d.kind === "folder";
    const initial = d.kind === "rename"
      ? d.path.slice(d.path.lastIndexOf("/") + 1)
      : "";
    return (
      <NameRow
        key={d.kind === "rename" ? `rename:${d.path}` : `new:${d.parent}`}
        depth={depth}
        folder={folder}
        initial={initial}
        range={renameRange(initial, folder)}
        problem={problemOf(d)}
        onSubmit={(value) =>
          d.kind === "rename" ? submitRename(d, value) : submitCreate(d, value)}
        onCancel={(reason) =>
          finishDraft(
            reason === "escape"
              ? d.kind === "rename" ? d.path : selection
              : null,
          )}
      />
    );
  };

  // ---- 휴지통 ----

  const askTrash = (row: FileRow) =>
    setDialog({
      kind: "trash",
      path: row.id,
      folder: row.folder,
      failed: false,
    });

  const confirmTrash = async (path: string) => {
    // 지운 줄 다음(없으면 앞) 줄로 focus를 옮긴다.
    const at = tree.rows.findIndex((row) => row.id === path);
    const next = tree.rows[at + 1] ?? tree.rows[at - 1];
    const result = await onTrash(path);
    if (result.ok || result.code === "cancelled") {
      setDialog(null);
      if (result.ok) {
        tree.refresh();
        setSelection(null);
        if (next !== undefined) show(next.id, true);
      }
    } else if (dialog?.kind === "trash") {
      setDialog({ ...dialog, failed: true });
    }
  };

  // ---- 끌어 옮기기 ----

  /** 놓을 수 있는 자리인가: 같은 폴더(변화 없음)나 자기 안은 아니다. */
  const droppable = (from: string | null, toDir: string) =>
    from !== null && parentOf(from) !== toDir && from !== toDir &&
    !contains(from, toDir);

  const dropDirOf = (row: FileRow | null) => targetFolder(row);

  const onDragStart = (row: FileRow, event: DragEvent<HTMLDivElement>) => {
    dragging.current = row.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.id);
  };
  const onDragOver = (row: FileRow | null, event: DragEvent<HTMLElement>) => {
    // 줄 위에서는 바깥(빈 자리 = 루트)으로 새지 않게 한다.
    if (row !== null) event.stopPropagation();
    const toDir = dropDirOf(row);
    if (!droppable(dragging.current, toDir)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(toDir);
  };
  const onDrop = (row: FileRow | null, event: DragEvent<HTMLElement>) => {
    if (row !== null) event.stopPropagation();
    const from = dragging.current;
    const toDir = dropDirOf(row);
    dragging.current = null;
    setDropTarget(null);
    if (!droppable(from, toDir) || from === null) return;
    event.preventDefault();
    const name = from.slice(from.lastIndexOf("/") + 1);
    // 이미 읽은 폴더에 같은 이름이 보이면 묻지 않고 거절한다. 안 읽었으면 main이 거절한다.
    const exists = tree.entriesOf(toDir)?.some((entry) => entry.name === name);
    setDialog({
      kind: "move",
      from,
      toDir,
      error: exists === true ? "exists" : null,
    });
  };

  const confirmMove = async (d: Extract<Dialog, { kind: "move" }>) => {
    const to = joinPath(d.toDir, d.from.slice(d.from.lastIndexOf("/") + 1));
    const result = await onMove(d.from, to);
    if (result.ok) {
      setDialog(null);
      if (d.toDir !== root.path) tree.expand(d.toDir);
      tree.refresh();
      setSelection(to);
      show(to, false);
    } else if (result.code === "cancelled") setDialog(null);
    else {
      setDialog({
        ...d,
        error: result.code === "conflict" ? "exists" : "failed",
      });
    }
  };

  // ---- 오른쪽 클릭 menu ----

  const relativePath = (path: string) => {
    const owner = folders
      .filter((folder) => path === folder.path || contains(folder.path, path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return owner === undefined || path === owner.path
      ? path.slice(path.lastIndexOf("/") + 1)
      : path.slice(owner.path.replace(/\/+$/, "").length + 1);
  };

  const menuItems = (target: FileRow | null): MenuItem[] => [
    {
      id: "new-file",
      label: t("project-workspace.button.explorer-new-file"),
      leading: <MenuIcon icon={workspaceIcons.newFile} />,
    },
    {
      id: "new-folder",
      label: t("project-workspace.button.explorer-new-folder"),
      leading: <MenuIcon icon={workspaceIcons.newFolder} />,
    },
    {
      id: "reveal",
      label: t("project-workspace.button.explorer-reveal"),
      leading: <MenuIcon icon={workspaceIcons.revealInFiles} />,
      separatorBefore: true,
    },
    {
      id: "copy-path",
      label: t("project-workspace.button.explorer-copy-path"),
      leading: <MenuIcon icon={workspaceIcons.copy} />,
      separatorBefore: true,
    },
    {
      id: "copy-relative-path",
      label: t("project-workspace.button.explorer-copy-relative-path"),
      leading: <MenuIcon icon={workspaceIcons.copy} />,
    },
    ...(target === null ? [] : [
      {
        id: "rename",
        label: t("project-workspace.button.explorer-rename"),
        leading: <MenuIcon icon={editorIcons.edit} />,
        separatorBefore: true,
      },
      {
        id: "delete",
        label: t("project-workspace.button.explorer-delete"),
        leading: <MenuIcon icon={workspaceIcons.trash} />,
      },
    ]),
  ];

  const runMenu = (id: string, target: FileRow | null) => {
    const path = target?.id ?? root.path;
    if (id === "new-file" || id === "new-folder") {
      startCreate(id === "new-file" ? "file" : "folder", target);
    } else if (id === "reveal") void source.reveal(path);
    else if (id === "copy-path") void systemClipboard.writeText(path);
    else if (id === "copy-relative-path") {
      void systemClipboard.writeText(relativePath(path));
    } else if (target !== null && id === "rename") startRename(target);
    else if (target !== null && id === "delete") askTrash(target);
  };

  // ---- 키보드 ----

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="treeitem"]',
    );
    const at = tree.rows.findIndex((row) => row.id === element?.dataset.file);
    const row = tree.rows[at];
    const key = event.key;
    if (event.altKey || event.ctrlKey) return;
    if (key === "Delete" || (key === "Backspace" && event.metaKey)) {
      if (row !== undefined) askTrash(row);
      else return;
    } else if (event.metaKey) return;
    else if (key === "F2") {
      if (row !== undefined) startRename(row);
      else return;
    } else if (key === "ArrowDown") {
      focusRow(tree.rows[at < 0 ? 0 : at + 1]);
    } else if (key === "ArrowUp") {
      focusRow(tree.rows[at < 0 ? tree.rows.length - 1 : at - 1]);
    } else if (key === "Home") focusRow(tree.rows[0]);
    else if (key === "End") focusRow(tree.rows.at(-1));
    else if (key === "ArrowRight") {
      if (row === undefined || !row.folder) return;
      if (!row.expanded) tree.expand(row.id);
      else if (tree.rows[at + 1]?.depth === row.depth + 1) {
        focusRow(tree.rows[at + 1]);
      }
    } else if (key === "ArrowLeft") {
      if (row === undefined) return;
      if (row.folder && row.expanded) tree.collapse(row.id);
      else focusRow(rowOf(parentOf(row.id)) ?? undefined);
    } else if (key === "Enter" || key === " ") {
      if (row === undefined) return;
      activate(row);
    } else if (key.length === 1 && row !== undefined) {
      const now = Date.now();
      const text = (now - typed.current.at > 700 ? "" : typed.current.text) +
        key.toLowerCase();
      typed.current = { text, at: now };
      // 같은 글자를 거듭 치면 그 글자로 시작하는 다음 줄로 돈다.
      const same = [...text].every((char) => char === text[0]);
      const needle = same ? text[0] : text;
      const start = same ? at + 1 : at;
      const count = tree.rows.length;
      for (let step = 0; step < count; step += 1) {
        const hit = tree.rows[(start + step) % count];
        if (hit.name.toLowerCase().startsWith(needle)) {
          focusRow(hit);
          break;
        }
      }
    } else return;
    event.preventDefault();
  };

  // ---- 그리기 ----

  const createAt = draft !== null && draft.kind !== "rename" ? draft : null;
  const items: ReactNode[] = [];
  if (createAt?.parent === root.path) items.push(nameRow(createAt, 0));
  const tabStop = selectedRow?.id ?? tree.rows[0]?.id;
  for (const row of tree.rows) {
    if (draft?.kind === "rename" && draft.path === row.id) {
      items.push(nameRow(draft, row.depth));
      continue;
    }
    items.push(
      <Row
        key={row.id}
        row={row}
        current={row.id === current}
        selected={row.id === selection}
        dropping={row.id === dropTarget}
        tabStop={row.id === tabStop}
        onActivate={activate}
        onSelect={(one) => setSelection(one.id)}
        onMenu={(one, at) => {
          setSelection(one.id);
          setMenu({ target: one, ...at });
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={() => {
          dragging.current = null;
          setDropTarget(null);
        }}
      />,
    );
    if (createAt?.parent === row.id && row.expanded) {
      items.push(nameRow(createAt, row.depth + 1));
    }
  }

  const trash = dialog?.kind === "trash" ? dialog : null;
  const move = dialog?.kind === "move" ? dialog : null;
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

  return (
    <section className={styles.section} data-explorer="">
      <div className={styles.explorerHead}>
        <RootPicker roots={roots} root={root} onRoot={setChosen} />
        <HeadActions
          disabled={!root.found}
          onNewFile={() => startCreate("file", selectedRow)}
          onNewFolder={() => startCreate("folder", selectedRow)}
          onRefresh={tree.refresh}
          onCollapseAll={tree.collapseAll}
        />
      </div>
      <div
        ref={treeRef}
        role="tree"
        aria-label={t("project-workspace.label.files-in", {
          folder: rootTitle(root),
        })}
        className={styles.tree}
        data-drop-root={dropTarget === root.path || undefined}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelection(null);
          setMenu({ target: null, x: event.clientX, y: event.clientY });
        }}
        onDragOver={(event) => onDragOver(null, event)}
        onDrop={(event) => onDrop(null, event)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTarget(null);
          }
        }}
      >
        {items}
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
          items={menuItems(menu.target)}
          // 이름 입력이나 dialog가 곧 focus를 받는다. menu가 trigger로 되돌리면 그것을 빼앗는다.
          returnFocus={false}
          onSelect={(id) => {
            const target = menu.target;
            setMenu(null);
            runMenu(id, target);
          }}
        />
      )}
      {trash === null ? null : (
        <FileConfirm
          title={t("project-workspace.title.explorer-delete", {
            name: nameOf(trash.path),
          })}
          text={trash.failed
            ? t("project-workspace.error.explorer-trash-failed", {
              name: nameOf(trash.path),
            })
            : t(
              trash.folder
                ? "project-workspace.notice.explorer-delete-folder"
                : "project-workspace.notice.explorer-delete-file",
              { name: nameOf(trash.path) },
            )}
          confirm={trash.failed ? null : {
            label: t("project-workspace.button.explorer-trash"),
            danger: true,
          }}
          onConfirm={() => void confirmTrash(trash.path)}
          onClose={() => setDialog(null)}
        />
      )}
      {move === null ? null : (
        <FileConfirm
          title={t("project-workspace.title.explorer-move", {
            name: nameOf(move.from),
          })}
          text={move.error === "exists"
            ? t("project-workspace.error.explorer-move-exists", {
              name: nameOf(move.from),
              folder: nameOf(move.toDir),
            })
            : move.error === "failed"
            ? t("project-workspace.error.explorer-move-failed", {
              name: nameOf(move.from),
            })
            : t("project-workspace.notice.explorer-move", {
              name: nameOf(move.from),
              folder: nameOf(move.toDir),
            })}
          confirm={move.error === null
            ? {
              label: t("project-workspace.button.explorer-move"),
              danger: false,
            }
            : null}
          onConfirm={() => void confirmMove(move)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
