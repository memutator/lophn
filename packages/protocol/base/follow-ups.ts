import { z } from "zod";
import { idSchema } from "./ids.ts";
import { atSchema } from "./values.ts";

// home·project·app 어디서나 쓰는 공통 follow-up·impact 값 schema.
// route 정의 없이 값 schema만 두므로 어느 최상위 protocol이든 순환 없이 가져다 쓴다.

export const followUpIdSchema = idSchema("fup");

export const followUpWorkspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type FollowUpWorkspace = z.infer<typeof followUpWorkspaceSchema>;

export const FOLLOW_UP_ORIGINS = [
  "app_sdk",
  "flow_sdk",
  "platform_note",
  "cascade",
] as const;
export const followUpOriginSchema = z.enum(FOLLOW_UP_ORIGINS);
export type FollowUpOrigin = z.infer<typeof followUpOriginSchema>;

export const FOLLOW_UP_STATES = ["open", "done", "changed", "skipped"] as const;
export const followUpStateSchema = z.enum(FOLLOW_UP_STATES);
export type FollowUpState = z.infer<typeof followUpStateSchema>;

export const followUpItemSchema = z.object({
  id: followUpIdSchema,
  // null이면 Home이다.
  workspace: followUpWorkspaceSchema.nullable(),
  origin: followUpOriginSchema,
  source_ref: z.string().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  state: followUpStateSchema,
  created_at: atSchema,
  updated_at: atSchema,
  outcome: z.string().nullable(),
});
export type FollowUpItem = z.infer<typeof followUpItemSchema>;

export const cleanUpModeSchema = z.enum(["none", "now", "later"]);
export type CleanUpMode = z.infer<typeof cleanUpModeSchema>;

export const DECLARED_REF_KINDS = [
  "app_connection",
  "app_subscription",
  "job_action",
  "job_trigger",
  "workflow_participant",
  "workflow_creator",
  "workflow_input",
  "skill_deployment",
] as const;
export const declaredRefSchema = z.object({
  kind: z.enum(DECLARED_REF_KINDS),
  workspace: followUpWorkspaceSchema.nullable(),
  workspace_name: z.string().min(1),
  label: z.string().min(1),
  detail: z.string(),
});
export type DeclaredRef = z.infer<typeof declaredRefSchema>;

export const MENTIONED_REF_KINDS = ["flow_literal", "skill_mention"] as const;
export const mentionedRefSchema = z.object({
  kind: z.enum(MENTIONED_REF_KINDS),
  workspace: followUpWorkspaceSchema.nullable(),
  workspace_name: z.string().min(1),
  file: z.string().min(1),
  excerpt: z.string(),
});
export type MentionedRef = z.infer<typeof mentionedRefSchema>;

export const impactSummarySchema = z.object({
  declared: z.array(declaredRefSchema),
  mentioned: z.array(mentionedRefSchema),
});
export type ImpactSummary = z.infer<typeof impactSummarySchema>;

export const erasedJobSpecSchema = z.object({
  id: idSchema("job"),
  title: z.string(),
  summary: z.string(),
});
export type ErasedJobSpec = z.infer<typeof erasedJobSpecSchema>;
