// `lophn follow-up list|report`: 작업 공간별 follow-up item(앱 SDK·flow_sdk·플랫폼 업데이트·삭제/계약 cascade)을 조회하고 처리 결과를 보고한다.
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type FollowUpWorkspace,
  followUpStateSchema,
  followUpWorkspaceSchema,
  idSchema,
} from "../../protocol/base/mod.ts";
import {
  followUpList,
  followUpReport,
} from "../../protocol/lophn-agent/follow-ups.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { countSummary, readBody } from "./app.ts";
import { defineCommand } from "./types.ts";

function parseWorkspaceFilter(raw: string): Result<"home" | FollowUpWorkspace> {
  const trimmed = raw.trim();
  if (trimmed === "home") return ok("home");
  if (idSchema("prj").safeParse(trimmed).success) {
    return ok({
      kind: "project",
      id: trimmed as FollowUpWorkspace["id"],
    } as FollowUpWorkspace);
  }
  if (idSchema("app").safeParse(trimmed).success) {
    return ok({
      kind: "app",
      id: trimmed as FollowUpWorkspace["id"],
    } as FollowUpWorkspace);
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = followUpWorkspaceSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) return ok(parsed.data);
    } catch {
      // fall through to invalid_input
    }
  }
  return err({
    code: "invalid_input",
    message:
      'invalid --workspace value: expected "home", a project ID (prj_...), or an app ID (app_...)',
  });
}

const list = defineCommand({
  name: "follow-up.list",
  summary: "List follow-up items for a workspace",
  description:
    'List follow-up items (origin: app_sdk, flow_sdk, platform_note, cascade). Home and the person can read all workspaces or filter with --workspace ("home", prj_..., or app_...); project and app agents read only their own workspace items. Filter by --state (open, done, changed, skipped).',
  input: z.strictObject({
    workspace: z
      .string()
      .min(1)
      .optional()
      .describe('Filter by workspace: "home", prj_..., or app_...'),
    state: followUpStateSchema
      .optional()
      .describe("Filter by state: open, done, changed, or skipped"),
  }),
  effect: "read",
  routes: [followUpList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    let workspace: "home" | FollowUpWorkspace | undefined;
    if (input.workspace !== undefined) {
      const parsed = parseWorkspaceFilter(input.workspace);
      if (!parsed.ok) return parsed;
      workspace = parsed.value;
    }
    const read = await ctx.core.read(followUpList, {
      ...(workspace === undefined ? {} : { workspace }),
      ...(input.state === undefined ? {} : { state: input.state }),
    });
    if (!read.ok) return read;
    const { body, more } = readBody(read.value);
    return ok({
      summary: countSummary("follow-up items", body.items.length, more),
      content: body,
      arrayKeys: ["items"],
    });
  },
});

const report = defineCommand({
  name: "follow-up.report",
  summary: "Report the outcome of a follow-up item",
  description:
    "Report what became of a follow-up item handed over to this workspace: done, changed (adapted after talking with the person), or skipped, with a one-line --outcome summary.",
  input: followUpReport.input,
  positional: ["item"],
  effect: "write",
  routes: [followUpReport],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(followUpReport, input, {
      key: ctx.key,
    });
    if (!done.ok) return done;
    return ok({
      summary: `follow-up ${done.value.item.id} is ${done.value.item.state}`,
      content: done.value,
    });
  },
});

export const FOLLOW_UP_COMMANDS = [list, report];
