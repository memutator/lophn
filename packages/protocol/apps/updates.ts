import { z } from "zod";
import {
  followUpIdSchema,
  followUpItemSchema,
  followUpWorkspaceSchema,
} from "../base/follow-ups.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory } from "../base/route.ts";
import {
  appSdkStatusSchema,
  sdkDecisionSchema,
  sdkLevelSchema,
} from "./sdk-status.ts";

const workflowNamePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const workflowSlugSchema = z.string().regex(workflowNamePattern).max(63);

export const workflowFlowSdkStatusSchema = z.object({
  project: idSchema("prj"),
  project_name: z.string().min(1),
  workflow: workflowSlugSchema,
  flow_sdk: z.string().min(1),
  current: z.string().min(1),
  supported_from: z.string().min(1).nullable(),
  level: sdkLevelSchema,
  note: z.string().min(1).nullable(),
  reviewed_through: z.string().nullable(),
  review_decision: sdkDecisionSchema.nullable(),
});
export type WorkflowFlowSdkStatus = z.infer<typeof workflowFlowSdkStatusSchema>;

export const PLATFORM_NOTE_AREAS = [
  "home",
  "project",
  "workflow",
  "agent",
  "app",
] as const;
export const platformNoteAreaSchema = z.enum(PLATFORM_NOTE_AREAS);

export const platformNoteSummarySchema = z.object({
  id: z.string().min(1),
  breaking: z.boolean(),
  areas: z.array(platformNoteAreaSchema),
  title: z.string().min(1),
  note_path: z.string().min(1),
});
export type PlatformNoteSummary = z.infer<typeof platformNoteSummarySchema>;

export const workspaceSummarySchema = z.object({
  active_apps: z.number().int().nonnegative(),
  active_projects: z.number().int().nonnegative(),
  workflows: z.number().int().nonnegative(),
  custom_agents: z.number().int().nonnegative(),
  harness_agents: z.number().int().nonnegative(),
  providers: z.number().int().nonnegative(),
  machines: z.number().int().nonnegative(),
});
export type WorkspaceUpdateSummary = z.infer<typeof workspaceSummarySchema>;

// Home lophn이 앱 SDK, workflow flow_sdk, 플랫폼 역량 메모, 열린 follow-up, 작업 공간 자산을 한 번에 읽는다.
export const workspaceUpdateStatus = defineMemory({
  resource: "updates",
  method: "status",
  name: "update.status",
  input: z.strictObject({}),
  output: z.object({
    apps: z.array(appSdkStatusSchema),
    workflows: z.array(workflowFlowSdkStatusSchema),
    platform: z.object({
      through: z.string().nullable(),
      latest: z.string().nullable(),
      unreviewed: z.array(platformNoteSummarySchema),
    }),
    open_follow_ups: z.array(followUpItemSchema),
    workspace_summary: workspaceSummarySchema,
  }),
  reads: ["apps", "projects", "agents", "follow_ups"],
  actors: ["user", "agent", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const updateDecideItemSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  proposal: z.string().trim().min(1).max(2000),
  source_ref: z.string().min(1).optional(),
});

export const updateDecisionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("app_sdk"),
    app: idSchema("app"),
    decision: sdkDecisionSchema,
    items: z.array(updateDecideItemSchema).max(20).optional(),
  }),
  z.strictObject({
    kind: z.literal("flow_sdk"),
    project: idSchema("prj"),
    workflow: workflowSlugSchema,
    decision: sdkDecisionSchema,
    items: z.array(updateDecideItemSchema).max(20).optional(),
  }),
  z.strictObject({
    kind: z.literal("platform"),
    through: z.string().min(1),
    handoffs: z
      .array(
        z.strictObject({
          workspace: followUpWorkspaceSchema.nullable(),
          items: z.array(updateDecideItemSchema).min(1).max(20),
        }),
      )
      .max(20)
      .optional(),
  }),
]);
export type UpdateDecisionInput = z.infer<typeof updateDecisionInputSchema>;

// Home lophn이 앱·workflow·플랫폼 검토 결정을 내리고 follow-up item 및 대상 그릇 handoff를 한 번에 처리한다.
export const workspaceUpdateDecide = defineCommand({
  resource: "updates",
  method: "decide",
  name: "update.decide",
  changes: ["apps", "follow_ups", "notices", "sessions"],
  input: z.strictObject({
    decisions: z.array(updateDecisionInputSchema).min(1).max(50),
  }),
  output: z.object({
    follow_ups: z.array(
      z.object({
        id: followUpIdSchema,
        workspace: followUpWorkspaceSchema.nullable(),
        title: z.string(),
      }),
    ),
    calls: z.array(idSchema("cal")),
    handoff_sessions: z.array(idSchema("ses")),
  }),
  compare: z.strictObject({}),
  actors: ["agent", "user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

const preparedHandoffSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("app_sdk"),
    app: idSchema("app"),
    decision: sdkDecisionSchema,
    through: z.record(z.string(), z.string()),
    items: z.array(
      updateDecideItemSchema.extend({
        id: followUpIdSchema,
      }),
    ),
    body: z
      .array(
        z.strictObject({ type: z.literal("text"), text: z.string().min(1) }),
      )
      .min(1)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("flow_sdk"),
    project: idSchema("prj"),
    workflow: workflowSlugSchema,
    decision: sdkDecisionSchema,
    through: z.string().min(1),
    items: z.array(
      updateDecideItemSchema.extend({
        id: followUpIdSchema,
      }),
    ),
    body: z
      .array(
        z.strictObject({ type: z.literal("text"), text: z.string().min(1) }),
      )
      .min(1)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("platform"),
    through: z.string().min(1),
    handoffs: z.array(
      z.strictObject({
        workspace: followUpWorkspaceSchema.nullable(),
        items: z.array(
          updateDecideItemSchema.extend({
            id: followUpIdSchema,
          }),
        ),
        body: z
          .array(
            z.strictObject({
              type: z.literal("text"),
              text: z.string().min(1),
            }),
          )
          .min(1),
      }),
    ),
  }),
]);

// core 안 machine만 쓴다. `update.decide` 메인 스레드 handler가 디스크와 상태를 읽어 본문을 채운 뒤 한 tx에 기록한다.
export const workspaceUpdateRecord = defineCommand({
  resource: "updates",
  method: "record",
  name: "update.record",
  changes: ["apps", "follow_ups", "notices", "sessions"],
  input: z.strictObject({
    session: idSchema("ses").nullable(),
    turn: idSchema("trn").nullable(),
    operations: z.array(preparedHandoffSchema).min(1).max(50),
  }),
  output: workspaceUpdateDecide.output,
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const UPDATE_ROUTES = [
  workspaceUpdateStatus,
  workspaceUpdateDecide,
  workspaceUpdateRecord,
] as const;
