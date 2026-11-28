import { useCallback, useEffect, useRef, useState } from "react";
import type { EventBridge } from "./use-event.ts";

// 앱 view preload bridge `lophnApp.projects.worktrees`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).
// 경로(path·repo_root·git_common_dir)는 앱 code에 넘기지 않는다.

export type WorktreePresence = "present" | "missing" | "unmounted";

export type WorktreeProvenance = "managed" | "adopted";

export type WorktreeStatus =
  | "creating"
  | "ready"
  | "missing"
  | "removing"
  | "removed";

export interface WorktreeGitStatus {
  presence: WorktreePresence;
  branch: string | null;
  detached: boolean;
  head_sha: string | null;
  dirty: boolean;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  conflicted_count: number;
  ahead: number | null;
  behind: number | null;
  updated_at: string;
}

/**
 * project의 git worktree 한 줄(읽기 전용, 파일시스템 경로 미포함).
 */
export interface Worktree {
  id: string;
  project_id: string;
  label: string;
  branch: string | null;
  base_ref: string | null;
  provenance: WorktreeProvenance;
  status: WorktreeStatus;
  created_at: string;
  updated_at: string;
  git: WorktreeGitStatus;
}

/** `("lophn", "worktree.changed")` event의 payload. 가벼운 알림이고 목록은 `worktrees()`로 다시 읽는다. */
export interface WorktreeChangedEvent {
  projectId: string;
  projectIdentity: string | null;
  /** null이면 project 전체다. */
  worktreeId: string | null;
  reason: "created" | "removed" | "updated" | "status" | "branch";
  at: string;
}

export const WORKTREE_CHANGED_EVENT = "worktree.changed";

export interface WorktreesBridge {
  projects: {
    worktrees?(
      project: string,
    ): Promise<
      | { ok: true; value: { worktrees: Worktree[] } }
      | { ok: false; error: { code: string; message: string } }
    >;
  };
  events?: EventBridge;
}

function worktreesBridge(): WorktreesBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<WorktreesBridge> }).lophnApp;
  return app?.projects?.worktrees === undefined
    ? undefined
    : (app as WorktreesBridge);
}

export type WorktreesState =
  | { status: "loading" }
  | { status: "ready"; worktrees: Worktree[] }
  | { status: "failed"; code: string };

export interface UseWorktrees {
  state: WorktreesState;
  /** 다시 읽는다. 읽는 동안 state는 이전 값 그대로다. */
  reload: () => void;
}

/**
 * project 하나의 git worktree 목록과 상태를 읽는다(읽기 전용).
 * `project`는 `prj_` id, `pri_` identity, 또는 project 이름이다. `null`·`undefined`면 빈 목록으로 준비한다.
 * 앱 선언의 `subscriptions`에 `{ source: "lophn", event: "worktree.changed" }`를 적었으면 바뀔 때 저절로 다시 읽는다.
 * 적지 않았으면 `reload()`로 읽는다.
 * 앱 view 밖이거나 이 기능이 없는 lophn이면 `failed`(`unavailable`)다.
 */
export function useWorktrees(
  project: string | null | undefined,
  app: WorktreesBridge | undefined = worktreesBridge(),
): UseWorktrees {
  const [state, setState] = useState<WorktreesState>(
    project == null || project === ""
      ? { status: "ready", worktrees: [] }
      : { status: "loading" },
  );
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const resolvedProjectId = useRef<string | null>(
    project?.startsWith("prj_") ? project : null,
  );

  useEffect(() => {
    const mine = ++latest.current;
    if (project == null || project === "") {
      resolvedProjectId.current = null;
      setState({ status: "ready", worktrees: [] });
      return;
    }
    if (app?.projects?.worktrees === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    void app.projects
      .worktrees(project)
      .catch(() => ({ ok: false as const, error: { code: "unavailable" } }))
      .then((reply) => {
        if (mine !== latest.current) return;
        if (reply.ok) {
          const first = reply.value.worktrees[0];
          resolvedProjectId.current =
            first?.project_id ?? (project.startsWith("prj_") ? project : null);
          setState({ status: "ready", worktrees: reply.value.worktrees });
        } else {
          setState({ status: "failed", code: reply.error.code });
        }
      });
  }, [app, project, round]);

  useEffect(() => {
    if (project == null || project === "" || app?.events === undefined) {
      return;
    }
    return app.events.subscribe("lophn", WORKTREE_CHANGED_EVENT, (payload) => {
      const changed = payload as Partial<WorktreeChangedEvent> | null;
      const known = resolvedProjectId.current;
      if (
        known === null ||
        changed?.projectId === known ||
        changed?.projectId === project ||
        changed?.projectIdentity === project
      ) {
        setRound((n) => n + 1);
      }
    });
  }, [app, project]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { state, reload };
}
