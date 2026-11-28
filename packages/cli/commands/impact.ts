// `lophn impact read`: 앱·agent·artifact·workflow 삭제·변경 전 정적 참조 영향(declared/mentioned)을 읽는다(P12: 사람과 Home만).
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  type ImpactTarget,
  impactRead,
  impactTargetSchema,
} from "../../protocol/lophn-agent/follow-ups.ts";
import { defineCommand } from "./types.ts";

function buildTarget(input: {
  kind: "app" | "agent" | "artifact" | "workflow";
  target?: string;
  app?: string;
  agent?: string;
  project?: string;
  name?: string;
}): Result<ImpactTarget> {
  let candidate: unknown;
  switch (input.kind) {
    case "app":
      candidate = { kind: "app", app: input.app ?? input.target };
      break;
    case "agent":
      candidate = { kind: "agent", agent: input.agent ?? input.target };
      break;
    case "workflow":
      candidate = {
        kind: "workflow",
        project: input.project,
        name: input.name ?? input.target,
      };
      break;
    case "artifact": {
      if (input.project !== undefined && input.app !== undefined) {
        return err({
          code: "invalid_input",
          message:
            "for artifact impact, pass either --project or --app, not both",
        });
      }
      const workspace =
        input.project !== undefined
          ? { kind: "project", id: input.project }
          : input.app !== undefined
            ? { kind: "app", id: input.app }
            : undefined;
      candidate = {
        kind: "artifact",
        workspace,
        name: input.name ?? input.target,
      };
      break;
    }
  }
  const parsed = impactTargetSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err({
      code: "invalid_input",
      message: `invalid impact target: ${issue ? `${issue.path.join(".") || "input"} ${issue.message}` : "check target flags"}`,
    });
  }
  return ok(parsed.data);
}

const read = defineCommand({
  name: "impact.read",
  summary:
    "Read static references and immediate deletions before deleting a target",
  description:
    "Inspect what will be deleted immediately and which active apps, jobs, workflows, and skills reference a target (declared vs mentioned), including every place that receives an app's skills (`skill_deployment`: every agent, the coding agents in terminals, workspaces, agents). Available at Home and for the person (P12). Examples: `lophn impact read app app_...`, `lophn impact read agent agt_...`, `lophn impact read workflow <name> --project prj_...`, `lophn impact read artifact <name> --project prj_...` (or `--app app_...`).",
  input: z.strictObject({
    kind: z.enum(["app", "agent", "artifact", "workflow"]),
    target: z
      .string()
      .min(1)
      .optional()
      .describe("Target ID (app_..., agt_...) or name (workflow/artifact)"),
    app: idSchema("app")
      .optional()
      .describe("App ID (for kind=app or app artifact)"),
    agent: idSchema("agt").optional().describe("Agent ID (for kind=agent)"),
    project: idSchema("prj")
      .optional()
      .describe("Project ID (for kind=workflow or project artifact)"),
    name: z
      .string()
      .min(1)
      .max(63)
      .optional()
      .describe("Artifact or workflow name"),
  }),
  positional: ["kind", "target"],
  effect: "read",
  routes: [impactRead],
  workspaces: ["home"],
  run: async (input, ctx) => {
    const target = buildTarget(input);
    if (!target.ok) return target;
    const done = await ctx.core.read(impactRead, target.value);
    if (!done.ok) return done;
    const { target_label, impact } = done.value;
    return ok({
      summary: `${target_label}: ${impact.declared.length} declared, ${impact.mentioned.length} mentioned`,
      content: done.value,
      arrayKeys: ["immediate"],
    });
  },
});

export const IMPACT_COMMANDS = [read];
