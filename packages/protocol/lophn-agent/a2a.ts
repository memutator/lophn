import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { machineIdSchema } from "../machine/mod.ts";
import { agentCardSchema } from "./agent-definitions.ts";
import { remoteWorkspaceSchema, SENDABLE_SESSION_STATES } from "./calls.ts";
import { workspaceNameSchema } from "./workspaces.ts";

// agent가 다른 컴퓨터에서 부를 수 있는 것(열린 session, agent 명함)을 읽는 길이다. 보내는 컴퓨터의 core가 agent 대신 받는 컴퓨터의
// `a2a/*`를 기기 자격으로 부른다. 받는 컴퓨터는 이 기계에서 private인 workspace의 것을 내주지 않는다. 누구를 부를지는 지침이 정한다.

// 기계를 건너는 workspace의 표시다. project는 기계 사이의 정체(`pri_`)와 이름이고, identity가 null인 project는 다른 컴퓨터에서
// 부를 수 없다. 앱은 앱 id와 slug다.
export const remoteWorkspaceOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home") }),
  z.object({
    kind: z.literal("project"),
    identity: idSchema("pri").nullable(),
    name: z.string(),
  }),
  z.object({ kind: z.literal("app"), app: idSchema("app"), name: z.string() }),
]);
export type RemoteWorkspaceOutput = z.infer<typeof remoteWorkspaceOutputSchema>;

export const remoteSessionSchema = z.object({
  session: idSchema("ses"),
  handle: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  workspace: remoteWorkspaceOutputSchema,
  state: z.enum(SENDABLE_SESSION_STATES),
  last_active_at: z.string().nullable(),
});
export type RemoteSession = z.infer<typeof remoteSessionSchema>;

// 받는 쪽(다른 컴퓨터의 core만 부른다). 둘 다 not_found를 내지 않는다: 보내는 쪽은 not_found를 "이 route를 모르는 옛 판"으로 읽는다.
export const a2aSessions = defineMemory({
  resource: "a2a",
  method: "sessions",
  name: "a2a.sessions",
  input: z.strictObject({}),
  output: z.object({ sessions: z.array(remoteSessionSchema) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

// 없는 workspace와 private workspace는 똑같이 `{found: false, cards: []}`다(있는지를 알리지 않는다).
export const a2aAgents = defineMemory({
  resource: "a2a",
  method: "agents",
  name: "a2a.agents",
  input: z.strictObject({ workspace: remoteWorkspaceSchema }),
  output: z.object({ found: z.boolean(), cards: z.array(agentCardSchema) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

const machineOutput = z.object({ machine: machineIdSchema, name: z.string() });

// 보내는 쪽(agent session). `machine`은 명단의 다른 컴퓨터(이름, `mch_`, `dev_`)다.
export const machinesSessions = defineMemory({
  resource: "machines",
  method: "sessions",
  name: "machines.sessions",
  input: z.strictObject({ machine: z.string().min(1) }),
  output: z.object({
    machine: machineOutput,
    sessions: z.array(remoteSessionSchema),
  }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// workspace가 없으면 부른 session의 workspace다.
export const machinesAgents = defineMemory({
  resource: "machines",
  method: "agents",
  name: "machines.agents",
  input: z.strictObject({
    machine: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
  }),
  output: z.object({
    machine: machineOutput,
    workspace: remoteWorkspaceSchema,
    found: z.boolean(),
    cards: z.array(agentCardSchema),
  }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const A2A_LIST_ROUTES = [
  a2aSessions,
  a2aAgents,
  machinesSessions,
  machinesAgents,
] as const;
