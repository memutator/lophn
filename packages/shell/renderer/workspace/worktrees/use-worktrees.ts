// 한 기계·한 project의 worktree 목록과 상태. `WorktreesChanged`면 다시 읽고 `WorktreeStatusChanged`면 그 줄의 상태만 바꾼다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WORKTREE_SETTINGS,
  type WorktreeEntry,
  type WorktreeGitStatus,
  type WorktreeSettings,
} from "../../../../protocol/projects/worktrees.ts";
import type { MachineData } from "../../desktop/machines/data.ts";
import { createWorktreesSource, type WorktreesSource } from "./source.ts";

export interface ProjectWorktrees {
  /** `removed`를 뺀 줄. 만든 순서다. */
  readonly entries: readonly WorktreeEntry[];
  /** 세션·터미널을 열 수 있는 줄(`ready`이고 디스크에 있다). */
  readonly ready: readonly WorktreeEntry[];
  readonly settings: WorktreeSettings;
  /** 이 자격으로 만들기·지우기를 할 수 있다(다른 컴퓨터는 터미널 입력 허락). */
  readonly canMutate: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly source: WorktreesSource | null;
  byId(id: string | null | undefined): WorktreeEntry | undefined;
  /** 그 경로가 든 worktree(경로 자신이거나 그 안). */
  byPath(path: string): WorktreeEntry | undefined;
  reload(): void;
}

const inside = (root: string, path: string) =>
  path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`);

export function isReadyEntry(entry: WorktreeEntry): boolean {
  return entry.record.status === "ready" && entry.status.presence === "present";
}

/** 브랜치 이름(없으면 `detached @ <sha7>`, 그도 없으면 label). */
export function branchLabelOf(entry: WorktreeEntry): string {
  const branch = entry.status.branch ?? entry.record.branch;
  if (branch !== null) return branch;
  const sha = entry.status.head_sha;
  return sha === null ? entry.record.label : `detached @ ${sha.slice(0, 7)}`;
}

/** 고유 바뀐 파일 수(staged ∪ unstaged ∪ untracked ∪ conflicted 근사). */
export function changedCountOf(status: WorktreeGitStatus): number {
  return (
    status.staged_count +
    status.unstaged_count +
    status.untracked_count +
    status.conflicted_count
  );
}

export function useProjectWorktrees(
  data: MachineData | null,
  projectId: string | null,
): ProjectWorktrees {
  const [entries, setEntries] = useState<readonly WorktreeEntry[]>([]);
  const [settings, setSettings] = useState<WorktreeSettings>(
    DEFAULT_WORKTREE_SETTINGS,
  );
  const [canMutate, setCanMutate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useMemo(
    () => (data === null ? null : createWorktreesSource(data.core)),
    [data],
  );
  // 읽기가 겹치면 마지막 것만 받는다.
  const round = useRef(0);

  const fetchList = useCallback(async () => {
    const mine = ++round.current;
    if (source === null || projectId === null) {
      setEntries([]);
      setLoaded(true);
      return;
    }
    const res = await source.list(projectId);
    if (mine !== round.current) return;
    setLoaded(true);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setError(null);
    setEntries(
      res.value.worktrees.filter((one) => one.record.status !== "removed"),
    );
    setSettings(res.value.settings);
    setCanMutate(res.value.can_mutate);
  }, [source, projectId]);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setEntries([]);
    void fetchList();
    if (data === null || projectId === null) {
      return () => {
        alive = false;
      };
    }
    const stop = data.events.subscribe(
      { types: ["WorktreesChanged", "WorktreeStatusChanged"] },
      (message) => {
        if (!alive) return;
        if (message.kind === "ready") {
          void fetchList();
          return;
        }
        if (message.kind !== "event") return;
        const ev = message.event;
        if (
          ev.type === "WorktreesChanged" &&
          ev.payload.project === projectId
        ) {
          void fetchList();
        } else if (
          ev.type === "WorktreeStatusChanged" &&
          ev.payload.project === projectId
        ) {
          const status = ev.payload.status;
          setEntries((prev) =>
            prev.map((one) =>
              one.record.id === status.worktree_id ? { ...one, status } : one,
            ),
          );
        }
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, [data, projectId, fetchList]);

  const ready = useMemo(() => entries.filter(isReadyEntry), [entries]);
  return {
    entries,
    ready,
    settings,
    canMutate,
    loaded,
    error,
    source,
    byId: (id) =>
      id == null ? undefined : entries.find((one) => one.record.id === id),
    byPath: (path) =>
      entries
        .filter((one) => inside(one.record.path, path))
        .sort((a, b) => b.record.path.length - a.record.path.length)[0],
    reload: () => void fetchList(),
  };
}
