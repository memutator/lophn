import {
  type KeyboardEvent,
  type MouseEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon } from "../icon.tsx";
import { componentMark, iconPixels } from "../shared.ts";
import { treeKey, type TreeNode, type TreeRow, visibleRows } from "./model.ts";
import styles from "./tree.module.css";

export interface TreeProps {
  nodes: readonly TreeNode[];
  // 열린 가지. 저장과 복원은 호출자가 맡는다.
  expanded: ReadonlySet<string>;
  onExpandedChange: (id: string, open: boolean) => void;
  // 지금 연 항목. 왼쪽 2px 표시로 보인다.
  currentId?: string;
  // 다중 선택. 배경으로 보인다.
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  onOpen?: (id: string) => void;
  // 트리 전체 이름. 사람이 지은 이름이나 wording key 문구를 준다.
  label?: string;
}

const EMPTY = new Set<string>();

// 행 28px, 깊이당 12px·8단 상한, 현재 왼쪽 2px, 키보드 안쪽 2px focus.
export function Tree(
  {
    nodes,
    expanded,
    onExpandedChange,
    currentId,
    selectedIds = EMPTY,
    onSelectionChange,
    onOpen,
    label,
  }: TreeProps,
) {
  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const [focusedId, setFocusedId] = useState<string>();
  const items = useRef(new Map<string, HTMLDivElement>());
  const moved = useRef(false);
  const focused = rows.find((row) => row.id === focusedId) ??
    rows.find((row) => row.id === currentId) ?? rows[0];

  useLayoutEffect(() => {
    if (!moved.current || !focused) return;
    moved.current = false;
    items.current.get(focused.id)?.focus();
  }, [focused]);

  const moveTo = (id: string) => {
    moved.current = true;
    setFocusedId(id);
  };

  const toggleSelected = (id: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const activate = (row: TreeRow) => {
    if (row.branch) onExpandedChange(row.id, !row.expanded);
    else onOpen?.(row.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: TreeRow) => {
    if (event.key === "Enter") activate(row);
    else if (event.key === " ") toggleSelected(row.id);
    else {
      const move = treeKey(rows, row.id, event.key);
      if (move.kind === "none") return;
      if (move.kind === "focus") moveTo(move.id);
      else onExpandedChange(move.id, move.open);
    }
    event.preventDefault();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>, row: TreeRow) => {
    setFocusedId(row.id);
    if (event.ctrlKey || event.metaKey) toggleSelected(row.id);
    else activate(row);
  };

  return (
    <div
      role="tree"
      aria-label={label}
      aria-multiselectable={onSelectionChange ? true : undefined}
      className={styles.tree}
      {...componentMark("Tree")}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          ref={(element) => {
            if (element) items.current.set(row.id, element);
            else items.current.delete(row.id);
          }}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.branch ? row.expanded : undefined}
          aria-selected={onSelectionChange
            ? selectedIds.has(row.id)
            : undefined}
          aria-current={row.id === currentId ? "page" : undefined}
          tabIndex={row.id === focused?.id ? 0 : -1}
          data-id={row.id}
          data-indent={row.indent}
          data-current={row.id === currentId || undefined}
          data-selected={selectedIds.has(row.id) || undefined}
          className={styles.row}
          onKeyDown={(event) => onKeyDown(event, row)}
          onClick={(event) => onClick(event, row)}
        >
          {row.id === currentId && <span className={styles.marker} />}
          {Array.from(
            { length: row.indent },
            (_, step) => <span key={step} className={styles.indent} />,
          )}
          <span className={styles.twisty}>
            {row.branch && (
              <Icon
                icon={row.expanded ? ChevronDown : ChevronRight}
                pixels={iconPixels("small")}
              />
            )}
          </span>
          <span className={styles.label}>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
