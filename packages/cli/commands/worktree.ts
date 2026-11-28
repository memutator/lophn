// `lophn worktree list|get|create|adopt|status|rename|remove`:
// project의 git worktree를 사람 터미널·coding agent·lophn agent가 같은 명령 표로 다룬다.
// worktree 설정 변경(settings_set)과 source control 쓰기는 사람 화면 전용이므로 CLI 명령으로 두지 않는다.
// `--on <computer>`는 CLI 전역 remoteCore로 처리되며, 원격 변경은 받는 기계의 `terminal_input` 허락이 필요하다.
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  projectApi,
  projectIdSchema,
  type WorktreeEntry,
  type WorktreeGitStatus,
  worktreeLabelSchema,
  worktreesAdopt,
  worktreesCreate,
  worktreesGet,
  worktreesList,
  worktreesRemove,
  worktreesRename,
} from "../../protocol/projects/mod.ts";
import { type CommandContext, defineCommand } from "./types.ts";

const branchArgSchema = z.string().trim().min(1).max(200);

// `--project`는 id(`prj_…`) 또는 이름이다. 생략하면 현재 project workspace(또는 cwd에서 푼 project)를 쓴다.
async function resolveProjectId(
  projectArg: string | undefined,
  ctx: CommandContext,
): Promise<Result<string, LophnError>> {
  if (projectArg !== undefined) {
    if (projectIdSchema.safeParse(projectArg).success) return ok(projectArg);
    const listed = await ctx.core.read(projectApi.list, { status: "active" });
    if (!listed.ok) return listed;
    const match = listed.value.projects.find(
      (one) =>
        one.name === projectArg ||
        one.name.toLowerCase() === projectArg.toLowerCase(),
    );
    return match !== undefined
      ? ok(match.id)
      : err({
          code: "not_found",
          message: `project "${projectArg}" was not found`,
        });
  }
  if (ctx.workspace?.kind === "project") return ok(ctx.workspace.id);
  if (ctx.cwd !== undefined) {
    const resolved = await ctx.core.read(projectApi.resolve, { path: ctx.cwd });
    if (resolved.ok) return ok(resolved.value.project.id);
  }
  return err({
    code: "invalid_input",
    message:
      "specify --project <id or name> (or run inside a registered project folder)",
  });
}

function formatGitStatusShort(status: WorktreeGitStatus): string {
  if (status.presence !== "present") return `[${status.presence}]`;
  const parts: string[] = [];
  parts.push(status.branch ?? (status.detached ? "DETACHED" : "(no branch)"));
  if (
    (status.ahead !== null && status.ahead > 0) ||
    (status.behind !== null && status.behind > 0)
  ) {
    parts.push(`+${status.ahead ?? 0}/-${status.behind ?? 0}`);
  }
  if (status.conflicted_count > 0) {
    parts.push(`${status.conflicted_count} conflicted`);
  }
  if (status.dirty) {
    parts.push(
      `dirty(s:${status.staged_count} u:${status.unstaged_count} ?:${status.untracked_count})`,
    );
  } else {
    parts.push("clean");
  }
  return parts.join(" ");
}

function formatEntryLine(entry: WorktreeEntry): string {
  const { record, status } = entry;
  return `${record.id}  [${record.provenance}/${record.status}]  ${record.label}  ${formatGitStatusShort(status)}  ${record.path}`;
}

const list = defineCommand({
  name: "worktree.list",
  summary: "List git worktrees for a project",
  description:
    "List managed and adopted git worktrees for a project together with git status. Pass --include-external to also show unmanaged linked worktrees that can be adopted.",
  input: z.strictObject({
    project: z.string().min(1).optional(),
    include_external: z.boolean().optional(),
    include_removed: z.boolean().optional(),
  }),
  effect: "read",
  routes: [worktreesList, projectApi.list, projectApi.resolve],
  workspaces: ["project", "home"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const listed = await ctx.core.read(worktreesList, {
      project: project.value,
      ...(input.include_external === true ? { include_external: true } : {}),
      ...(input.include_removed === true ? { include_removed: true } : {}),
    });
    if (!listed.ok) return listed;
    const { worktrees, external = [] } = listed.value;
    const lines = worktrees.map(formatEntryLine);
    if (external.length > 0) {
      lines.push(
        "",
        "External (unmanaged) linked worktrees:",
        ...external.map(
          (e) =>
            `  ${e.path}  ${e.branch ?? "(detached)"}${e.locked ? " [locked]" : ""}`,
        ),
      );
    }
    return ok({
      summary: `${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}${external.length > 0 ? `, ${external.length} external` : ""}`,
      content: { project: project.value, worktrees, external },
      arrayKeys: ["worktrees", "external"],
      text: lines.length === 0 ? "No git worktrees." : lines.join("\n"),
    });
  },
});

const get = defineCommand({
  name: "worktree.get",
  summary: "Show details of a git worktree",
  description:
    "Read the record and current git status of a registered worktree by ID (wkt_...).",
  input: z.strictObject({
    worktree: idSchema("wkt"),
    include_preflight: z.boolean().optional(),
  }),
  positional: ["worktree"],
  effect: "read",
  routes: [worktreesGet],
  workspaces: ["project", "home"],
  run: async (input, ctx) => {
    const res = await ctx.core.read(worktreesGet, {
      worktree: input.worktree,
      ...(input.include_preflight === true ? { include_preflight: true } : {}),
    });
    if (!res.ok) return res;
    const { record, status } = res.value;
    const lines = [
      `id: ${record.id}`,
      `project: ${record.project_id}`,
      `label: ${record.label}`,
      `branch: ${record.branch ?? "(detached)"}`,
      `base_ref: ${record.base_ref ?? "(none)"}`,
      `provenance: ${record.provenance}`,
      `status: ${record.status}`,
      `path: ${record.path}`,
      `repo_root: ${record.repo_root}`,
      `git: ${formatGitStatusShort(status)}`,
    ];
    return ok({
      summary: `${record.id} (${record.label})`,
      content: res.value,
      text: lines.join("\n"),
    });
  },
});

const statusCmd = defineCommand({
  name: "worktree.status",
  summary: "Show live git status of a worktree",
  description:
    "Show git status (presence, branch, HEAD, ahead/behind, staged/unstaged/untracked/conflicted counts) for a worktree.",
  input: z.strictObject({
    worktree: idSchema("wkt"),
  }),
  positional: ["worktree"],
  effect: "read",
  routes: [worktreesGet],
  workspaces: ["project", "home"],
  run: async (input, ctx) => {
    const res = await ctx.core.read(worktreesGet, {
      worktree: input.worktree,
    });
    if (!res.ok) return res;
    const { record, status } = res.value;
    const lines = [
      `worktree: ${record.id} (${record.label})`,
      `path: ${record.path}`,
      `presence: ${status.presence}`,
      `status: ${formatGitStatusShort(status)}`,
      `head: ${status.head_sha ?? "(unborn)"}`,
      `staged: ${status.staged_count}, unstaged: ${status.unstaged_count}, untracked: ${status.untracked_count}, conflicted: ${status.conflicted_count}`,
    ];
    return ok({
      summary: `${record.id}: ${formatGitStatusShort(status)}`,
      content: { worktree: record.id, record_status: record.status, status },
      text: lines.join("\n"),
    });
  },
});

const create = defineCommand({
  name: "worktree.create",
  summary: "Create a new managed git worktree",
  description:
    "Create a new managed git worktree in the project's configured worktrees folder. Automatically creates a new branch (wt/<adj>-<noun>-<4hex>) unless --branch is given, or checks out an existing branch with --from-existing --branch <name>. Pass --folder when the project has multiple git repositories.",
  input: z.strictObject({
    project: z.string().min(1).optional(),
    folder: z.string().min(1).optional(),
    branch: branchArgSchema.optional(),
    base: branchArgSchema.optional(),
    from_existing: z.boolean().optional(),
    label: worktreeLabelSchema.optional(),
    fetch: z.boolean().optional(),
    setup: z.boolean().optional(),
  }),
  effect: "write",
  routes: [worktreesCreate, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const created = await ctx.core.read(worktreesCreate, {
      project: project.value,
      ...(input.folder === undefined ? {} : { folder: input.folder }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.base === undefined ? {} : { base_ref: input.base }),
      ...(input.from_existing === true
        ? { mode: "existing_branch" as const }
        : { mode: "new_branch" as const }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.fetch === undefined ? {} : { fetch_base: input.fetch }),
      ...(input.setup === undefined ? {} : { run_setup: input.setup }),
      idempotency_key: ctx.key,
    });
    if (!created.ok) return created;
    const { record, status, warnings, copied_files, setup } = created.value;
    const lines = [
      `created: ${record.id}`,
      `label: ${record.label}`,
      `branch: ${record.branch ?? "(detached)"}`,
      `path: ${record.path}`,
      `git: ${formatGitStatusShort(status)}`,
      ...(copied_files > 0 ? [`copied_files: ${copied_files}`] : []),
      ...(setup != null
        ? [
            `setup: ${setup.status}${setup.exit_code !== null ? ` (exit ${setup.exit_code})` : ""}`,
          ]
        : []),
      ...warnings.map((w) => `warning: ${w}`),
    ];
    return ok({
      summary: `created ${record.id} (${record.branch ?? record.label}) at ${record.path}`,
      content: created.value,
      text: lines.join("\n"),
    });
  },
});

const adopt = defineCommand({
  name: "worktree.adopt",
  summary: "Adopt an existing external linked git worktree",
  description:
    "Register an existing external linked git worktree (created outside lophn) into the project as an adopted worktree. lophn never deletes an adopted worktree's files from disk when removing it.",
  input: z.strictObject({
    path: z.string().min(1),
    project: z.string().min(1).optional(),
    label: worktreeLabelSchema.optional(),
  }),
  positional: ["path"],
  effect: "write",
  routes: [worktreesAdopt, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const adopted = await ctx.core.read(worktreesAdopt, {
      project: project.value,
      path: input.path,
      ...(input.label === undefined ? {} : { label: input.label }),
    });
    if (!adopted.ok) return adopted;
    const { record, status } = adopted.value;
    return ok({
      summary: `adopted ${record.id} (${record.label}) at ${record.path}`,
      content: adopted.value,
      text: `${record.id}  [adopted]  ${record.label}  ${formatGitStatusShort(status)}  ${record.path}`,
    });
  },
});

const rename = defineCommand({
  name: "worktree.rename",
  summary: "Rename a worktree's display label or branch",
  description:
    "Rename a worktree's display label (--label) and/or rename its git branch (--branch <new> --rename-branch). The worktree directory path never changes.",
  input: z.strictObject({
    worktree: idSchema("wkt"),
    label: worktreeLabelSchema.optional(),
    branch: branchArgSchema.optional(),
    rename_branch: z.boolean().optional(),
  }),
  positional: ["worktree"],
  effect: "write",
  routes: [worktreesRename],
  workspaces: ["project"],
  run: async (input, ctx) => {
    if (input.label === undefined && input.branch === undefined) {
      return err({
        code: "invalid_input",
        message: "specify --label and/or --branch",
      });
    }
    const renamed = await ctx.core.read(worktreesRename, {
      worktree: input.worktree,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.rename_branch === true || input.branch !== undefined
        ? { rename_branch: input.rename_branch ?? true }
        : {}),
    });
    if (!renamed.ok) return renamed;
    const { record, status } = renamed.value;
    return ok({
      summary: `renamed ${record.id} (${record.label}${record.branch ? `, ${record.branch}` : ""})`,
      content: renamed.value,
      text: `${record.id}  ${record.label}  ${formatGitStatusShort(status)}  ${record.path}`,
    });
  },
});

const remove = defineCommand({
  name: "worktree.remove",
  summary: "Remove a git worktree (or detach an adopted worktree)",
  description:
    "Remove a managed git worktree from disk or detach an adopted worktree from lophn without touching its files. Preserves the git branch by default unless --delete-branch (or --force-delete-branch) is passed. When called by an agent, asks for human or parent approval.",
  input: z.strictObject({
    worktree: idSchema("wkt"),
    force: z.boolean().optional(),
    stop_sessions: z.boolean().optional(),
    delete_branch: z.boolean().optional(),
    force_delete_branch: z.boolean().optional(),
    allow_failed_teardown: z.boolean().optional(),
  }),
  positional: ["worktree"],
  effect: "write",
  routes: [worktreesRemove],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const removed = await ctx.core.read(worktreesRemove, {
      worktree: input.worktree,
      ...(input.force === true ? { force: true } : {}),
      ...(input.stop_sessions === true ? { stop_sessions: true } : {}),
      ...(input.delete_branch === true ? { delete_branch: true } : {}),
      ...(input.force_delete_branch === true
        ? { force_delete_branch: true }
        : {}),
      ...(input.allow_failed_teardown === true
        ? { allow_failed_teardown: true }
        : {}),
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!removed.ok) return removed;
    const { untrack_only, branch_deleted, preserved_branch } = removed.value;
    const lines = [
      untrack_only
        ? `detached: ${input.worktree} (files untouched)`
        : `removed: ${input.worktree}`,
      ...(branch_deleted ? ["branch_deleted: true"] : []),
      ...(preserved_branch !== null
        ? [
            `preserved_branch: ${preserved_branch.name} (${preserved_branch.reason})`,
          ]
        : []),
    ];
    return ok({
      summary: untrack_only
        ? `detached ${input.worktree}`
        : `removed ${input.worktree}`,
      content: { worktree: input.worktree, ...removed.value },
      text: lines.join("\n"),
    });
  },
});

export const WORKTREE_COMMANDS = [
  list,
  get,
  statusCmd,
  create,
  adopt,
  rename,
  remove,
];
