// Explorer tree가 읽은 폴더들. 루트와 펼친 폴더만 한 단계씩 읽고 읽은 결과는 루트를 바꿀 때까지 둔다.
import { useCallback, useEffect, useState } from "react";

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

const join = (folder: string, name: string) =>
  `${folder.replace(/\/+$/, "")}/${name}`;

export function useFileTree(source: WorkspaceSource, root: string | null) {
  const [levels, setLevels] = useState<ReadonlyMap<string, Level>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback((path: string) => {
    void source.list(path).then((read) => {
      setLevels((current) =>
        new Map(current).set(path, read.ok ? read.value : "failed")
      );
    });
  }, [source]);

  // 루트를 바꾸면 처음부터 다시 읽는다.
  useEffect(() => {
    setLevels(new Map());
    setExpanded(new Set());
    if (root !== null) load(root);
  }, [root, load]);

  const toggle = useCallback((path: string) => {
    const open = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
    if (open && !levels.has(path)) load(path);
  }, [expanded, levels, load]);

  const rows: FileRow[] = [];
  const walk = (folder: string, depth: number) => {
    const level = levels.get(folder);
    if (level === undefined || level === "failed") return;
    for (const entry of level) {
      const id = join(folder, entry.name);
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

  // 읽지 못한 폴더. 루트면 tree 전체가 비고, 하위면 그 폴더만 비어 보인다.
  const failed = root !== null && levels.get(root) === "failed";
  return { rows, toggle, failed };
}
