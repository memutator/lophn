// `lophn skill list|check`: workspace에서 발견된 skill(제외된 skipped 포함)을 보고, skill 폴더 하나를 런타임 규칙으로 검증한다.
// 둘 다 읽기 전용이고 lophn agent와 사람·coding agent 터미널이 같은 명령을 쓴다.
// `lophn skill deploy|undeploy|deployments`: 앱의 public skill을 전역, workspace, agent 층에 배포하고 거두고 읽는다.
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  skillsCheck,
  skillsDeploy,
  skillsDeployments,
  skillsList,
  skillsUndeploy,
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

// `--to`의 `workspace`는 부른 session의 workspace(사람의 터미널은 `LOPHN_WORKSPACE`, 없으면 Home)로 풀어 core에 `workspace:<id>`로 보낸다.
function placeOf(to: string, ctx: CommandContext): string {
  if (to !== "workspace") return to;
  return `workspace:${ctx.workspace === null || ctx.workspace === undefined ? "home" : ctx.workspace.id}`;
}

const deployInput = z.strictObject({
  app: z.string().min(1).describe("App slug"),
  skill: z.string().min(1).describe("Name of one of the app's public skills"),
  to: z
    .string()
    .min(1)
    .describe(
      "Where: global (every agent), harness (the coding agents in terminals), workspace (this workspace) or workspace:<project, app or home>, agent:<handle>[@<workspace>][@<workspace>]",
    ),
});

const deploy = defineCommand({
  name: "skill.deploy",
  summary:
    "Deploy an app's public skill to every agent, a workspace, an agent or the terminal coding agents",
  description:
    "Deploy one public skill of an app (its slug and the skill name, from the app's active release) so agents that receive it know the app and call its commands without asking. For lophn agents the record points at the app's own skill, so it follows the active release. --to global gives it to every agent, --to workspace (or workspace:<project, app slug or home>) to the agents that run in that workspace, --to agent:<handle> to one agent (every workspace has a lophn: write agent:lophn@<workspace>, where <workspace> is home, a project or an app slug; an agent that gives none means the lophn of its own workspace), --to harness copies the skill into the skill folder of every coding agent in a terminal that has the lophn hook installed (the copy follows the active release after the next sync). The person does this freely, an agent in the app's own workspace may deploy that app's skills anywhere, and the Home lophn may deploy any app anywhere. Any other agent asks the person first (an unattended run is refused; then call the app's command, which asks the person to allow it).",
  input: deployInput,
  positional: ["app", "skill"],
  effect: "write",
  routes: [skillsDeploy],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.read(skillsDeploy, {
      app: input.app,
      skill: input.skill,
      to: placeOf(input.to, ctx),
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!done.ok) return done;
    return ok({
      summary: done.value.deployed
        ? `deployed ${input.app}/${input.skill} to ${input.to}`
        : `${input.app}/${input.skill} was already deployed to ${input.to}`,
      content: done.value,
    });
  },
});

const undeploy = defineCommand({
  name: "skill.undeploy",
  summary:
    "Remove a deployed app skill from every agent, a workspace, an agent or the terminal coding agents",
  description:
    "Remove one deployed app skill from the place it was deployed to (the same --to as skill deploy). Who may do it without asking is the same as for deploy.",
  input: deployInput,
  positional: ["app", "skill"],
  effect: "write",
  routes: [skillsUndeploy],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.read(skillsUndeploy, {
      app: input.app,
      skill: input.skill,
      to: placeOf(input.to, ctx),
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!done.ok) return done;
    return ok({
      summary: done.value.removed
        ? `removed ${input.app}/${input.skill} from ${input.to}`
        : `${input.app}/${input.skill} was not deployed to ${input.to}`,
      content: done.value,
    });
  },
});

const deployments = defineCommand({
  name: "skill.deployments",
  summary: "List who receives which app skills",
  description:
    "List the deployed app skills: for each, the app, the skill and where it is deployed (global, harness, a workspace or an agent). `provided` is false when the app's active release no longer offers that skill as public (removed, made private, or the app is gone): receivers silently skip it, so undeploy it or deploy its replacement. With --app, only that app's skills: every place that holds one of them. An agent sees only the places that concern it (every agent, coding agents, its own workspace and the agents of its own workspace); the Home lophn and the person see all. An app's own agent that asks about its own app gets its rows plus the count of the other places (`others`), not their names. `unreadable` counts places that could not be read, so the list may be incomplete.",
  input: z.strictObject({
    app: z.string().min(1).optional().describe("App slug"),
  }),
  effect: "read",
  routes: [skillsDeployments],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(skillsDeployments, input);
    if (!read.ok) return read;
    const gone = read.value.deployments.filter((one) => !one.provided).length;
    return ok({
      summary: `${read.value.deployments.length} deployed skills${gone === 0 ? "" : `, ${gone} no longer provided by the app (provided: false; undeploy them or deploy the replacement)`}${read.value.others === 0 ? "" : `, ${read.value.others} more place${read.value.others === 1 ? "" : "s"} elsewhere receive it (names are not shown to an app's agent)`}${read.value.unreadable === 0 ? "" : `, could not read ${read.value.unreadable} place${read.value.unreadable === 1 ? "" : "s"}: this list may be incomplete`}`,
      content: read.value,
      arrayKeys: ["deployments"],
    });
  },
});

export const SKILL_COMMANDS = [list, check, deploy, undeploy, deployments];
