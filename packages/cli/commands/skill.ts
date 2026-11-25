// `lophn skill list|check`: workspace에서 발견된 skill(제외된 skipped 포함)을 보고, skill 폴더 하나를 런타임 규칙으로 검증한다.
// 둘 다 읽기 전용이고 lophn agent와 사람·coding agent 터미널이 같은 명령을 쓴다.
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  skillsCheck,
  skillsList,
} from "../../protocol/lophn-agent/skill-settings.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { type CommandContext, defineCommand } from "./types.ts";

function workspaceFlags(
  input: { project?: string; app?: string },
  ctx: CommandContext,
): Result<{ project?: string; app?: string }> {
  if (input.project !== undefined && input.app !== undefined) {
    return err({
      code: "invalid_input",
      message: "pass either --project or --app, not both",
    });
  }
  if (input.project !== undefined) return ok({ project: input.project });
  if (input.app !== undefined) return ok({ app: input.app });
  if (ctx.workspace?.kind === "project") {
    return ok({ project: ctx.workspace.id });
  }
  if (ctx.workspace?.kind === "app") {
    return ok({ app: ctx.workspace.id });
  }
  return ok({});
}

const list = defineCommand({
  name: "skill.list",
  summary: "List discovered skills and any skipped skill folders",
  description:
    "List every skill discovered for this workspace (name, source, enabled, can_disable, description, path) together with skipped bundles and their reasons. In a terminal outside a workspace, pass --project <name-or-id> or --app <slug-or-id>, or omit both for Home.",
  input: z.strictObject({
    project: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Project name or ID (human terminal only; defaults to current workspace or Home)",
      ),
    app: z
      .string()
      .min(1)
      .optional()
      .describe(
        "App slug or ID (human terminal only; defaults to current workspace or Home)",
      ),
  }),
  effect: "read",
  routes: [skillsList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const scope = workspaceFlags(input, ctx);
    if (!scope.ok) return scope;
    const read = await ctx.core.read(skillsList, scope.value);
    if (!read.ok) return read;
    const { skills, skipped } = read.value;
    return ok({
      summary:
        skipped.length === 0
          ? `${skills.length} skills`
          : `${skills.length} skills (${skipped.length} skipped)`,
      content: { skills, skipped },
      arrayKeys: ["skills", "skipped"],
    });
  },
});

const check = defineCommand({
  name: "skill.check",
  summary: "Validate a skill folder against lophn's skill rules",
  description:
    "Check a skill directory using lophn's runtime parser and limits: SKILL.md frontmatter, folder name match, 24 KiB size caps, flat .md companions, symlink prohibition, unfinished placeholders, code fences, and warnings. Inside an agent session, path must lie inside the session's read scope.",
  input: z.strictObject({
    path: z.string().min(1).describe("Path to the skill folder to validate"),
    project: z
      .string()
      .min(1)
      .optional()
      .describe("Project name or ID for shadow checks (human terminal only)"),
    app: z
      .string()
      .min(1)
      .optional()
      .describe("App slug or ID for shadow checks (human terminal only)"),
  }),
  positional: ["path"],
  effect: "read",
  routes: [skillsCheck],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const scope = workspaceFlags(input, ctx);
    if (!scope.ok) return scope;
    // symlink 폴더 자체를 검사할 수 있도록 realpath로 풀지 않고 cwd 기준 절대 경로만 만든다.
    const targetPath =
      !isAbsolute(input.path) && ctx.cwd !== undefined
        ? resolve(ctx.cwd, input.path)
        : input.path;
    const checked = await ctx.core.read(skillsCheck, {
      ...scope.value,
      path: targetPath,
    });
    if (!checked.ok) return checked;
    const result = checked.value;
    const label = result.name ?? targetPath;
    const warnNote =
      result.warnings.length === 0
        ? ""
        : ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})`;
    return ok({
      summary: result.ok
        ? `skill ${label} passed${warnNote}`
        : `skill ${label} failed (${result.errors.length} error${result.errors.length === 1 ? "" : "s"}${result.warnings.length === 0 ? "" : `, ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`})`,
      content: result,
    });
  },
});

export const SKILL_COMMANDS = [list, check];
