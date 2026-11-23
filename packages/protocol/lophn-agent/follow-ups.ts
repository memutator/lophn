import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import {
  followUpIdSchema,
  followUpItemSchema,
  followUpStateSchema,
  followUpWorkspaceSchema,
  impactSummarySchema,
} from "../base/follow-ups.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";

export const followUpList = defineRead({
  resource: "follow-ups",
  method: "list",
  name: "follow_up.list",
  input: z.strictObject({
    workspace: z.union([z.literal("home"), followUpWorkspaceSchema]).optional(),
    state: followUpStateSchema.optional(),
  }),
  output: withReadCommon(z.object({ items: z.array(followUpItemSchema) })),
  reads: ["follow_ups"],
  actors: ["user", "agent", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 대상 그릇(home/project/app)의 agent(또는 사람)가 follow-up item 하나의 결과를 보고한다.
export const followUpReport = defineCommand({
  resource: "follow-ups",
  method: "report",
  name: "follow_up.report",
  changes: ["follow_ups"],
  input: z.strictObject({
    item: followUpIdSchema,
    state: z.enum(["done", "changed", "skipped"]),
    outcome: z.string().trim().min(1).max(500),
  }),
  output: z.object({ item: followUpItemSchema }),
  compare: z.strictObject({}),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "unavailable",
    "not_found",
    "conflict",
  ],
});

export const impactTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("app"), app: idSchema("app") }),
  z.strictObject({ kind: z.literal("agent"), agent: idSchema("agt") }),
  z.strictObject({
    kind: z.literal("artifact"),
    workspace: followUpWorkspaceSchema,
    name: z.string().min(1).max(63),
  }),
  z.strictObject({
    kind: z.literal("workflow"),
    project: idSchema("prj"),
    name: z.string().min(1).max(63),
  }),
]);
export type ImpactTarget = z.infer<typeof impactTargetSchema>;

// 지우거나 고치기 전 작업 공간 정본을 훑어 즉각 지워지는 것(immediate)과 lophn 인계 대상(declared/mentioned)을 돌려준다.
// P12 경계: 사람(UI)과 Home agent만 부른다.
export const impactRead = defineMemory({
  resource: "impact",
  method: "read",
  name: "impact.read",
  reads: ["apps", "agents", "jobs", "projects"],
  input: impactTargetSchema,
  output: z.object({
    target_label: z.string().min(1),
    immediate: z.array(z.string()),
    impact: impactSummarySchema,
  }),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "unavailable",
    "not_found",
  ],
});

export const FOLLOW_UP_ROUTES = [
  followUpList,
  followUpReport,
  impactRead,
] as const;
