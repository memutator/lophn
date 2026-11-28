// 앱 view의 project 읽기 main service. 앱이 project를 따로 만들지 않고 lophn project를 기준으로 쓰게 한다.
// agent 길처럼 사람 자격(`coreInternal`. 다른 기계의 view는 그 기계가 보는 이 컴퓨터의 기기 자격)으로 core에 간다. 앱 code(AI가 만든 code일 수 있다)에는 이름과
// 상태, 기계를 넘는 id와 옛 id만 주고 폴더 path는 주지 않는다. 폴더는 지금 열린 project의 것만 `place.workspace`로 간다.
import type {
  AppProject,
  AppWorktree,
  AppWorktreeStatus,
} from "../../../protocol/shell/app-bridge-types.ts";
import type { CallOutcome } from "./app-call.ts";
import type { MachineCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppProjectsDeps {
  call: MachineCaller;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function projectOf(value: unknown): AppProject | undefined {
  const row = record(value);
  if (
    typeof row?.id !== "string" ||
    typeof row.identity !== "string" ||
    typeof row.name !== "string" ||
    typeof row.title !== "string" ||
    typeof row.purpose !== "string" ||
    (row.status !== "active" && row.status !== "archived")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    identity: row.identity,
    formerIdentities: Array.isArray(row.former_identities)
      ? row.former_identities.filter((id) => typeof id === "string")
      : [],
    name: row.name,
    title: row.title,
    purpose: row.purpose,
    status: row.status,
  };
}

function worktreeStatusOf(value: unknown): AppWorktreeStatus | undefined {
  const row = record(value);
  if (
    row === undefined ||
    (row.presence !== "present" &&
      row.presence !== "missing" &&
      row.presence !== "unmounted") ||
    typeof row.detached !== "boolean" ||
    typeof row.dirty !== "boolean" ||
    typeof row.staged_count !== "number" ||
    typeof row.unstaged_count !== "number" ||
    typeof row.untracked_count !== "number" ||
    typeof row.conflicted_count !== "number" ||
    typeof row.updated_at !== "string"
  ) {
    return undefined;
  }
  return {
    presence: row.presence,
    branch: typeof row.branch === "string" ? row.branch : null,
    detached: row.detached,
    head_sha: typeof row.head_sha === "string" ? row.head_sha : null,
    dirty: row.dirty,
    staged_count: row.staged_count,
    unstaged_count: row.unstaged_count,
    untracked_count: row.untracked_count,
    conflicted_count: row.conflicted_count,
    ahead: typeof row.ahead === "number" ? row.ahead : null,
    behind: typeof row.behind === "number" ? row.behind : null,
    updated_at: row.updated_at,
  };
}

function worktreeOf(value: unknown): AppWorktree | undefined {
  const entry = record(value);
  const rec = record(entry?.record);
  const git = worktreeStatusOf(entry?.status);
  if (
    rec === undefined ||
    git === undefined ||
    typeof rec.id !== "string" ||
    typeof rec.project_id !== "string" ||
    typeof rec.label !== "string" ||
    typeof rec.created_at !== "string" ||
    typeof rec.updated_at !== "string"
  ) {
    return undefined;
  }
  if (rec.provenance !== "managed" && rec.provenance !== "adopted") {
    return undefined;
  }
  if (
    rec.status !== "creating" &&
    rec.status !== "ready" &&
    rec.status !== "missing" &&
    rec.status !== "removing" &&
    rec.status !== "removed"
  ) {
    return undefined;
  }
  // 앱 code에는 파일시스템 경로(path·repo_root·git_common_dir)를 주지 않는다.
  return {
    id: rec.id,
    project_id: rec.project_id,
    label: rec.label,
    branch: typeof rec.branch === "string" ? rec.branch : null,
    base_ref: typeof rec.base_ref === "string" ? rec.base_ref : null,
    provenance: rec.provenance,
    status: rec.status,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    git,
  };
}

export function createAppProjects(deps: AppProjectsDeps) {
  const list = async (
    view: BoundView,
  ): Promise<CallOutcome<{ projects: AppProject[] }>> => {
    const projects: AppProject[] = [];
    let cursor: string | undefined;
    do {
      const reply = await deps.call(view.machine)("read", "projects", "list", {
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!reply.ok) {
        return reply.error.code === "conflict"
          ? {
              ok: false,
              error: { code: "conflict", message: "projects changed" },
            }
          : {
              ok: false,
              error: {
                code: "unavailable",
                message: "core is not available",
              },
            };
      }
      const value = record(reply.value);
      const rows = Array.isArray(value?.projects) ? value.projects : [];
      for (const row of rows) {
        const project = projectOf(row);
        if (project !== undefined) projects.push(project);
      }
      cursor =
        typeof value?.next_cursor === "string" ? value.next_cursor : undefined;
    } while (cursor !== undefined);
    return { ok: true, value: { projects } };
  };

  return {
    /** 모든 project(보관 포함). 페이지를 끝까지 읽는다. 읽는 사이 목록이 바뀌면 conflict라 앱이 다시 읽는다. */
    list,
    /**
     * project 하나의 git worktree 목록(읽기 전용, 경로 미포함).
     * `project`는 `prj_` id, `pri_` identity, 또는 project 이름이다.
     */
    async worktrees(
      view: BoundView,
      input: unknown,
    ): Promise<CallOutcome<{ worktrees: AppWorktree[] }>> {
      const body = record(input);
      const ref = typeof body?.project === "string" ? body.project.trim() : "";
      if (ref === "") {
        return {
          ok: false,
          error: { code: "invalid_input", message: "project is required" },
        };
      }
      let projectId = ref;
      if (!ref.startsWith("prj_")) {
        const listed = await list(view);
        if (!listed.ok) return listed;
        const found = listed.value.projects.find(
          (p) =>
            p.identity === ref ||
            p.formerIdentities.includes(ref) ||
            p.name === ref,
        );
        if (found === undefined) {
          return {
            ok: false,
            error: { code: "not_found", message: "project not found" },
          };
        }
        projectId = found.id;
      }
      const reply = await deps.call(view.machine)("read", "worktrees", "list", {
        project: projectId,
      });
      if (!reply.ok) {
        return {
          ok: false,
          error: {
            code:
              reply.error.code === "not_found" ||
              reply.error.code === "invalid_input" ||
              reply.error.code === "conflict"
                ? reply.error.code
                : "unavailable",
            message: reply.error.message,
          },
        };
      }
      const value = record(reply.value);
      const raw = Array.isArray(value?.worktrees) ? value.worktrees : [];
      const worktrees: AppWorktree[] = [];
      for (const item of raw) {
        const mapped = worktreeOf(item);
        if (mapped !== undefined) worktrees.push(mapped);
      }
      return { ok: true, value: { worktrees } };
    },
  };
}
