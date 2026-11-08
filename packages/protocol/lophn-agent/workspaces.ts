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

// workspace마다 lophn이 하나 있고 id는 workspace에서 정해진다: Home `lophn_home`, project `lophn_prj_…`, 앱 `lophn_app_…`.
// 정의 file 이름(`<data>/agents/<id>.md`)과 secret 이름의 id 자리에 `.` 없이 그대로 쓰인다.
export const LOPHN_HOME_ID = "lophn_home";
const lophnWorkspaceIdSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("lophn_") &&
      (idSchema("prj").safeParse(value.slice(6)).success ||
        idSchema("app").safeParse(value.slice(6)).success),
  );
export const agentIdSchema = z.union([
  z.literal(LOPHN_HOME_ID),
  lophnWorkspaceIdSchema,
  idSchema("agt"),
]);
export type AgentId = z.infer<typeof agentIdSchema>;

export function lophnIdOf(workspace: Workspace | null): AgentId {
  return workspace === null ? LOPHN_HOME_ID : `lophn_${workspace.id}`;
}

export function isLophn(id: string): boolean {
  return id === LOPHN_HOME_ID || lophnWorkspaceIdSchema.safeParse(id).success;
}

// lophn id가 가리키는 workspace다. Home이면 null이다.
export function workspaceOfLophn(id: string): Workspace | null {
  if (id === LOPHN_HOME_ID) return null;
  const rest = id.slice("lophn_".length);
  return rest.startsWith("app_")
    ? { kind: "app", id: rest }
    : { kind: "project", id: rest };
}

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
