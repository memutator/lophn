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

import type { FileRow } from "./use-file-tree.ts";
import styles from "./explorer.module.css";

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
  /** keep이면 파일을 고정 탭으로 연다(double-click). modifiers는 누른 modifier key다. */
  onActivate: (
    row: FileRow,
    keep: boolean | undefined,
    modifiers: { readonly toggle: boolean; readonly range: boolean },
  ) => void;
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
  onActivate,
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
      draggable
      data-file={row.id}
      data-current={current || undefined}
      data-selected={multiSelected || undefined}
      data-cut={cut || undefined}
      data-drop={dropping || undefined}
      className={styles.treeRow}
      style={{ paddingLeft: indentOf(row.depth) }}
      onClick={(event) =>
        onActivate(row, undefined, {
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      }
      onDoubleClick={() => {
        if (!row.folder) {
          onActivate(row, true, { toggle: false, range: false });
        }
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
      <span className={styles.treeIcon}>
        <FileIcon name={row.name} folder={row.folder} open={row.expanded} />
      </span>
      <span className={styles.treeLabel}>{row.name}</span>
    </div>
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
