// `lophn update status|decide`: Home lophn이 앱 SDK·workflow flow_sdk·플랫폼 역량 메모 상태를 한 번에 읽고 결정·인계한다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  type UpdateDecisionInput,
  updateDecisionInputSchema,
  workspaceUpdateDecide,
  workspaceUpdateStatus,
} from "../../protocol/apps/updates.ts";
import { defineCommand } from "./types.ts";

const status = defineCommand({
  name: "update.status",
  summary:
    "Read app SDK, workflow flow_sdk, platform note, and follow-up status",
  description:
    "Read the unified workspace update status at Home: active apps and their SDK versions, flow.ts workflows and their flow_sdk versions, unreviewed platform capability notes, open follow-up items, and a summary of workspace assets.",
  input: z.strictObject({}),
  effect: "read",
  routes: [workspaceUpdateStatus],
  workspaces: ["home"],
  run: async (_input, ctx) => {
    const read = await ctx.core.read(workspaceUpdateStatus, {});
    if (!read.ok) return read;
    const { apps, workflows, platform, open_follow_ups } = read.value;
    const requiredApps = apps.filter((app) =>
      app.sdks.some((sdk) => sdk.level === "required"),
    ).length;
    const requiredWorkflows = workflows.filter(
      (wf) => wf.level === "required",
    ).length;
    return ok({
      summary: `${apps.length} apps (${requiredApps} required), ${workflows.length} workflows (${requiredWorkflows} required), ${platform.unreviewed.length} unreviewed platform notes, ${open_follow_ups.length} open follow-ups`,
      content: read.value,
      arrayKeys: ["apps", "workflows", "open_follow_ups"],
    });
  },
});

const decide = defineCommand({
  name: "update.decide",
  summary: "Record workspace update decisions and hand off follow-up work",
  description:
    "Record decisions for app SDK updates, workflow flow_sdk updates, and platform capability notes in one action, creating follow-up items and handing off work to the target workspaces. Pass --decisions-json '<json array>' or repeat --decisions '<json object>' (or pass via --input).",
  input: z.strictObject({
    decisions: z
      .array(updateDecisionInputSchema)
      .min(1)
      .max(50)
      .optional()
      .describe(
        "Decision objects (repeat --decisions '<json>' or provide via --input)",
      ),
    decisions_json: z
      .string()
      .min(1)
      .optional()
      .describe("JSON array of decision objects matching update.decide input"),
  }),
  effect: "write",
  routes: [workspaceUpdateDecide],
  workspaces: ["home"],
  run: async (input, ctx) => {
    if (input.decisions !== undefined && input.decisions_json !== undefined) {
      return err({
        code: "invalid_input",
        message: "pass either --decisions or --decisions-json, not both",
      });
    }
    let decisions: UpdateDecisionInput[];
    if (input.decisions !== undefined) {
      decisions = input.decisions;
    } else if (input.decisions_json !== undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse(input.decisions_json);
      } catch {
        return err({
          code: "invalid_input",
          message: "--decisions-json must be valid JSON",
        });
      }
      const parsed = workspaceUpdateDecide.input.safeParse({ decisions: raw });
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: `--decisions-json is invalid: ${parsed.error.issues[0]?.message ?? "expected array of decisions"}`,
        });
      }
      decisions = parsed.data.decisions;
    } else {
      return err({
        code: "invalid_input",
        message: "provide --decisions or --decisions-json",
      });
    }
    const done = await ctx.core.command(
      workspaceUpdateDecide,
      { decisions },
      { key: ctx.key },
    );
    if (!done.ok) return done;
    return ok({
      summary: `recorded ${decisions.length} update decision${decisions.length === 1 ? "" : "s"} (${done.value.follow_ups.length} follow-ups, ${done.value.handoff_sessions.length} handoff sessions)`,
      content: done.value,
      arrayKeys: ["follow_ups", "calls", "handoff_sessions"],
    });
  },
});

export const UPDATE_COMMANDS = [status, decide];
