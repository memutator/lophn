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
const REMOTE_REFRESH_MS = 15_000;
const REMOTE_REFRESH_CONCURRENCY = 3;

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
  const [levels, setLevels] = useState<ReadonlyMap<string, Level>>(() => {
    const initial = new Map<string, Level>();
    if (root !== null) {
      const cached = source.listCached?.(root);
      if (cached !== undefined) initial.set(root, cached);
    }
    return initial;
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef({ levels, expanded, root });
  latest.current = { levels, expanded, root };
  // 폴더마다 가장 늦게 시작한 읽기만 받는다. 만들기·지우기 뒤의 읽기를 오래된 읽기가 덮지 못하게 한다.
  const sequence = useRef(new Map<string, number>());

  const applyEntries = useCallback(
    (path: string, entries: readonly FolderEntry[]) => {
      setLevels((current) => {
        const before = current.get(path);
        if (
          before !== undefined &&
          before !== "failed" &&
          sameEntries(before, entries)
        )
          return current;
        return new Map(current).set(path, entries);
      });
    },
    [],
  );

  const load = useCallback(
    async (path: string, force = false) => {
      const mine = (sequence.current.get(path) ?? 0) + 1;
      sequence.current.set(path, mine);
      const read = await source.list(path, force ? { force: true } : undefined);
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
      applyEntries(path, read.value);
    },
    [source, applyEntries],
  );

  // 원격 SWR의 background 갱신이 바뀐 항목을 받으면 지금 보고 있는 폴더에 반영한다.
  useEffect(() => {
    if (source.onDirectoryUpdated === undefined) return;
    return source.onDirectoryUpdated((path, entries) => {
      const { root: current, expanded: open } = latest.current;
      if (current === null) return;
      if (path === current || open.has(path)) applyEntries(path, entries);
    });
  }, [source, applyEntries]);

  // 루트를 바꾸면 cache된 루트가 있으면 0ms로 먼저 보이고 읽는다.
  useEffect(() => {
    sequence.current = new Map();
    const initial = new Map<string, Level>();
    if (root !== null) {
      const cached = source.listCached?.(root);
      if (cached !== undefined) initial.set(root, cached);
    }
    setLevels(initial);
    setExpanded(new Set());
    if (root !== null) void load(root);
  }, [root, source, load]);

  const refresh = useCallback(() => {
    const { root: current, expanded: open } = latest.current;
    if (current === null) return;
    const targets = [current, ...open];
    if (source.remote !== true) {
      for (const path of targets) void load(path, true);
      return;
    }
    // 원격 workspace는 펼친 폴더가 많아도 remote link를 채우지 않도록 동시 갱신 수를 묶는다.
    let index = 0;
    const worker = async () => {
      while (index < targets.length) {
        const path = targets[index]!;
        index += 1;
        await load(path, true);
      }
    };
    const count = Math.min(REMOTE_REFRESH_CONCURRENCY, targets.length);
    for (let i = 0; i < count; i += 1) void worker();
  }, [load, source.remote]);

  useEffect(() => {
    if (root === null) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = source.remote === true ? REMOTE_REFRESH_MS : REFRESH_MS;
    const timer = setInterval(tick, interval);
    globalThis.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", tick);
    };
  }, [root, refresh, source.remote]);

  /** 폴더를 펼친다. cache가 있으면 0ms로 먼저 채우고 갱신한다. */
  const expand = useCallback(
    (path: string) => {
      setExpanded((current) =>
        current.has(path) ? current : new Set(current).add(path),
      );
      if (!latest.current.levels.has(path)) {
        const cached = source.listCached?.(path);
        if (cached !== undefined) applyEntries(path, cached);
        void load(path);
      }
    },
    [load, source, applyEntries],
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
