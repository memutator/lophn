// 트리의 보이는 행과 키보드 이동. React·DOM을 모른다.
import { tokens } from "../../tokens.ts";

export interface TreeNode {
  id: string;
  // 사람이 지은 이름(파일·폴더·문서 이름). 화면 문구 key가 아니라 데이터다.
  label: string;
  children?: readonly TreeNode[];
}

export interface TreeRow {
  id: string;
  label: string;
  depth: number;
  // 그릴 들임 단계. 8단부터 더 들이지 않는다(shell/design-system#R32).
  indent: number;
  parentId?: string;
  branch: boolean;
  expanded: boolean;
}

export function indentSteps(depth: number): number {
  return Math.min(Math.max(depth, 0), tokens.tree.indentCap);
}

export function visibleRows(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (
    list: readonly TreeNode[],
    depth: number,
    parentId?: string,
  ) => {
    for (const node of list) {
      const branch = (node.children?.length ?? 0) > 0;
      const open = branch && expanded.has(node.id);
      rows.push({
        id: node.id,
        label: node.label,
        depth,
        indent: indentSteps(depth),
        parentId,
        branch,
        expanded: open,
      });
      if (open) walk(node.children!, depth + 1, node.id);
    }
  };
  walk(nodes, 0);
  return rows;
}

export type TreeMove =
  | { kind: "focus"; id: string }
  | { kind: "expand"; id: string; open: boolean }
  | { kind: "none" };

// 방향키로 focus를 옮기거나 가지를 연다·닫는다.
export function treeKey(
  rows: readonly TreeRow[],
  focusedId: string,
  key: string,
): TreeMove {
  const index = rows.findIndex((row) => row.id === focusedId);
  if (index === -1) return { kind: "none" };
  const row = rows[index];
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length
        ? { kind: "focus", id: rows[index + 1].id }
        : { kind: "none" };
    case "ArrowUp":
      return index > 0
        ? { kind: "focus", id: rows[index - 1].id }
        : { kind: "none" };
    case "Home":
      return { kind: "focus", id: rows[0].id };
    case "End":
      return { kind: "focus", id: rows[rows.length - 1].id };
    case "ArrowRight":
      if (!row.branch) return { kind: "none" };
      return row.expanded
        ? { kind: "focus", id: rows[index + 1].id }
        : { kind: "expand", id: row.id, open: true };
    case "ArrowLeft":
      if (row.branch && row.expanded) {
        return { kind: "expand", id: row.id, open: false };
      }
      return row.parentId === undefined
        ? { kind: "none" }
        : { kind: "focus", id: row.parentId };
    default:
      return { kind: "none" };
  }
}
