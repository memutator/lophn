// `lophn project clone|identity`: 기계를 넘는 project를 다룬다. 다른 기계의 project를 이 기계에 받고, 기계를 넘는 id를 본다.
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  type ProjectIdentityStatus,
  projectClone,
  projectIdentityApi,
} from "../../protocol/projects/mod.ts";
import {
  absolutePathSchema,
  projectIdSchema,
} from "../../protocol/projects/values.ts";
import { defineCommand } from "./types.ts";
import type { CommandContext } from "./types.ts";

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

function matching(status: ProjectIdentityStatus): string {
  if (status.repo === "none") return "not in git, linked by hand";
  if (status.repo === null) return "folder not read yet";
  if (status.remote === null) return "no git remote, not matched";
  if (status.same_repository !== null) {
    return `${status.same_repository} uses the same repository, neither is matched`;
  }
  return "matched by its repository";
}

const statusSummary = (status: ProjectIdentityStatus): string =>
  `${status.identity} · ${matching(status)}`;

const projectInput = z.strictObject({ project: projectIdSchema.optional() });

const clone = defineCommand({
  name: "project.clone",
  summary: "Clone a project from a git URL onto this computer",
  description:
    "Clone a repository into the folder where this computer keeps projects and register it as a project. Call it when the person wants to use a project that is not on this computer. Give the repository URL without any credential (never put a token in the URL): this computer's own git sign-in is used and lophn never asks for a password. If it fails with projects_folder_unset, ask the person once which folder to keep projects in on this computer and pass it as --parent; lophn remembers it. If it fails with git_auth, show the person details.command, ask them to run it in a terminal, and wait. lophn gives the clone its own ID and then matches it with the same repository on the person's other computers by itself.",
  input: z.strictObject({
    url: z.string().min(1).max(2048),
    parent: absolutePathSchema.optional(),
    name: z.string().min(1).max(255).optional(),
    title: z.string().min(1).optional(),
  }),
  positional: ["url"],
  effect: "external",
  routes: [projectClone],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const done = await ctx.core.read(projectClone, input);
    if (!done.ok) return done;
    const { path, cloned } = done.value;
    return ok({
      summary: cloned ? `cloned to ${path}` : `already at ${path}`,
      content: done.value,
    });
  },
});

const identity = defineCommand({
  name: "project.identity",
  summary: "Read the cross-computer ID of a project",
  description:
    "Read a project's ID that is the same on all of the person's computers (`pri_…`), whether it is in git, and its git remote. lophn matches a git project with the project of the same repository on the person's other computers by itself; nothing is written to the repository. A project outside git (repo none) is linked to another computer's project only by the person.",
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

export const PROJECT_COMMANDS = [clone, identity];
