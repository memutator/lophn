// Explorer tree의 줄. 파일·폴더 줄과 inline 이름 입력 줄이 같은 틀(들여쓰기 안내선, twisty 칸, 아이콘)을 쓴다.
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FileIcon, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { Tooltip } from "@lophn/ui/overlay";
import { sourceControlIcons } from "../../icons/mod.ts";
import type { FileRow } from "./use-file-tree.ts";
import type { GitMark } from "./use-git-marks.ts";
import styles from "./explorer.module.css";

/** worktree 가지 줄에 보이는 것. */
export interface BranchRowInfo {
  /** 브랜치 이름(또는 `detached @ sha7`). */
  readonly branch: string;
  /** 사람이 붙인 label. 브랜치와 같으면 없다. */
  readonly label?: string;
  readonly path: string;
  /** 고유 바뀐 파일 수. 0이면 배지가 없다. */
  readonly changed: number;
  /** 이상 상태. 정상(ready·present)이면 없다. */
  readonly state?: "missing" | "unmounted" | "creating" | "removing";
}

/** 위쪽 폴더마다 세로선 하나. tree에 마우스를 올렸을 때만 보인다. */
function Guides({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      className={styles.guide}
      style={{
        left: `calc(var(--space-2) + var(--tree-indent) * ${level} + var(--icon-size-small) / 2)`,
      }}
    />
  ));
}

const indentOf = (depth: number) =>
  `calc(var(--space-2) + var(--tree-indent) * ${depth})`;

interface RowProps {
  row: FileRow;
  current: boolean;
  /** 이 줄이 선택에 들었는가. */
  multiSelected: boolean;
  /** 잘라낸 줄이라 흐리게 그린다. */
  cut: boolean;
  /** 끌어 놓을 대상으로 칠한다. */
  dropping: boolean;
  /** tree에서 Tab이 닿는 줄. 나머지는 화살표로만 간다. */
  tabStop: boolean;
  /** 끌기 허용 여부. 읽기 전용 원격 workspace에서는 끈다. */
  draggable?: boolean;
  /** git 상태 문자. 없으면 null. */
  git?: GitMark | null;
  /** `.gitignore`가 무시하는 줄이라 흐리게 그린다. */
  ignored?: boolean;
  /** worktree 가지 줄이면 그 정보. */
  branch?: BranchRowInfo;
  /** 한 번 클릭: 줄을 고르고(modifier에 따라 toggle·range) 폴더면 접고 펴며 파일이면 preview 탭으로 연다. */
  onSelect: (
    row: FileRow,
    modifiers: { readonly toggle: boolean; readonly range: boolean },
  ) => void;
  /** 파일 더블 클릭: 파일을 고정 탭으로 연다. */
  onOpen: (row: FileRow) => void;
  onMenu: (row: FileRow, at: { x: number; y: number }) => void;
  onDragStart: (row: FileRow, event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (row: FileRow, event: DragEvent<HTMLDivElement>) => void;
  onDrop: (row: FileRow, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function Row({
  row,
  current,
  multiSelected,
  cut,
  dropping,
  tabStop,
  draggable = true,
  git = null,
  ignored = false,
  branch,
  onSelect,
  onOpen,
  onMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps) {
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.folder ? row.expanded : undefined}
      aria-selected={multiSelected}
      aria-current={current ? "page" : undefined}
      tabIndex={tabStop ? 0 : -1}
      draggable={draggable}
      data-file={row.id}
      data-current={current || undefined}
      data-selected={multiSelected || undefined}
      data-cut={cut || undefined}
      data-drop={dropping || undefined}
      data-git={git?.letter}
      data-git-inherited={git?.inherited || undefined}
      data-ignored={ignored || undefined}
      data-worktree={row.worktree}
      data-worktree-state={branch?.state}
      className={styles.treeRow}
      style={{ paddingLeft: indentOf(row.depth) }}
      onClick={(event) =>
        onSelect(row, {
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      }
      onDoubleClick={() => {
        if (!row.folder) onOpen(row);
      }}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(row, { x: event.clientX, y: event.clientY });
      }}
      onDragStart={(event) => onDragStart(row, event)}
      onDragOver={(event) => onDragOver(row, event)}
      onDrop={(event) => onDrop(row, event)}
      onDragEnd={onDragEnd}
    >
      <Guides depth={row.depth} />
      {current && <span className={styles.treeMarker} />}
      <span className={styles.twisty}>
        {row.folder && (
          <Icon
            icon={row.expanded ? ChevronDown : ChevronRight}
            pixels={iconPixels("small")}
          />
        )}
      </span>
      {branch === undefined ? (
        <>
          <span className={styles.treeIcon}>
            <FileIcon name={row.name} folder={row.folder} open={row.expanded} />
          </span>
          <span className={styles.treeLabel}>{row.name}</span>
          {git === null ? null : (
            <span className={styles.gitMark} data-git-mark={git.letter}>
              {git.inherited ? "•" : git.letter}
            </span>
          )}
        </>
      ) : (
        <BranchLabel branch={branch} />
      )}
    </div>
  );
}

const STATE_LABEL = {
  missing: "worktree.label.state-missing",
  unmounted: "worktree.label.state-unmounted",
  creating: "worktree.label.state-creating",
  removing: "worktree.label.state-removing",
} as const;

function BranchLabel({ branch }: { branch: BranchRowInfo }) {
  return (
    <Tooltip content={branch.path}>
      <span className={styles.branchLabel}>
        <span className={styles.treeIcon}>
          <Icon
            icon={sourceControlIcons.worktree}
            pixels={iconPixels("small")}
          />
        </span>
        <span className={styles.treeLabel}>
          {branch.label ?? branch.branch}
          {branch.label === undefined ? null : (
            <span className={styles.branchSub}>{branch.branch}</span>
          )}
        </span>
        {branch.state === undefined ? null : (
          <span className={styles.branchState} data-branch-state={branch.state}>
            {t(STATE_LABEL[branch.state])}
          </span>
        )}
        {branch.changed === 0 ? null : (
          <span className={styles.branchCount}>{branch.changed}</span>
        )}
      </span>
    </Tooltip>
  );
}

interface NameRowProps {
  depth: number;
  /** 폴더 아이콘으로 그린다. */
  folder: boolean;
  initial: string;
  /** 처음에 고르는 글 범위. */
  range: readonly [number, number];
  /** 지금 글의 문제. 없으면 null. */
  problem: (value: string) => string | null;
  /** 만들거나 바꾼다. 실패하면 입력 아래에 보일 오류 글, 성공하면 null. */
  onSubmit: (value: string) => Promise<string | null>;
  /** Esc, 또는 focus를 잃음. */
  onCancel: (reason: "escape" | "blur") => void;
}

/** 새 파일·폴더와 이름 바꾸기가 쓰는 tree 안 입력. Enter는 확정, Esc와 focus 잃음은 취소다. */
export function NameRow({
  depth,
  folder,
  initial,
  range,
  problem,
  onSubmit,
  onCancel,
}: NameRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [asked, setAsked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // 확정하는 동안 focus를 잃어도 취소하지 않는다.
  const busy = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(range[0], range[1]);
  }, []);

  const empty = value.trim() === "";
  const message = empty
    ? asked
      ? t("project-workspace.error.explorer-name-required")
      : null
    : (problem(value) ?? failure);

  const submit = async () => {
    if (busy.current) return;
    setAsked(true);
    if (empty || problem(value) !== null) return;
    busy.current = true;
    const error = await onSubmit(value);
    busy.current = false;
    if (error !== null) setFailure(error);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // tree의 키 처리(화살표, 글자 찾기)로 새지 않게 한다.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel("escape");
    }
  };

  return (
    <div
      className={styles.treeRow}
      data-editing=""
      style={{ paddingLeft: indentOf(depth) }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Guides depth={depth} />
      <span className={styles.twisty} />
      <span className={styles.treeIcon}>
        <FileIcon name={value} folder={folder} />
      </span>
      <input
        ref={input}
        className={styles.nameInput}
        value={value}
        aria-label={t("project-workspace.label.explorer-name")}
        aria-invalid={message !== null}
        spellCheck={false}
        autoComplete="off"
        data-invalid={message !== null || undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setFailure(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!busy.current) onCancel("blur");
        }}
      />
      {message === null ? null : (
        <div
          className={styles.nameError}
          role="alert"
          // 오류를 눌러도 입력이 focus를 잃어 취소되지 않게 한다.
          onMouseDown={(event) => event.preventDefault()}
        >
          {message}
        </div>
      )}
    </div>
  );
}
