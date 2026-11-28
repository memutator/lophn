// project sidebar의 Explorer 쪽: 루트 머리(연결 폴더 고르기·더하기·빼기), panel 머리 줄의 단추(새 파일·새 폴더·⋯ 의 Refresh·Collapse All)와
// 종류 아이콘이 붙은 파일 tree. VS Code Explorer처럼 여러 줄을 고르고(Ctrl/Cmd·Shift), 새 파일·폴더와 이름 바꾸기는
// tree 안 입력으로 하며, 지우기·경로 복사·끌어 옮기기는 고른 줄 전부에 한다. 지우기는 OS 휴지통으로 보내고,
// 오른쪽 클릭 menu, 키보드 이동, 열린 탭 자동 드러내기가 있다.
// 디스크를 바꾸는 일은 source가 하고, 열린 탭을 정리해야 하는 이름 바꾸기·옮기기·지우기는 부르는 쪽(onMove, onTrash)이 한다.
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, ClipboardPaste, CopyPlus, Scissors } from "lucide-react";
import { FileIcon, Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import {
  commonIcons,
  editorIcons,
  shellIcons,
  sourceControlIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import { PanelActions, PanelTitle } from "../../shell/right-sidebar.tsx";
import { t } from "@lophn/i18n";

import { PATH_DRAG_TYPE } from "../../path-drag.ts";
import { useMachineGrant } from "../../desktop/machines/context.tsx";
import { FileConfirm } from "../file-actions.tsx";
import { freeName } from "../files/paste-names.ts";
import type {
  FileOpResult,
  ProjectFolderView,
  WorkspaceSource,
} from "../source.ts";
import { checkNewName, checkRename, renameRange } from "./explorer-names.ts";
import { imageNameOf, pathsFromText } from "./explorer-paste.ts";
import { useWorktreeUi } from "../worktrees/context.tsx";
import type { CheckoutRef } from "../worktrees/source.ts";
import { branchLabelOf, changedCountOf } from "../worktrees/use-worktrees.ts";
import type { WorktreeEntry } from "../../../../protocol/projects/worktrees.ts";
import { type BranchRowInfo, NameRow, Row } from "./explorer-row.tsx";
import {
  type ExtraRoot,
  type FileRow,
  joinPath,
  parentOf,
  useFileTree,
} from "./use-file-tree.ts";
import { type GitCheckout, useGitMarks } from "./use-git-marks.ts";
import styles from "./explorer.module.css";

/** 열린 탭을 정리하는 쪽의 답. 사람이 저장 안 된 탭을 닫지 않기로 하면 cancelled다. */
export type TabAwareResult =
  | FileOpResult
  | { readonly ok: false; readonly code: "cancelled" };

/** tree의 루트가 될 수 있는 폴더: 연결 폴더. */
interface RootChoice {
  /** 절대 경로. */
  readonly path: string;
  readonly name: string;
  readonly found: boolean;
}

const baseName = (path: string) =>
  path
    .split("/")
    .filter((part) => part !== "")
    .at(-1) ?? path;

export function rootChoices(
  folders: readonly ProjectFolderView[],
): readonly RootChoice[] {
  return folders.map((folder) => ({
    path: folder.path,
    name: baseName(folder.path),
    found: folder.found,
  }));
}

const contains = (folder: string, path: string) =>
  path.startsWith(`${folder.replace(/\/+$/, "")}/`);

/** 고른 것 가운데 다른 것 안에 든 줄을 뺀다. 위 폴더를 지우거나 옮기면 그 안도 함께 간다. */
const outermost = (paths: readonly string[]) =>
  paths.filter(
    (path) => !paths.some((other) => other !== path && contains(other, path)),
  );

const ADD_FOLDER = "add-folder";
const NEW_WORKTREE = "new-worktree";

/** worktree가 이 등록 폴더에서 났는가. 등록 폴더가 저장소 안쪽 폴더여도 같은 저장소다. */
const bornIn = (entry: WorktreeEntry, folder: string) =>
  entry.record.repo_root === folder ||
  contains(entry.record.repo_root, folder) ||
  contains(folder, entry.record.repo_root);

function branchInfoOf(entry: WorktreeEntry): BranchRowInfo {
  const branch = branchLabelOf(entry);
  const state =
    entry.record.status === "creating" || entry.record.status === "removing"
      ? entry.record.status
      : entry.status.presence === "unmounted"
        ? "unmounted"
        : entry.record.status === "missing" ||
            entry.status.presence === "missing"
          ? "missing"
          : undefined;
  return {
    branch,
    ...(entry.record.label === branch ? {} : { label: entry.record.label }),
    path: entry.record.path,
    changed: changedCountOf(entry.status),
    ...(state === undefined ? {} : { state }),
  };
}

/**
 * tree 머리 왼쪽. `▾ PHRONER`를 누르면 연결 폴더 가운데 루트를 고른다. 행 오른쪽 x는 그 폴더를 project에서 빼고
 * (디스크의 폴더는 그대로), 맨 아래 항목은 폴더를 더한다.
 */
function RootPicker({
  roots,
  root,
  canAdd,
  canRemove,
  onRoot,
  onAdd,
  onRemove,
  onNewWorktree,
}: {
  roots: readonly RootChoice[];
  root: RootChoice;
  canAdd: boolean;
  canRemove: boolean;
  onRoot: (path: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
  /** 고른 루트 폴더에서 worktree 만들기. 없으면 항목이 없다. */
  onNewWorktree?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={styles.rootHead}
          aria-label={t("project-workspace.label.root-folder")}
          data-root-head=""
        >
          <Icon icon={ChevronDown} pixels={iconPixels("small")} />
          <span className={styles.rootTitle}>{root.name}</span>
          {root.found ? null : (
            <span className={styles.rootMissing} data-root-missing="">
              {t("project-workspace.label.folder-missing")}
            </span>
          )}
        </button>
      }
      items={[
        ...roots.map((item) => ({
          id: item.path,
          textValue: item.name,
          data: { "data-root": item.path },
          leading: (
            <MenuIcon>
              <FileIcon name={item.name} folder />
            </MenuIcon>
          ),
          label: (
            <span className={styles.rootLabel}>
              <span className={styles.rootName}>{item.name}</span>
              <span className={styles.rootPath}>
                {item.found
                  ? item.path
                  : t("project-workspace.label.folder-missing")}
              </span>
              {canRemove ? (
                <button
                  type="button"
                  className={styles.rootRemove}
                  aria-label={t("project-workspace.label.remove-folder", {
                    name: item.name,
                  })}
                  data-root-remove={item.path}
                  onClick={(event) => {
                    // 행을 고른 것으로 치지 않는다. menu는 닫고 확인 dialog가 이어서 뜬다.
                    event.stopPropagation();
                    setOpen(false);
                    onRemove(item.path);
                  }}
                >
                  <Icon
                    icon={workspaceIcons.close}
                    pixels={iconPixels("small")}
                  />
                </button>
              ) : null}
            </span>
          ),
        })),
        ...(canAdd
          ? [
              {
                id: ADD_FOLDER,
                label: t("project-workspace.button.explorer-add-folder"),
                leading: <MenuIcon icon={commonIcons.add} />,
                data: { "data-root-add": "" },
                separatorBefore: true,
              },
            ]
          : []),
        ...(onNewWorktree === undefined
          ? []
          : [
              {
                id: NEW_WORKTREE,
                label: t("worktree.button.new-worktree-from", {
                  name: root.name,
                }),
                leading: <MenuIcon icon={sourceControlIcons.newBranch} />,
                data: { "data-root-new-worktree": "" },
                separatorBefore: !canAdd,
              },
            ]),
      ]}
      onSelect={(id) =>
        id === ADD_FOLDER
          ? onAdd()
          : id === NEW_WORKTREE
            ? onNewWorktree?.()
            : onRoot(id)
      }
    />
  );
}

/** panel 머리 줄의 단추: 새 파일·새 폴더, 그리고 ⋯ menu의 Refresh·Collapse All. */
function HeadActions({
  disabled,
  readOnly,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
}: {
  disabled: boolean;
  readOnly: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
}) {
  const buttons = readOnly
    ? []
    : ([
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
      ] as const);
  const more = [
    {
      id: "refresh",
      icon: workspaceIcons.refresh,
      label: t("project-workspace.button.explorer-refresh"),
      run: onRefresh,
    },
    {
      id: "collapse-all",
      icon: workspaceIcons.collapseAll,
      label: t("project-workspace.button.explorer-collapse-all"),
      run: onCollapseAll,
    },
  ] as const;
  return (
    <PanelActions>
      <div
        role="toolbar"
        aria-label={t("project-workspace.label.explorer-actions")}
        style={{ display: "flex" }}
      >
        {buttons.map((action) => (
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
        <Menu
          trigger={
            <IconButton
              size="sm"
              icon={shellIcons.more}
              label={t("project-workspace.label.explorer-actions")}
              disabled={disabled}
              data-explorer-action="more"
            />
          }
          items={more.map((item) => ({
            id: item.id,
            label: item.label,
            data: { "data-explorer-action": item.id },
            leading: <MenuIcon icon={item.icon} />,
          }))}
          onSelect={(id) => more.find((item) => item.id === id)?.run()}
        />
      </div>
    </PanelActions>
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
      /** 지울 경로들. 화면에 보이는 순서다. */
      readonly paths: readonly string[];
      /** 문구에 쓰는 줄: 마지막으로 고른 줄. */
      readonly from: FileRow;
      /** 실패한 것이 있으면 그 이름. */
      readonly failed: string | null;
    }
  | {
      readonly kind: "move";
      /** 놓을 폴더와 옮길 경로들. 화면에 보이는 순서다. */
      readonly toDir: string;
      readonly paths: readonly string[];
      /** 문구에 쓰는 이름: 마지막으로 고른 줄, 실패하면 실패한 줄. */
      readonly from: string;
      readonly error: "exists" | "failed" | null;
    }
  | {
      readonly kind: "remove-folder";
      readonly path: string;
      readonly failed: boolean;
    }
  | {
      readonly kind: "discard";
      readonly checkout: CheckoutRef;
      readonly path: string;
      readonly relPath: string;
      /** untracked 파일은 되돌릴 것이 없어 지운다. */
      readonly untracked: boolean;
      readonly failed: string | null;
    };

interface ExplorerProps {
  source: WorkspaceSource;
  /** 이 컴퓨터의 workspace인가. false면 OS 전용 동작을 숨기고 원격 허락에 따라 읽기 전용으로 떨어진다. */
  here?: boolean;
  folders: readonly ProjectFolderView[];
  /** 지금 편집기에서 열려 있는 파일의 절대 경로. 바뀌면 tree가 그 파일을 펼쳐 고른다. */
  current?: string | null;
  /** 탭 menu의 Reveal in Explorer가 알리는 파일. 바뀔 때마다 펼쳐 고르고 focus한다. */
  reveal?: { readonly path: string; readonly nonce: number } | null;
  /** true면 고른 줄(없으면 첫 줄)에 focus를 주고 `onFocusAsked`로 요청을 내려놓는다. */
  focusAsked?: boolean;
  onFocusAsked?: () => void;
  /** keep이면 고정 탭으로, 아니면 preview 탭으로 연다. */
  onOpenFile: (path: string, keep?: boolean) => void;
  /** 이름 바꾸기와 옮기기. 열린 탭의 경로를 따라 바꾸는 일까지 한다. */
  onMove: (from: string, to: string) => Promise<TabAwareResult>;
  /** 휴지통으로 보내기. 열린 탭을 닫는 일까지 한다. */
  onTrash: (path: string) => Promise<TabAwareResult>;
  /** 지금 보이는 루트(연결 폴더) 경로. 작업대가 들고 있어 터미널도 같은 폴더에서 열린다. 없거나 맞는 폴더가 없으면 첫 폴더다. */
  rootPath: string | null;
  onRoot: (path: string) => void;
  /** 연결 폴더 더하기(OS 선택기)와 빼기. 사람이 선택기를 닫는 것도 true이고 실패는 false다. */
  onAddFolder: () => Promise<boolean>;
  onRemoveFolder: (path: string) => Promise<boolean>;
  /** 폴더 오른쪽 클릭 menu의 Open in Terminal. 없으면 그 항목을 두지 않는다. */
  onOpenTerminal?: (cwd: string) => void;
}

const PENDING_MS = 2000;

/** Explorer의 선택: 고른 줄들과 Shift 범위의 기준 줄. */
interface Selection {
  readonly ids: ReadonlySet<string>;
  /** Shift 범위의 기준 줄. 보통 마지막으로 고른 줄이다. */
  readonly anchor: string | null;
}

const NOTHING: Selection = { ids: new Set(), anchor: null };

const only = (id: string): Selection => ({ ids: new Set([id]), anchor: id });

/** 앱 안 clipboard. Explorer 밖으로 나가지 않는다. cut은 붙여넣을 때 옮긴다. */
interface Clipboard {
  readonly mode: "copy" | "cut";
  /** 절대 경로들. 붙여넣을 때마다 같은 것을 다시 쓴다. */
  readonly paths: readonly string[];
}

/** 붙여넣기·복사 결과를 tree 아래 한 줄로 알린다. error면 alert다. */
interface Notice {
  readonly text: string;
  readonly error: boolean;
}

export function Explorer({
  source,
  here = true,
  folders,
  current = null,
  reveal = null,
  focusAsked = false,
  onFocusAsked,
  onOpenFile,
  onMove,
  onTrash,
  rootPath,
  onRoot,
  onAddFolder,
  onRemoveFolder,
  onOpenTerminal,
}: ExplorerProps): ReactNode {
  const isLocal = here && source.remote !== true;
  const grant = useMachineGrant(!isLocal);
  const [writeForbidden, setWriteForbidden] = useState(false);
  const readOnly = !isLocal && (grant === "denied" || writeForbidden);
  const roots = rootChoices(folders);
  const root = roots.find((item) => item.path === rootPath) ?? roots[0];
  const ui = useWorktreeUi();
  // 이 루트 폴더에서 난 worktree. 지금 루트의 맨 위에 가지로 선다.
  const branchEntries =
    ui === null || root === undefined || !root.found
      ? []
      : ui.worktrees.entries.filter((entry) => bornIn(entry, root.path));
  const extras: ExtraRoot[] = branchEntries.map((entry) => ({
    worktree: entry.record.id,
    path: entry.record.path,
    name: branchLabelOf(entry),
  }));
  const tree = useFileTree(source, root?.found ? root.path : null, extras);
  const branchPaths = new Set(extras.map((extra) => extra.path));
  const isBranch = (id: string) => branchPaths.has(id);
  const gitWrite = ui !== null && !readOnly && !ui.readOnly;
  const checkouts: GitCheckout[] =
    root === undefined || !root.found || ui === null
      ? []
      : [
          { checkout: { kind: "folder", path: root.path }, root: root.path },
          ...tree.rows.flatMap((row): GitCheckout[] => {
            if (row.worktree === undefined || !row.expanded) return [];
            const entry = ui.worktrees.byId(row.worktree);
            return entry === undefined
              ? []
              : [
                  {
                    checkout: { kind: "worktree", id: row.worktree },
                    root: row.id,
                    stamp: entry.status.updated_at,
                  },
                ];
          }),
        ];
  const git = useGitMarks(
    ui?.sourceControl ?? null,
    ui?.project ?? null,
    checkouts,
    tree.rows,
    !isLocal,
  );
  // 다른 기계의 worktree 폴더는 그 기계의 `project_files/*`가 worktree 경로로 읽고 쓴다.
  const rootsSignature =
    ui?.worktrees.entries.map((entry) => entry.record.path).join("\n") ?? "";
  useEffect(() => {
    if (ui === null || source.registerRoots === undefined) return;
    source.registerRoots(
      ui.project,
      ui.worktrees.entries.map((entry) => entry.record.path),
    );
  }, [source, ui?.project, rootsSignature]);
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [folderFailed, setFolderFailed] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menu, setMenu] = useState<{
    target: FileRow | null;
    x: number;
    y: number;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<readonly string[] | null>(null);

  useEffect(() => {
    setWriteForbidden(false);
  }, [source, root?.path]);
  // 다음 render에 줄이 생기면 보이게 하고(선택적으로 focus도) 비운다. 줄이 늦게 생겨도 잠시 기다린다.
  // id가 null이면 tab stop 줄이다.
  const goal = useRef<{
    id: string | null;
    focus: boolean;
    until: number;
  } | null>(null);
  const typed = useRef({ text: "", at: 0 });
  // Ctrl/Cmd+V는 focus가 편집 가능한 칸이 아니면 paste 이벤트로 온다. 매 render마다 listener를 다시 달지 않으려고
  // 처리 함수를 ref에 담아 두고, document listener 하나가 그것을 부른다.
  const pasteListener = useRef<(event: ClipboardEvent) => void>(() => {});

  const rowElement = (id: string) =>
    [
      ...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ??
        []),
    ].find((element) => element.dataset.file === id);
  const show = (id: string | null, focus: boolean) => {
    goal.current = { id, focus, until: Date.now() + PENDING_MS };
  };
  useEffect(() => {
    const wanted = goal.current;
    if (wanted === null) return;
    if (Date.now() > wanted.until) {
      goal.current = null;
      return;
    }
    const element =
      wanted.id === null
        ? [
            ...(treeRef.current?.querySelectorAll<HTMLElement>(
              '[role="treeitem"]',
            ) ?? []),
          ].find((item) => item.tabIndex === 0)
        : rowElement(wanted.id);
    if (element === undefined) return;
    goal.current = null;
    if (wanted.focus) element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "nearest" });
  });

  // 고른 탭의 파일을 tree에서 펼쳐 고른다. 다른 연결 폴더의 파일이면 그 폴더로 루트를 옮긴다.
  /** 그 경로가 든 등록 폴더(그 폴더에서 난 worktree 안이어도 그 폴더). */
  const ownerRoot = (path: string) =>
    roots.find((item) => contains(item.path, path)) ??
    roots.find((item) =>
      (ui?.worktrees.entries ?? []).some(
        (entry) =>
          bornIn(entry, item.path) && contains(entry.record.path, path),
      ),
    );
  const inTree = (path: string) =>
    root !== undefined &&
    (contains(root.path, path) ||
      [...branchPaths].some((branch) => contains(branch, path)));

  useEffect(() => {
    if (current === null || root === undefined) return;
    if (!inTree(current)) {
      const owner = ownerRoot(current);
      if (owner !== undefined) onRoot(owner.path);
      return;
    }
    tree.reveal(current);
    setSelection(only(current));
    show(current, false);
  }, [current, root?.path, rootsSignature]);

  // Reveal in Explorer. 자동 드러내기와 같지만 그 줄에 focus까지 준다.
  useEffect(() => {
    if (reveal === null || root === undefined) return;
    if (!inTree(reveal.path)) {
      const owner = ownerRoot(reveal.path);
      if (owner !== undefined) onRoot(owner.path);
    }
    tree.reveal(reveal.path);
    setSelection(only(reveal.path));
    show(reveal.path, true);
  }, [reveal?.nonce]);

  // Ctrl/Cmd+Shift+E. 고른 줄이 없으면 tab stop 줄에 focus한다.
  useEffect(() => {
    if (!focusAsked) return;
    show(selection.anchor ?? current, true);
    onFocusAsked?.();
  }, [focusAsked]);

  // paste 이벤트는 tree에 focus가 있을 때만 받는다. 편집기·터미널에 focus가 있으면 절대 가로채지 않는다.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!treeRef.current?.contains(document.activeElement)) return;
      pasteListener.current(event);
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  if (root === undefined) return null;

  const rowOf = (id: string | null) =>
    tree.rows.find((row) => row.id === id) ?? null;
  /** 지금 고른 줄들. 화면에 보이는 순서다. */
  const selectedRows = () =>
    tree.rows.filter((row) => selection.ids.has(row.id));
  /** 마지막으로 고른 줄. 새 파일 자리와 Tab이 닿는 줄을 정한다. */
  const activeRow = rowOf(selection.anchor);
  /** 새로 만들 자리: 고른 폴더, 파일이면 그 파일의 폴더, 아무것도 없으면 루트. */
  const targetFolder = (row: FileRow | null) =>
    row === null ? root.path : row.folder ? row.id : parentOf(row.id);

  // ---- clipboard ----

  /** 복사·잘라내기·복제할 경로: 고른 줄 전부, 없으면 이 줄. 위 폴더에 딸려 가는 줄은 뺀다. */
  const clipPaths = (row: FileRow | null): string[] => {
    const chosen = selectedRows().map((item) => item.id);
    const paths = chosen.length > 0 ? chosen : row === null ? [] : [row.id];
    // worktree 폴더 자체는 Explorer가 옮기거나 지우지 않는다(Remove…가 가드를 거쳐 지운다).
    return outermost(paths.filter((path) => !isBranch(path)));
  };

  /** 고른 경로를 앱 clipboard와 OS clipboard(text)에 복사한다. 붙여넣을 것이 없으면 false다. */
  const copyToClipboard = (row: FileRow | null): boolean => {
    const paths = clipPaths(row);
    if (paths.length === 0) return false;
    setClipboard({ mode: "copy", paths });
    void systemClipboard.writeText(paths.join("\n"));
    setNotice({
      text: t("project-workspace.notice.explorer-copied", {
        count: paths.length,
      }),
      error: false,
    });
    return true;
  };

  // 잘라내기는 앱 안 동작이다. OS clipboard에는 쓰지 않는다.
  const cutToClipboard = (row: FileRow | null): boolean => {
    const paths = clipPaths(row);
    if (paths.length === 0) return false;
    setClipboard({ mode: "cut", paths });
    setNotice({
      text: t("project-workspace.notice.explorer-cut", { count: paths.length }),
      error: false,
    });
    return true;
  };

  /** 경로마다 대상 폴더에 비켜 간 이름으로 복사하고(cut이면 옮긴다) 만든 경로를 모은다. */
  const transfer = async (
    pairs: readonly { readonly from: string; readonly toDir: string }[],
    mode: "copy" | "cut",
  ): Promise<{ made: string[]; failed: boolean; forbidden: boolean }> => {
    const taken = new Map<string, Set<string>>();
    const made: string[] = [];
    let failed = false;
    let forbidden = false;
    for (const { from, toDir } of pairs) {
      let names = taken.get(toDir);
      if (names === undefined) {
        names = new Set(
          (tree.entriesOf(toDir) ?? []).map((entry) => entry.name),
        );
        taken.set(toDir, names);
      }
      const name = freeName(baseName(from), names, "copy");
      names.add(name);
      const to = joinPath(toDir, name);
      const result =
        mode === "cut" ? await onMove(from, to) : await source.copy(from, to);
      if (result.ok) made.push(to);
      else if (result.code === "forbidden") {
        forbidden = true;
        setWriteForbidden(true);
        break;
      } else if (result.code !== "cancelled") failed = true;
    }
    return { made, failed, forbidden };
  };

  /** 만든 경로를 펼쳐 고르고 붙여넣은 개수(또는 실패)를 알린다. */
  const finishPaste = (
    made: readonly string[],
    toDir: string,
    failed: boolean,
    forbidden = false,
  ) => {
    if (made.length > 0) {
      if (toDir !== root.path) tree.expand(toDir);
      tree.refresh();
      setSelection({ ids: new Set(made), anchor: made.at(-1) ?? null });
      const last = made.at(-1);
      if (last !== undefined) show(last, false);
    }
    if (forbidden) {
      setNotice({ text: t("document.error.forbidden"), error: true });
    } else if (failed) {
      setNotice({
        text: t("project-workspace.error.explorer-paste-failed"),
        error: true,
      });
    } else if (made.length > 0) {
      setNotice({
        text: t("project-workspace.notice.explorer-pasted", {
          count: made.length,
        }),
        error: false,
      });
    }
  };

  /** 붙여넣기·드롭으로 들어온 파일(이미지·바이너리·텍스트)을 대상 폴더에 쓴다. */
  const writeFilesToDir = async (files: readonly File[], toDir: string) => {
    const names = new Set(
      (tree.entriesOf(toDir) ?? []).map((entry) => entry.name),
    );
    const made: string[] = [];
    let failed = false;
    let forbidden = false;
    for (const file of files) {
      const base = file.type.startsWith("image/")
        ? imageNameOf(file)
        : file.name.trim().replace(/^.*[/\\]/, "") || "file";
      const name = freeName(base, names, "number");
      names.add(name);
      const path = joinPath(toDir, name);
      const result = await source.writeBytes(
        path,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (result.ok) made.push(path);
      else if (result.code === "forbidden") {
        forbidden = true;
        setWriteForbidden(true);
        break;
      } else failed = true;
    }
    finishPaste(made, toDir, failed, forbidden);
  };

  /** 앱 clipboard으로 붙여넣기. 대상은 지금 줄의 폴더다. */
  const pasteClipboard = async (clip: Clipboard) => {
    const toDir = targetFolder(activeRow);
    const { made, failed, forbidden } = await transfer(
      clip.paths.map((from) => ({ from, toDir })),
      clip.mode,
    );
    // 잘라낸 것은 한 번 붙여넣으면 끝난다. 복사는 남겨 두어 여러 곳에 붙여넣게 한다.
    if (clip.mode === "cut") setClipboard(null);
    finishPaste(made, toDir, failed, forbidden);
  };

  /** paste 이벤트의 파일(이미지·바이너리·텍스트)·경로를 대상 폴더에 붙여넣는다. */
  const pasteData = async (
    files: readonly File[],
    paths: readonly string[],
  ) => {
    const toDir = targetFolder(activeRow);
    if (files.length === 0) {
      const { made, failed, forbidden } = await transfer(
        paths.map((from) => ({ from, toDir })),
        "copy",
      );
      finishPaste(made, toDir, failed, forbidden);
      return;
    }
    await writeFilesToDir(files, toDir);
  };

  /** 붙일 것이 있으면 그 자리에서 preventDefault·stopPropagation 하고 붙여넣는다. */
  const receivePaste = (event: {
    readonly clipboardData: DataTransfer | null;
    readonly target: EventTarget | null;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (readOnly) return;
    const data = event.clipboardData;
    // tree 안 이름 입력에 붙여넣을 때는 가로채지 않는다.
    const target = event.target;
    if (
      data === null ||
      (target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable))
    ) {
      return;
    }
    const files = [...data.files];
    const paths = pathsFromText(data.getData("text/plain"));
    if (files.length === 0 && paths.length === 0) {
      setNotice({
        text: t("project-workspace.error.explorer-paste-unsupported"),
        error: true,
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void pasteData(files, paths);
  };

  pasteListener.current = receivePaste;

  /** Ctrl/Cmd+D. 고른 것마다 그 줄의 폴더 안에 복사본을 만든다. */
  const duplicateRows = async (row: FileRow | null) => {
    const paths = clipPaths(row);
    if (paths.length === 0) return;
    const { made, failed, forbidden } = await transfer(
      paths.map((from) => ({ from, toDir: parentOf(from) })),
      "copy",
    );
    // 새 복사본이 골라지는 것이 성공의 답이다. 실패만 알린다.
    if (made.length > 0) {
      tree.refresh();
      setSelection({ ids: new Set(made), anchor: made.at(-1) ?? null });
      const last = made.at(-1);
      if (last !== undefined) show(last, false);
    }
    if (forbidden) {
      setNotice({ text: t("document.error.forbidden"), error: true });
    } else if (failed) {
      setNotice({
        text: t("project-workspace.error.explorer-paste-failed"),
        error: true,
      });
    }
  };

  /** anchor부터 id까지 화면에 보이는 순서로 고른다. */
  const rangeTo = (id: string): Selection => {
    const from = tree.rows.findIndex((row) => row.id === selection.anchor);
    const to = tree.rows.findIndex((row) => row.id === id);
    if (from < 0 || to < 0) return only(id);
    const [start, end] = from < to ? [from, to] : [to, from];
    return {
      ids: new Set(tree.rows.slice(start, end + 1).map((row) => row.id)),
      anchor: selection.anchor,
    };
  };

  /**
   * 줄을 한 번 눌렀을 때. toggle이면 그 줄을 선택에 더하거나 빼고, range면 anchor부터 이 줄까지 고른다.
   * 그 밖에는 이 줄 하나만 고르고, 폴더면 접고 펴며 파일이면 preview 탭으로 연다.
   */
  const selectRow = (
    row: FileRow,
    modifiers: { readonly toggle: boolean; readonly range: boolean } = {
      toggle: false,
      range: false,
    },
  ) => {
    if (modifiers.toggle) {
      const ids = new Set(selection.ids);
      if (ids.has(row.id)) ids.delete(row.id);
      else ids.add(row.id);
      setSelection({ ids, anchor: row.id });
      return;
    }
    if (modifiers.range) {
      setSelection(rangeTo(row.id));
      return;
    }
    setSelection(only(row.id));
    // 고른 줄 하나만 남으므로 접히는 폴더 안의 줄은 이미 선택에 없다.
    if (row.folder) tree.toggle(row.id);
    else onOpenFile(row.id, false);
  };

  /** 줄을 열 때(파일 더블 클릭, Enter/Space). 이 줄 하나만 고르고 폴더면 접고 펴며, 파일이면 탭으로 연다. */
  const openRow = (row: FileRow, keep?: boolean) => {
    setSelection(only(row.id));
    if (row.folder) tree.toggle(row.id);
    else onOpenFile(row.id, keep);
  };

  const focusRow = (row: FileRow | undefined) => {
    if (row === undefined) return;
    setSelection(only(row.id));
    rowElement(row.id)?.focus();
  };

  /**
   * Shift+화살표: focus를 target으로 옮기며 선택에 더한다. anchor 쪽으로 되돌아가는 한 걸음이면
   * focus를 떠나는 줄을 뺀다.
   */
  const extendTo = (target: FileRow | undefined, from: FileRow | undefined) => {
    if (target === undefined) return false;
    const anchorAt = tree.rows.findIndex((row) => row.id === selection.anchor);
    const fromAt = tree.rows.findIndex((row) => row.id === from?.id);
    const toAt = tree.rows.findIndex((row) => row.id === target.id);
    const ids = new Set(selection.ids);
    const back =
      from !== undefined &&
      anchorAt >= 0 &&
      fromAt >= 0 &&
      Math.abs(toAt - anchorAt) < Math.abs(fromAt - anchorAt);
    if (back && from !== undefined) ids.delete(from.id);
    else ids.add(target.id);
    setSelection({ ids, anchor: selection.anchor ?? from?.id ?? target.id });
    rowElement(target.id)?.focus();
    return true;
  };

  /** 접혀서 tree.rows에서 사라진 줄을 선택에서 뺀다. anchor도 같이 지운다. */
  const forgetHidden = (shown: (id: string) => boolean) => {
    if ([...selection.ids].every((id) => shown(id))) return;
    const ids = new Set([...selection.ids].filter((id) => shown(id)));
    setSelection({
      ids,
      anchor:
        selection.anchor !== null && ids.has(selection.anchor)
          ? selection.anchor
          : null,
    });
  };

  // ---- 새 파일·새 폴더·이름 바꾸기 ----

  const startCreate = (kind: "file" | "folder", row: FileRow | null) => {
    if (readOnly) return;
    const parent = targetFolder(row);
    if (parent !== root.path) tree.expand(parent);
    setDraft({ kind, parent });
  };
  const startRename = (row: FileRow) => {
    if (readOnly) return;
    if (row.worktree !== undefined) {
      ui?.openRename(row.worktree);
      return;
    }
    setDraft({ kind: "rename", path: row.id, folder: row.folder });
  };

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
      if (result.code === "forbidden") {
        setWriteForbidden(true);
        return t("document.error.forbidden");
      }
      return result.code === "conflict"
        ? t("project-workspace.error.explorer-name-exists", { name: value })
        : result.code === "invalid_input"
          ? t("project-workspace.error.explorer-name-invalid", { name: value })
          : t("project-workspace.error.explorer-action-failed");
    }
    tree.reveal(path);
    tree.refresh();
    setSelection(only(path));
    // 새 파일은 편집기가 focus를 받는다. 폴더만 tree에서 이어 간다.
    finishDraft(d.kind === "folder" ? path : null);
    if (d.kind === "file") {
      show(path, false);
      onOpenFile(path, true);
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
      setSelection(only(to));
      finishDraft(to);
      return null;
    }
    if (result.code === "cancelled") {
      finishDraft(d.path);
      return null;
    }
    if (result.code === "forbidden") {
      setWriteForbidden(true);
      return t("document.error.forbidden");
    }
    return result.code === "conflict"
      ? t("project-workspace.error.explorer-name-exists", { name })
      : result.code === "invalid_input"
        ? t("project-workspace.error.explorer-name-invalid", { name })
        : t("project-workspace.error.explorer-action-failed");
  };

  const problemOf =
    (d: Draft) =>
    (value: string): string | null => {
      if (value.trim() === "") return null;
      const check =
        d.kind === "rename"
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
    const initial =
      d.kind === "rename" ? d.path.slice(d.path.lastIndexOf("/") + 1) : "";
    return (
      <NameRow
        key={d.kind === "rename" ? `rename:${d.path}` : `new:${d.parent}`}
        depth={depth}
        folder={folder}
        initial={initial}
        range={renameRange(initial, folder)}
        problem={problemOf(d)}
        onSubmit={(value) =>
          d.kind === "rename" ? submitRename(d, value) : submitCreate(d, value)
        }
        onCancel={(reason) =>
          finishDraft(
            reason === "escape"
              ? d.kind === "rename"
                ? d.path
                : selection.anchor
              : null,
          )
        }
      />
    );
  };

  // ---- 휴지통 ----

  const askTrash = (row: FileRow) => {
    if (readOnly) return;
    if (row.worktree !== undefined) {
      ui?.openRemove(row.worktree);
      return;
    }
    const chosen = selectedRows();
    const paths = outermost(
      (chosen.length > 0 ? chosen : [row])
        .map((item) => item.id)
        .filter((id) => !isBranch(id)),
    );
    if (paths.length === 0) return;
    // 문구에 쓸 줄: 마지막으로 고른 줄, 그 줄이 위 폴더에 딸려 가면 그 폴더.
    const shown = paths.find(
      (path) => path === row.id || contains(path, row.id),
    );
    setDialog({
      kind: "trash",
      paths,
      from: (shown === undefined ? null : rowOf(shown)) ?? row,
      failed: null,
    });
  };

  const confirmTrash = async (trash: Extract<Dialog, { kind: "trash" }>) => {
    // 지운 줄들 다음(없으면 앞) 줄로 focus를 옮긴다.
    const at = tree.rows.findIndex((row) => row.id === trash.paths.at(-1));
    const first = tree.rows.findIndex((row) => row.id === trash.paths[0]);
    const next = tree.rows[at + 1] ?? tree.rows[first - 1];
    const removed = new Set<string>();
    let failed: string | null = null;
    let forbidden = false;
    for (const path of trash.paths) {
      const result = await onTrash(path);
      if (result.ok) removed.add(path);
      else if (result.code === "cancelled") break;
      else if (result.code === "forbidden") {
        forbidden = true;
        setWriteForbidden(true);
        break;
      }
      // 사람이 저장 안 된 탭을 닫지 않기로 하면 남은 것은 그만두고, 실패는 첫 이름으로 알린다.
      else if (failed === null) failed = nameOf(path);
    }
    if (removed.size > 0) tree.refresh();
    const ids = new Set([...selection.ids].filter((id) => !removed.has(id)));
    setSelection({
      ids,
      anchor:
        selection.anchor !== null && ids.has(selection.anchor)
          ? selection.anchor
          : null,
    });
    if (forbidden) {
      setDialog(null);
      setNotice({ text: t("document.error.forbidden"), error: true });
    } else if (failed !== null) setDialog({ ...trash, failed });
    else {
      setDialog(null);
      if (removed.size > 0 && next !== undefined) show(next.id, true);
    }
  };

  // ---- 끌어 옮기기 ----

  /** 이 줄을 그 폴더로 옮기는 것이 변화를 만드는가: 같은 폴더나 자기 안은 아니다. */
  const movable = (path: string, toDir: string) =>
    !isBranch(path) &&
    parentOf(path) !== toDir &&
    path !== toDir &&
    !contains(path, toDir);

  const dropDirOf = (row: FileRow | null) => targetFolder(row);

  const onDragStart = (row: FileRow, event: DragEvent<HTMLDivElement>) => {
    if (readOnly || row.worktree !== undefined) {
      event.preventDefault();
      return;
    }
    const chosen = selectedRows();
    const paths = outermost(
      chosen.length > 1 && chosen.some((item) => item.id === row.id)
        ? chosen.map((item) => item.id)
        : [row.id],
    );
    dragging.current = paths;
    if (isLocal) {
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("text/plain", paths.join("\n"));
      const first = rowOf(paths[0]);
      if (first !== null && !first.folder) {
        event.dataTransfer.setData(PATH_DRAG_TYPE, first.id);
      }
    } else {
      // 원격 파일은 로컬 OS·창 밖 drag-out을 열지 않고 Explorer 안 이동만 쓴다.
      event.dataTransfer.effectAllowed = "move";
    }
  };
  const onDragOver = (row: FileRow | null, event: DragEvent<HTMLElement>) => {
    if (readOnly) return;
    // 줄 위에서는 바깥(빈 자리 = 루트)으로 새지 않게 한다.
    if (row !== null) event.stopPropagation();
    const paths = dragging.current;
    const toDir = dropDirOf(row);
    if (paths === null) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropTarget(toDir);
      return;
    }
    if (!paths.some((path) => movable(path, toDir))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(toDir);
  };
  const onDrop = (row: FileRow | null, event: DragEvent<HTMLElement>) => {
    if (readOnly) return;
    if (row !== null) event.stopPropagation();
    const all = dragging.current;
    const toDir = dropDirOf(row);
    dragging.current = null;
    setDropTarget(null);
    if (all === null) {
      const files = [...event.dataTransfer.files];
      if (files.length === 0) return;
      event.preventDefault();
      void writeFilesToDir(files, toDir);
      return;
    }
    // 이미 같은 자리에 있는 줄은 옮기지 않고, 다른 것 안에 든 줄은 위 폴더와 함께 간다.
    const paths = outermost(all.filter((path) => movable(path, toDir)));
    if (paths.length === 0) return;
    event.preventDefault();
    // 이미 읽은 폴더에 같은 이름이 보이면 묻지 않고 거절한다. 안 읽었으면 main이 거절한다.
    const taken = new Set(
      (tree.entriesOf(toDir) ?? []).map((entry) => entry.name),
    );
    const clash = paths.find((path) => {
      const name = baseName(path);
      if (taken.has(name)) return true;
      taken.add(name);
      return false;
    });
    setDialog({
      kind: "move",
      toDir,
      paths,
      from: clash ?? paths[0],
      error: clash === undefined ? null : "exists",
    });
  };

  const confirmMove = async (d: Extract<Dialog, { kind: "move" }>) => {
    const moved: string[] = [];
    let failure: {
      readonly from: string;
      readonly error: "exists" | "failed";
    } | null = null;
    let forbidden = false;
    for (const from of d.paths) {
      const to = joinPath(d.toDir, baseName(from));
      const result = await onMove(from, to);
      if (result.ok) moved.push(to);
      else if (result.code === "cancelled") break;
      else if (result.code === "forbidden") {
        forbidden = true;
        setWriteForbidden(true);
        break;
      } else if (failure === null) {
        failure = {
          from,
          error: result.code === "conflict" ? "exists" : "failed",
        };
      }
    }
    if (moved.length > 0) {
      if (d.toDir !== root.path) tree.expand(d.toDir);
      tree.refresh();
      setSelection({ ids: new Set(moved), anchor: moved.at(-1) ?? null });
      const last = moved.at(-1);
      if (last !== undefined) show(last, false);
    }
    if (forbidden) {
      setDialog(null);
      setNotice({ text: t("document.error.forbidden"), error: true });
    } else if (failure !== null) setDialog({ ...d, ...failure });
    else setDialog(null);
  };

  // ---- 연결 폴더 더하기·빼기 ----

  const addFolder = async () => {
    setFolderFailed(false);
    if (!(await onAddFolder())) setFolderFailed(true);
  };

  const confirmDiscard = async (d: Extract<Dialog, { kind: "discard" }>) => {
    if (ui === null) return;
    const project = ui.project;
    const res = await ui.sourceControl.discard(
      d.checkout.kind === "worktree"
        ? { project, worktree: d.checkout.id }
        : { project, folder: d.checkout.path },
      {
        paths: [d.relPath],
        ...(d.untracked ? { include_untracked: true } : {}),
      },
    );
    if (!res.ok) {
      setDialog({ ...d, failed: res.error.message });
      return;
    }
    setDialog(null);
    tree.refresh();
    git.refresh();
  };

  const confirmRemoveFolder = async (path: string) => {
    if (await onRemoveFolder(path)) setDialog(null);
    else if (dialog?.kind === "remove-folder") {
      setDialog({ ...dialog, failed: true });
    }
  };

  // ---- 오른쪽 클릭 menu ----

  const relativePath = (path: string) => {
    const owner = [
      ...folders,
      ...(ui?.worktrees.entries ?? []).map((entry) => ({
        path: entry.record.path,
      })),
    ]
      .filter((folder) => path === folder.path || contains(folder.path, path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return owner === undefined || path === owner.path
      ? path.slice(path.lastIndexOf("/") + 1)
      : path.slice(owner.path.replace(/\/+$/, "").length + 1);
  };

  /** 고른 줄(없으면 이 줄)이 있어야 할 수 있는 menu 항목을 끈다. */
  const canAct = (target: FileRow | null) => clipPaths(target).length > 0;

  /** worktree 가지 줄의 menu. 폴더 줄의 파일 동작 대신 worktree 동작만 둔다. */
  const branchItems = (row: FileRow): MenuItem[] => {
    const entry = ui?.worktrees.byId(row.worktree);
    const live =
      entry !== undefined &&
      entry.record.status === "ready" &&
      entry.status.presence === "present";
    return [
      ...(gitWrite
        ? [
            {
              id: "wt-open-agent",
              label: t("worktree.button.open-agent-here"),
              leading: <MenuIcon icon={commonIcons.agents} />,
              disabled: !live,
            },
            {
              id: "wt-open-terminal",
              label: t("worktree.button.open-terminal-here"),
              leading: <MenuIcon icon={workspaceIcons.terminal} />,
              disabled: !live,
            },
          ]
        : []),
      {
        id: "wt-view-sc",
        label: t("worktree.button.view-in-source-control"),
        leading: <MenuIcon icon={sourceControlIcons.branch} />,
        disabled: !live,
      },
      {
        id: "wt-copy-path",
        label: t("project-workspace.button.explorer-copy-path"),
        leading: <MenuIcon icon={workspaceIcons.copy} />,
        separatorBefore: true,
      },
      {
        id: "wt-copy-branch",
        label: t("worktree.button.copy-branch"),
        leading: <MenuIcon icon={workspaceIcons.copy} />,
        disabled: entry === undefined || entry.status.branch === null,
      },
      ...(isLocal
        ? [
            {
              id: "wt-reveal",
              label: t("project-workspace.button.explorer-reveal"),
              leading: <MenuIcon icon={workspaceIcons.revealInFiles} />,
              disabled: !live,
            },
          ]
        : []),
      ...(gitWrite
        ? [
            {
              id: "wt-rename",
              label: t("worktree.button.rename-menu"),
              leading: <MenuIcon icon={editorIcons.edit} />,
            },
            {
              id: "wt-remove",
              label:
                entry?.record.provenance === "adopted"
                  ? t("worktree.button.untrack-menu")
                  : t("worktree.button.remove-menu"),
              leading: <MenuIcon icon={workspaceIcons.trash} />,
              separatorBefore: true,
              disabled:
                entry === undefined ||
                entry.record.status === "creating" ||
                entry.record.status === "removing",
            },
          ]
        : []),
    ];
  };

  /** git 변경이 있는 파일 줄의 Open Diff·Discard Changes…. */
  const gitItems = (target: FileRow | null): MenuItem[] => {
    if (target === null || target.folder || ui === null) return [];
    const info = git.gitOf(target);
    if (info.mark === null || info.mark.inherited || info.checkout === null) {
      return [];
    }
    return [
      {
        id: "open-diff",
        label: t("worktree.button.open-diff"),
        leading: <MenuIcon icon={sourceControlIcons.commit} />,
        separatorBefore: true,
      },
      ...(gitWrite
        ? [
            {
              id: "discard-changes",
              label: t("worktree.button.discard-changes"),
              leading: <MenuIcon icon={sourceControlIcons.discard} />,
            },
          ]
        : []),
    ];
  };

  const rootCheckout: CheckoutRef = { kind: "folder", path: root.path };
  const newWorktreeItems = (target: FileRow | null): MenuItem[] =>
    target === null && gitWrite && git.tracked(rootCheckout)
      ? [
          {
            id: "new-worktree",
            label: t("worktree.button.new-worktree"),
            leading: <MenuIcon icon={sourceControlIcons.newBranch} />,
            separatorBefore: true,
          },
        ]
      : [];

  const menuItems = (target: FileRow | null): MenuItem[] =>
    target?.worktree !== undefined
      ? branchItems(target)
      : [
          ...fileItems(target),
          ...gitItems(target),
          ...newWorktreeItems(target),
        ];

  const fileItems = (target: FileRow | null): MenuItem[] => [
    ...(readOnly
      ? []
      : [
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
        ]),
    ...(readOnly
      ? []
      : [
          {
            id: "cut",
            label: t("project-workspace.button.explorer-cut"),
            leading: <MenuIcon icon={Scissors} />,
            separatorBefore: true,
            disabled: !canAct(target),
          },
          {
            id: "copy",
            label: t("project-workspace.button.explorer-copy"),
            leading: <MenuIcon icon={workspaceIcons.copy} />,
            disabled: !canAct(target),
          },
          {
            id: "paste",
            label: t("project-workspace.button.explorer-paste"),
            leading: <MenuIcon icon={ClipboardPaste} />,
          },
          {
            id: "duplicate",
            label: t("project-workspace.button.explorer-duplicate"),
            leading: <MenuIcon icon={CopyPlus} />,
            disabled: !canAct(target),
          },
        ]),
    ...(isLocal
      ? [
          {
            id: "reveal",
            label: t("project-workspace.button.explorer-reveal"),
            leading: <MenuIcon icon={workspaceIcons.revealInFiles} />,
            separatorBefore: true,
          },
        ]
      : []),
    ...(onOpenTerminal === undefined || (target !== null && !target.folder)
      ? []
      : [
          {
            id: "open-terminal",
            label: t("project-workspace.button.explorer-open-terminal"),
            leading: <MenuIcon icon={workspaceIcons.terminal} />,
            separatorBefore: true,
          },
        ]),
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
    ...(target === null || readOnly
      ? []
      : [
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

  /** 경로 복사 대상: 고른 줄들, 없으면 menu를 연 줄(또는 루트). */
  const copyPaths = (target: FileRow | null) => {
    const chosen = selectedRows();
    return chosen.length > 0
      ? chosen.map((row) => row.id)
      : [target?.id ?? root.path];
  };

  const runBranchMenu = (id: string, row: FileRow) => {
    const worktree = row.worktree;
    if (worktree === undefined || ui === null) return;
    const entry = ui.worktrees.byId(worktree);
    if (id === "wt-open-agent") ui.openAgent(worktree);
    else if (id === "wt-open-terminal") ui.openTerminal(worktree);
    else if (id === "wt-view-sc") {
      ui.showInSourceControl({ kind: "worktree", id: worktree });
    } else if (id === "wt-copy-path") {
      void systemClipboard.writeText(row.id);
    } else if (id === "wt-copy-branch") {
      const branch = entry?.status.branch;
      if (branch != null) void systemClipboard.writeText(branch);
    } else if (id === "wt-reveal") void source.reveal(row.id);
    else if (id === "wt-rename") ui.openRename(worktree);
    else if (id === "wt-remove") ui.openRemove(worktree);
  };

  const runMenu = (id: string, target: FileRow | null) => {
    if (target?.worktree !== undefined) {
      runBranchMenu(id, target);
      return;
    }
    const path = target?.id ?? root.path;
    if (id === "new-worktree") {
      ui?.openCreate({ folder: root.path });
      return;
    }
    if (target !== null && (id === "open-diff" || id === "discard-changes")) {
      const info = git.gitOf(target);
      if (info.checkout === null || info.relPath === null || ui === null) {
        return;
      }
      if (id === "open-diff") {
        ui.openDiff(
          {
            checkout: info.checkout,
            path: info.relPath,
            scope: { kind: "working" },
            ...(info.mark === null ? {} : { status: info.mark.letter }),
          },
          { preview: true },
        );
      } else {
        setDialog({
          kind: "discard",
          checkout: info.checkout,
          path: target.id,
          relPath: info.relPath,
          untracked: info.mark?.letter === "U",
          failed: null,
        });
      }
      return;
    }
    if (id === "new-file" || id === "new-folder") {
      startCreate(id === "new-file" ? "file" : "folder", target);
    } else if (id === "cut") cutToClipboard(target);
    else if (id === "copy") copyToClipboard(target);
    else if (id === "paste") {
      // 앱 clipboard이 비었으면 붙일 것이 없다. OS clipboard의 경로·이미지는 paste 이벤트로만 받는다.
      if (clipboard === null) {
        setNotice({
          text: t("project-workspace.error.explorer-paste-unsupported"),
          error: true,
        });
      } else void pasteClipboard(clipboard);
    } else if (id === "duplicate") void duplicateRows(target);
    else if (id === "reveal") void source.reveal(path);
    else if (id === "open-terminal") onOpenTerminal?.(path);
    else if (id === "copy-path") {
      void systemClipboard.writeText(copyPaths(target).join("\n"));
    } else if (id === "copy-relative-path") {
      void systemClipboard.writeText(
        copyPaths(target).map(relativePath).join("\n"),
      );
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
    const mod = event.metaKey || event.ctrlKey;
    // 처리하지 않는 modifier 조합은 화면 밖으로 흘려보낸다.
    if (event.altKey) return;
    if (mod && key.toLowerCase() === "a") {
      if (tree.rows.length === 0) return;
      setSelection({
        ids: new Set(tree.rows.map((item) => item.id)),
        anchor: tree.rows[0].id,
      });
    } else if (mod && key.toLowerCase() === "c") {
      if (readOnly || !copyToClipboard(row ?? null)) return;
    } else if (mod && key.toLowerCase() === "x") {
      if (readOnly || !cutToClipboard(row ?? null)) return;
    } else if (mod && key.toLowerCase() === "v") {
      // 앱 clipboard이 비었으면 paste 이벤트가 OS clipboard의 경로·이미지를 맡는다. 둘이 같은 일을 하지 않는다.
      if (readOnly || clipboard === null) return;
      void pasteClipboard(clipboard);
    } else if (mod && key.toLowerCase() === "d") {
      if (readOnly || clipPaths(row ?? null).length === 0) return;
      void duplicateRows(row ?? null);
    } else if (
      (key === "Delete" && !event.ctrlKey) ||
      (key === "Backspace" && event.metaKey)
    ) {
      if (readOnly) return;
      const target = row ?? selectedRows()[0];
      if (target === undefined) return;
      askTrash(target);
    } else if (mod) return;
    else if (key === "F2") {
      if (!readOnly && row !== undefined) startRename(row);
      else return;
    } else if (key === "ArrowDown") {
      if (event.shiftKey) {
        if (!extendTo(tree.rows[at < 0 ? 0 : at + 1], row)) return;
      } else focusRow(tree.rows[at < 0 ? 0 : at + 1]);
    } else if (key === "ArrowUp") {
      if (event.shiftKey) {
        if (!extendTo(tree.rows[at < 0 ? tree.rows.length - 1 : at - 1], row)) {
          return;
        }
      } else focusRow(tree.rows[at < 0 ? tree.rows.length - 1 : at - 1]);
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
      if (row.folder && row.expanded) {
        forgetHidden((id) => !contains(row.id, id));
        tree.collapse(row.id);
      } else focusRow(rowOf(parentOf(row.id)) ?? undefined);
    } else if (key === "Enter" || key === " ") {
      if (row === undefined) return;
      // Enter는 고정 탭, Space는 preview 탭으로 연다.
      openRow(row, key === "Enter");
    } else if (key.length === 1 && row !== undefined) {
      const now = Date.now();
      const text =
        (now - typed.current.at > 700 ? "" : typed.current.text) +
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
  const tabStop = activeRow?.id ?? tree.rows[0]?.id;
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
        multiSelected={selection.ids.has(row.id)}
        cut={clipboard?.mode === "cut" && clipboard.paths.includes(row.id)}
        dropping={row.id === dropTarget}
        tabStop={row.id === tabStop}
        draggable={!readOnly && row.worktree === undefined}
        {...(() => {
          if (row.worktree !== undefined) {
            const entry = ui?.worktrees.byId(row.worktree);
            return entry === undefined ? {} : { branch: branchInfoOf(entry) };
          }
          const info = git.gitOf(row);
          return { git: info.mark, ignored: info.ignored };
        })()}
        onSelect={selectRow}
        onOpen={(one) => openRow(one, true)}
        onMenu={(one, at) => {
          // 이미 고른 줄이면 선택을 그대로 두고, 아니면 그 줄만 고른다.
          if (!selection.ids.has(one.id)) setSelection(only(one.id));
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
  const removing = dialog?.kind === "remove-folder" ? dialog : null;
  const discarding = dialog?.kind === "discard" ? dialog : null;
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

  return (
    <section className={styles.section} data-explorer="">
      <HeadActions
        disabled={!root.found}
        readOnly={readOnly}
        onNewFile={() => startCreate("file", activeRow)}
        onNewFolder={() => startCreate("folder", activeRow)}
        onRefresh={() => {
          tree.refresh();
          git.refresh();
        }}
        onCollapseAll={() => {
          // 접으면 루트의 한 단만 남는다.
          const top = new Set(
            tree.rows.filter((item) => item.depth === 0).map((item) => item.id),
          );
          forgetHidden((id) => top.has(id));
          tree.collapseAll();
        }}
      />
      <PanelTitle>
        <RootPicker
          roots={roots}
          root={root}
          canAdd={isLocal}
          canRemove={!readOnly}
          onRoot={onRoot}
          onAdd={() => void addFolder()}
          onRemove={(path) =>
            setDialog({ kind: "remove-folder", path, failed: false })
          }
          {...(gitWrite && git.tracked(rootCheckout)
            ? { onNewWorktree: () => ui?.openCreate({ folder: root.path }) }
            : {})}
        />
      </PanelTitle>
      <div
        ref={treeRef}
        role="tree"
        aria-label={t("project-workspace.label.files-in", {
          folder: root.name,
        })}
        className={styles.tree}
        data-drop-root={dropTarget === root.path || undefined}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(NOTHING);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelection(NOTHING);
          setMenu({ target: null, x: event.clientX, y: event.clientY });
        }}
        onDragOver={(event) => onDragOver(null, event)}
        onDrop={(event) => onDrop(null, event)}
        onPaste={(event) => receivePaste(event)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTarget(null);
          }
        }}
      >
        {items}
      </div>
      {tree.failed ? (
        <PanelEmpty role="alert">
          {t("project-workspace.error.files-failed")}
        </PanelEmpty>
      ) : null}
      {folderFailed ? (
        <PanelEmpty role="alert">
          {t("project-workspace.error.explorer-action-failed")}
        </PanelEmpty>
      ) : null}
      {notice === null ? null : (
        <div role={notice.error ? "alert" : "status"}>
          <PanelEmpty>{notice.text}</PanelEmpty>
        </div>
      )}
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
            name: nameOf(trash.from.id),
          })}
          text={
            trash.failed !== null
              ? t("project-workspace.error.explorer-trash-failed", {
                  name: trash.failed,
                })
              : t(
                  trash.from.folder
                    ? "project-workspace.notice.explorer-delete-folder"
                    : "project-workspace.notice.explorer-delete-file",
                  { name: nameOf(trash.from.id) },
                )
          }
          confirm={
            trash.failed !== null
              ? null
              : {
                  label: t("project-workspace.button.explorer-trash"),
                  danger: true,
                }
          }
          onConfirm={() => void confirmTrash(trash)}
          onClose={() => setDialog(null)}
        />
      )}
      {move === null ? null : (
        <FileConfirm
          title={t("project-workspace.title.explorer-move", {
            name: nameOf(move.from),
          })}
          text={
            move.error === "exists"
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
                  })
          }
          confirm={
            move.error === null
              ? {
                  label: t("project-workspace.button.explorer-move"),
                  danger: false,
                }
              : null
          }
          onConfirm={() => void confirmMove(move)}
          onClose={() => setDialog(null)}
        />
      )}
      {removing === null ? null : (
        <FileConfirm
          title={t("project-workspace.title.explorer-remove-folder", {
            name: nameOf(removing.path),
          })}
          text={
            removing.failed
              ? t("project-workspace.error.explorer-remove-folder-failed", {
                  name: nameOf(removing.path),
                })
              : t("project-workspace.notice.explorer-remove-folder", {
                  name: nameOf(removing.path),
                })
          }
          confirm={
            removing.failed
              ? null
              : {
                  label: t("project-workspace.button.explorer-remove-folder"),
                  danger: false,
                }
          }
          onConfirm={() => void confirmRemoveFolder(removing.path)}
          onClose={() => setDialog(null)}
        />
      )}
      {discarding === null ? null : (
        <FileConfirm
          title={t("worktree.title.discard", {
            name: nameOf(discarding.path),
          })}
          text={
            discarding.failed !== null
              ? discarding.failed
              : discarding.untracked
                ? t("worktree.notice.discard-untracked", {
                    name: nameOf(discarding.path),
                  })
                : t("worktree.notice.discard-tracked", {
                    name: nameOf(discarding.path),
                  })
          }
          confirm={
            discarding.failed !== null
              ? null
              : {
                  label: discarding.untracked
                    ? t("worktree.button.delete-file")
                    : t("worktree.button.discard"),
                  danger: true,
                }
          }
          onConfirm={() => void confirmDiscard(discarding)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
