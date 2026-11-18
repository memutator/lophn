// `lophn project clone|share|identity`: 기계를 넘는 project를 다룬다. 다른 기계의 project를 이 기계에 받고,
// 저장소가 어느 기계에서도 같은 project가 되게 id file을 만들고, 그 상태를 본다.
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  type ProjectIdentityStatus,
  projectClone,
  projectIdentityApi,
} from "../../protocol/projects/mod.ts";
import {
  absolutePathSchema,
  projectIdentitySchema,
  projectIdSchema,
} from "../../protocol/projects/values.ts";
import { defineCommand } from "./types.ts";
import type { CommandContext } from "./types.ts";

const FILE_STATE: Record<ProjectIdentityStatus["file"], string> = {
  none: "no file",
  committed: "committed",
  uncommitted: "not committed",
  ignored: "ignored by .gitignore",
  conflict: "merge conflict",
  missing: "file missing",
  unreadable: "file unreadable",
};

// project 칸이 없으면 이 session의 project다.
function projectOf(
  input: { project?: string },
  ctx: CommandContext,
): Result<string, LophnError> {
  if (input.project !== undefined) return ok(input.project);
  return ctx.workspace?.kind === "project"
    ? ok(ctx.workspace.id)
    : err({
        code: "invalid_input",
        message:
          "give the project ID (`--project`); this is not a project workspace",
      });
}

const statusSummary = (status: ProjectIdentityStatus): string =>
  `${status.identity ?? "no id"} · ${status.repo === "none" ? "not in git, stays on this computer" : FILE_STATE[status.file]}`;

const projectInput = z.strictObject({ project: projectIdSchema.optional() });

const clone = defineCommand({
  name: "project.clone",
  summary: "Clone a project from a git URL onto this computer",
  description:
    "Clone a repository into the folder where this computer keeps projects and register it as a project. Call it when the person wants to use a project that is not on this computer. Give the repository URL without any credential (never put a token in the URL): this computer's own git sign-in is used and lophn never asks for a password. If it fails with projects_folder_unset, ask the person once which folder to keep projects in on this computer and pass it as --parent; lophn remembers it. If it fails with git_auth, show the person details.command, ask them to run it in a terminal, and wait. Pass --identity (a pri_ ID from the other computer) to make sure the repository is the project you mean and to skip the clone when it is already here. If the result has a note, pass it to the person as it is.",
  input: z.strictObject({
    url: z.string().min(1).max(2048),
    parent: absolutePathSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    title: z.string().min(1).optional(),
    identity: projectIdentitySchema.optional(),
  }),
  positional: ["url"],
  effect: "external",
  routes: [projectClone],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const done = await ctx.core.read(projectClone, input);
    if (!done.ok) return done;
    const { path, cloned, note } = done.value;
    return ok({
      summary: cloned ? `cloned to ${path}` : `already at ${path}`,
      content: done.value,
      ...(cloned && note !== null ? { note } : {}),
    });
  },
});

const share = defineCommand({
  name: "project.share",
  summary: "Make this repository the same project on every computer",
  description:
    "Create `.lophn-project.json` in the project's repository so the repository becomes the same project on the person's other computers. It does not overwrite a file that already reads. When the file conflicts in a git merge, lophn uses the smaller ID. Commit the file only when the person has handed commits to you; otherwise tell them it is not committed yet.",
  input: projectInput,
  effect: "write",
  routes: [projectIdentityApi.createIdentity],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const project = projectOf(input, ctx);
    if (!project.ok) return project;
    const done = await ctx.core.read(projectIdentityApi.createIdentity, {
      project: project.value,
    });
    if (!done.ok) return done;
    return ok({ summary: statusSummary(done.value), content: done.value });
  },
});

const identity = defineCommand({
  name: "project.identity",
  summary: "Read the cross-computer ID of a project",
  description:
    "Read a project's ID that is the same on every computer (`pri_…`), the state of its `.lophn-project.json` (none, committed, uncommitted, ignored, conflict, missing, unreadable), and its git remote. A project outside git (repo none) also has an ID, but it stays on this computer.",
  input: projectInput,
  effect: "read",
  routes: [projectIdentityApi.identity],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const project = projectOf(input, ctx);
    if (!project.ok) return project;
    const done = await ctx.core.read(projectIdentityApi.identity, {
      project: project.value,
    });
    if (!done.ok) return done;
    return ok({ summary: statusSummary(done.value), content: done.value });
  },
});

export const PROJECT_COMMANDS = [clone, share, identity];
