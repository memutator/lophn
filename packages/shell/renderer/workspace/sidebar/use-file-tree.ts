// Explorer tree가 읽은 폴더들. 루트와 펼친 폴더만 한 단계씩 읽고, 펼친 폴더는 주기적으로 그리고 창이 다시
// focus를 받을 때 다시 읽어 디스크의 바깥 변경을 따라간다(펼친 폴더 수만큼의 list뿐이라 가볍다).
import { useCallback, useEffect, useRef, useState } from "react";

import type { FolderEntry, WorkspaceSource } from "../source.ts";

export interface FileRow {
  /** 절대 경로. */
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly folder: boolean;
  readonly expanded: boolean;
}

type Level = readonly FolderEntry[] | "failed";

const REFRESH_MS = 3000;

export const joinPath = (folder: string, name: string) =>
  `${folder.replace(/\/+$/, "")}/${name}`;

export const parentOf = (path: string) =>
  path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/";

const sameEntries = (a: readonly FolderEntry[], b: readonly FolderEntry[]) =>
  a.length === b.length &&
  a.every(
    (entry, at) => entry.name === b[at].name && entry.kind === b[at].kind,
  );

export function useFileTree(source: WorkspaceSource, root: string | null) {
  const [levels, setLevels] = useState<ReadonlyMap<string, Level>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef({ levels, expanded, root });
  latest.current = { levels, expanded, root };
  // 폴더마다 가장 늦게 시작한 읽기만 받는다. 만들기·지우기 뒤의 읽기를 오래된 읽기가 덮지 못하게 한다.
  const sequence = useRef(new Map<string, number>());

  const load = useCallback(
    async (path: string) => {
      const mine = (sequence.current.get(path) ?? 0) + 1;
      sequence.current.set(path, mine);
      const read = await source.list(path);
      if (sequence.current.get(path) !== mine) return;
      if (!read.ok) {
        const isRoot = path === latest.current.root;
        const known = latest.current.levels.has(path);
        if (known && !isRoot && read.message === "not_found") {
          // 펼쳐 둔 하위 폴더가 디스크에서 사라졌다.
          setLevels((current) => {
            const next = new Map(current);
            next.delete(path);
            return next;
          });
          setExpanded((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
          return;
        }
        // 이미 읽은 폴더의 다시 읽기가 잠시 실패하면(main이 core를 못 읽는 등) 앞서 읽은 것을 둔다.
        // 실패를 "사라짐"으로 읽으면 펼친 폴더가 저절로 닫힌다.
        if (known) return;
        setLevels((current) => new Map(current).set(path, "failed"));
        return;
      }
      setLevels((current) => {
        const before = current.get(path);
        if (
          before !== undefined &&
          before !== "failed" &&
          sameEntries(before, read.value)
        )
          return current;
        return new Map(current).set(path, read.value);
      });
    },
    [source],
  );

  // 루트를 바꾸면 처음부터 다시 읽는다.
  useEffect(() => {
    sequence.current = new Map();
    setLevels(new Map());
    setExpanded(new Set());
    if (root !== null) void load(root);
  }, [root, load]);

  const refresh = useCallback(() => {
    const { root: current, expanded: open } = latest.current;
    if (current === null) return;
    for (const path of [current, ...open]) void load(path);
  }, [load]);

  useEffect(() => {
    if (root === null) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    globalThis.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", tick);
    };
  }, [root, refresh]);

  /** 폴더를 펼친다. 아직 안 읽었으면 읽는다. */
  const expand = useCallback(
    (path: string) => {
      setExpanded((current) =>
        current.has(path) ? current : new Set(current).add(path),
      );
      if (!latest.current.levels.has(path)) void load(path);
    },
    [load],
  );

  const collapse = useCallback((path: string) => {
    setExpanded((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (path: string) => {
      if (latest.current.expanded.has(path)) collapse(path);
      else expand(path);
    },
    [expand, collapse],
  );

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  /** 루트에서 path의 위쪽 폴더까지 모두 펼친다. 루트 밖이면 아무것도 하지 않는다. */
  const reveal = useCallback(
    (path: string) => {
      const base = latest.current.root;
      if (base === null || !path.startsWith(`${base.replace(/\/+$/, "")}/`)) {
        return;
      }
      let folder = parentOf(path);
      while (folder.length > base.length) {
        expand(folder);
        folder = parentOf(folder);
      }
    },
    [expand],
  );

  const rows: FileRow[] = [];
  const walk = (folder: string, depth: number) => {
    const level = levels.get(folder);
    if (level === undefined || level === "failed") return;
    for (const entry of level) {
      const id = joinPath(folder, entry.name);
      const folderRow = entry.kind === "folder";
      const open = folderRow && expanded.has(id);
      rows.push({
        id,
        name: entry.name,
        depth,
        folder: folderRow,
        expanded: open,
      });
      if (open) walk(id, depth + 1);
    }
  };
  if (root !== null) walk(root, 0);

  /** 읽은 폴더의 항목. 아직 안 읽었거나 읽지 못했으면 undefined. */
  const entriesOf = (folder: string): readonly FolderEntry[] | undefined => {
    const level = levels.get(folder);
    return level === "failed" ? undefined : level;
  };

  // 읽지 못한 폴더. 루트면 tree 전체가 비고, 하위면 그 폴더만 비어 보인다.
  const failed = root !== null && levels.get(root) === "failed";
  return {
    rows,
    failed,
    entriesOf,
    toggle,
    expand,
    collapse,
    collapseAll,
    refresh,
    reveal,
  };
}
