import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import {
  type AgentAtWorkspace,
  agentIdSchema,
  type Workspace,
} from "./workspaces.ts";

// agent가 보내는 call을 어느 workspace 쌍과 agent 쌍으로 허용하는가. 사람이 보낸 call과 workflow step은 보지 않는다.
// 판정 순서: agent 쌍 규칙 → workspace 쌍 규칙 → 기본(허용). 같은 쌍이 여럿이면 먼저 적힌 것이 이긴다.
// 기본은 모두 허용이다. lophn의 위임(project → 앱의 lophn 등)을 program이 막지 않고, 사람이 workspace 쌍 거절로 크게 좁히고 agent 쌍으로 예외를 둔다.
export const CALL_POLICY_SETTING_KEY = "lophn-agent.call_policy";

export const callWorkspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type CallWorkspace = z.infer<typeof callWorkspaceSchema>;

export const callPolicySchema = z.strictObject({
  workspaces: z.array(
    z.strictObject({
      from: callWorkspaceSchema,
      to: callWorkspaceSchema,
      allow: z.boolean(),
    }),
  ),
  agents: z.array(
    z.strictObject({
      from: agentIdSchema,
      to: agentIdSchema,
      allow: z.boolean(),
    }),
  ),
});
export type CallPolicy = z.infer<typeof callPolicySchema>;

export const DEFAULT_CALL_POLICY: CallPolicy = { workspaces: [], agents: [] };

export function callWorkspaceOf(workspace: Workspace | null): CallWorkspace {
  return workspace === null ? { kind: "home" } : workspace;
}

function sameWorkspace(a: CallWorkspace, b: CallWorkspace): boolean {
  return (
    a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id)
  );
}

// 보내는 session(from)이 받는 agent와 workspace(to)로 call을 보내도 되는가.
export function mayCall(
  policy: CallPolicy,
  from: AgentAtWorkspace,
  to: AgentAtWorkspace,
): boolean {
  const byAgent = policy.agents.find(
    (rule) => rule.from === from.agent && rule.to === to.agent,
  );
  if (byAgent !== undefined) return byAgent.allow;
  const fromWorkspace = callWorkspaceOf(from.workspace);
  const toWorkspace = callWorkspaceOf(to.workspace);
  const byWorkspace = policy.workspaces.find(
    (rule) =>
      sameWorkspace(rule.from, fromWorkspace) &&
      sameWorkspace(rule.to, toWorkspace),
  );
  return byWorkspace?.allow ?? true;
}
