// Source Control 화면의 순수 계산: 묶음 나누기, 상태 문자, 압축 디렉터리 tree, unified diff 읽기.
import type { SourceControlFile } from "../../../../protocol/projects/source-control.ts";

export type Section = "conflicts" | "staged" | "changes";

/** 파일 줄의 한 글자 상태(spec 5.2.2와 같은 글자). */
export type StatusLetter = "M" | "A" | "D" | "R" | "U" | "C";

export function letterOf(
  file: SourceControlFile,
  section: Section,
): StatusLetter {
  if (section === "conflicts" || file.conflicted) return "C";
  if (section === "changes" && file.untracked) return "U";
  const code = section === "staged" ? file.index_status : file.worktree_status;
  if (code === "A") return "A";
  if (code === "D") return "D";
  if (code === "R") return "R";
  if (code === "C") return "A";
  if (code === "?") return "U";
  return "M";
}

export interface Groups {
  readonly conflicts: readonly SourceControlFile[];
  readonly staged: readonly SourceControlFile[];
  readonly changes: readonly SourceControlFile[];
  /** 고유 경로 수(사이드바 배지). */
  readonly unique: number;
}

const byPath = (a: SourceControlFile, b: SourceControlFile) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function groupFiles(
  files: readonly SourceControlFile[],
  filter: string,
): Groups {
  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ""
      ? files
      : files.filter((file) => file.path.toLowerCase().includes(needle));
  return {
    conflicts: shown.filter((file) => file.conflicted).sort(byPath),
    staged: shown
      .filter((file) => file.staged && !file.conflicted)
      .sort(byPath),
    changes: shown
      .filter((file) => (file.unstaged || file.untracked) && !file.conflicted)
      .sort(byPath),
    unique: new Set(files.map((file) => file.path)).size,
  };
}

/** 삭제 충돌(한쪽이 지웠다): Keep File·Keep Deletion을 보인다. */
export function isDeleteConflict(file: SourceControlFile): boolean {
  return (
    file.conflicted &&
    (file.index_status === "D" || file.worktree_status === "D")
  );
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirName = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export type TreeNode =
  | {
      readonly kind: "dir";
      /** 압축한 이름(`a/b/c`). */
      readonly name: string;
      /** 체크아웃 기준 상대 경로. */
      readonly path: string;
      readonly children: readonly TreeNode[];
      /** 그 아래 모든 파일. 디렉터리 단위 stage·discard가 쓴다. */
      readonly files: readonly SourceControlFile[];
    }
  | { readonly kind: "file"; readonly file: SourceControlFile };

interface Building {
  dirs: Map<string, Building>;
  files: SourceControlFile[];
}

/** 디렉터리 우선, 이름순. 자식이 디렉터리 하나뿐인 사슬은 `a/b/c` 한 줄로 줄인다. */
export function buildTree(files: readonly SourceControlFile[]): TreeNode[] {
  const root: Building = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let at = root;
    for (const part of parts.slice(0, -1)) {
      let next = at.dirs.get(part);
      if (next === undefined) {
        next = { dirs: new Map(), files: [] };
        at.dirs.set(part, next);
      }
      at = next;
    }
    at.files.push(file);
  }
  const all = (node: Building): SourceControlFile[] => [
    ...node.files,
    ...[...node.dirs.values()].flatMap(all),
  ];
  const convert = (node: Building, prefix: string): TreeNode[] => {
    const dirs = [...node.dirs.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, child]): TreeNode => {
        let label = name;
        let path = prefix === "" ? name : `${prefix}/${name}`;
        let current = child;
        while (current.files.length === 0 && current.dirs.size === 1) {
          const [only, next] = [...current.dirs.entries()][0]!;
          label = `${label}/${only}`;
          path = `${path}/${only}`;
          current = next;
        }
        return {
          kind: "dir",
          name: label,
          path,
          children: convert(current, path),
          files: all(current),
        };
      });
    const leaves = [...node.files]
      .sort(byPath)
      .map((file): TreeNode => ({ kind: "file", file }));
    return [...dirs, ...leaves];
  };
  return convert(root, "");
}

// ---- unified diff ----

export interface DiffRow {
  readonly kind: "add" | "del" | "ctx" | "hunk" | "note";
  readonly text: string;
  readonly oldNo?: number;
  readonly newNo?: number;
}

export interface ParsedDiff {
  readonly rows: readonly DiffRow[];
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  /** 변경 덩어리(hunk)의 시작 줄 index. 다음/이전 변경이 쓴다. */
  readonly hunks: readonly number[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(text: string): ParsedDiff {
  const rows: DiffRow[] = [];
  const hunks: number[] = [];
  let additions = 0;
  let deletions = 0;
  let binary = false;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      hunks.push(rows.length);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk) {
      if (
        /^Binary files .* differ$/.test(line) ||
        line === "GIT binary patch"
      ) {
        binary = true;
      }
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), newNo });
      newNo += 1;
      additions += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), oldNo });
      oldNo += 1;
      deletions += 1;
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", text: line.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "note", text: line.slice(1).trim() });
    }
  }
  return { rows, additions, deletions, binary, hunks };
}

/** 옆으로 놓기: 지운 줄과 더한 줄을 짝지어 한 줄에 둔다. */
export interface SplitRow {
  readonly kind: "pair" | "hunk" | "note";
  readonly left?: DiffRow;
  readonly right?: DiffRow;
  readonly text?: string;
}

export function splitRows(rows: readonly DiffRow[]): {
  readonly rows: readonly SplitRow[];
  readonly hunks: readonly number[];
} {
  const out: SplitRow[] = [];
  const hunks: number[] = [];
  let dels: DiffRow[] = [];
  let adds: DiffRow[] = [];
  const flush = () => {
    const count = Math.max(dels.length, adds.length);
    for (let i = 0; i < count; i += 1) {
      out.push({
        kind: "pair",
        ...(dels[i] === undefined ? {} : { left: dels[i] }),
        ...(adds[i] === undefined ? {} : { right: adds[i] }),
      });
    }
    dels = [];
    adds = [];
  };
  for (const row of rows) {
    if (row.kind === "del") dels.push(row);
    else if (row.kind === "add") adds.push(row);
    else {
      flush();
      if (row.kind === "hunk") {
        hunks.push(out.length);
        out.push({ kind: "hunk", text: row.text });
      } else if (row.kind === "note")
        out.push({ kind: "note", text: row.text });
      else out.push({ kind: "pair", left: row, right: row });
    }
  }
  flush();
  return { rows: out, hunks };
}

// ---- 그 밖 ----

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg") return "image/jpeg";
  if (ext === "ico") return "image/x-icon";
  return `image/${ext}`;
}
