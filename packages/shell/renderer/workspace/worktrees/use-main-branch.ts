// 원래 폴더(project 등록 폴더)마다 지금 브랜치. worktree가 있을 때만 탭·세션 꼬리표와 + 메뉴의 `Main (<branch>)`가 쓴다.
// 감시는 core가 worktree에만 걸어 원래 폴더는 worktree 목록이 바뀔 때와 창이 focus를 받을 때 다시 읽는다.
import { useEffect, useMemo, useState } from "react";
import type { SourceControlSource } from "./source.ts";

export function useMainBranches(
  source: SourceControlSource | null,
  project: string | null,
  folders: readonly string[],
  /** 꺼져 있으면 읽지 않고 빈 표다(worktree가 없는 project). */
  enabled: boolean,
  /** 바뀌면 다시 읽는다(worktree 목록의 판). */
  round: unknown,
): ReadonlyMap<string, string> {
  const [branches, setBranches] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const key = folders.join("\n");
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setFocus((n) => n + 1);
    globalThis.addEventListener("focus", tick);
    return () => globalThis.removeEventListener("focus", tick);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || source === null || project === null) {
      setBranches(new Map());
      return;
    }
    let live = true;
    void Promise.all(
      folders.map(async (folder) => {
        const read = await source.status({ project, folder });
        if (!read.ok) return null;
        const branch =
          read.value.branch ??
          (read.value.head_sha === null
            ? null
            : `detached @ ${read.value.head_sha.slice(0, 7)}`);
        return branch === null ? null : ([folder, branch] as const);
      }),
    ).then((pairs) => {
      if (!live) return;
      setBranches(
        new Map(pairs.filter((pair) => pair !== null) as [string, string][]),
      );
    });
    return () => {
      live = false;
    };
  }, [source, project, key, enabled, round, focus]);
  return useMemo(() => branches, [branches]);
}
