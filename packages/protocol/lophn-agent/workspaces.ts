import { z } from "zod";
import { idSchema } from "../base/ids.ts";

export const workspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export const workspaceOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type Workspace = z.infer<typeof workspaceSchema>;

// ---------- agent id와 workspace 종류 ----------

// lophn은 고정 id의 내장 정의다. id는 정의 file 이름(`<data>/agents/lophn.md`)과 같다.
export const LOPHN_AGENT_ID = "lophn";
export const agentIdSchema = z.union([
  z.literal(LOPHN_AGENT_ID),
  idSchema("agt"),
]);
export type AgentId = z.infer<typeof agentIdSchema>;

// session이 있는 자리의 종류다. workspace가 없으면 home이다.
export const WORKSPACE_KINDS = ["home", "project", "app"] as const;
export const workspaceKindSchema = z.enum(WORKSPACE_KINDS);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export function workspaceKindOf(workspace: Workspace | null): WorkspaceKind {
  return workspace === null ? "home" : workspace.kind;
}

// session의 정체, job을 만든 쪽, run의 agent 대상, call의 새 session 대상이다.
export const agentAtWorkspaceSchema = z.strictObject({
  agent: agentIdSchema,
  workspace: workspaceSchema.nullable(),
});
export const agentAtWorkspaceOutputSchema = z.object({
  agent: agentIdSchema,
  workspace: workspaceOutputSchema.nullable(),
});
export type AgentAtWorkspace = z.infer<typeof agentAtWorkspaceSchema>;

// 이름으로 가리키는 받는 쪽이다. workspace가 없으면 home이다(workflow 참가자만 instance의 project다).
export const workspaceNameSchema = z.union([
  z.strictObject({ project: z.string().min(1) }),
  z.strictObject({ app: z.string().min(1) }),
]);
export const agentAddressSchema = z.strictObject({
  agent: z.string().min(1),
  workspace: workspaceNameSchema.optional(),
});
export type AgentAddress = z.infer<typeof agentAddressSchema>;
