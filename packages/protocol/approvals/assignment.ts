import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { agentRefSchema } from "../lophn-agent/places.ts";

// 할당. agent가 부를 수 있는 앱과 그 앱에서 뺀 tool이다.
// 줄은 앱뿐이다. MCP server는 설정한 층(전역, project, Operator 정의)이 곧 할당이고 끄기는 `mcp_off`라 줄이 없다.
// 할당한 tool의 바깥 효과는 묻지 않는다. 사람이 묻기로 정하면 줄에 `no_ask_tools: ToolKey[]`를 더하고
// `judge`의 바깥 효과 줄을 켠다.
// 같은 줄인지는 `app`으로 본다. 줄의 종류가 다시 생기면 그때 `kind`를 더한다.
export const assignmentEntrySchema = z.strictObject({
  app: idSchema("app"),
  removed_tools: z.array(toolKeySchema),
});
export type AssignmentEntry = z.infer<typeof assignmentEntrySchema>;

const entriesSchema = z.array(assignmentEntrySchema).refine(
  (entries) =>
    new Set(entries.map((entry) => entry.app)).size === entries.length &&
    entries.every((entry) =>
      new Set(entry.removed_tools).size === entry.removed_tools.length
    ),
  { message: "duplicate assignment target" },
);

// key는 agent다. 고정 role agent는 role과 place가 곧 정체성이다.
// revision은 할당 값이 아니라 저장 판이라 여기 넣지 않는다(judge가 받는 값에 섞지 않는다).
export const agentAssignmentSchema = z.strictObject({
  agent: agentRefSchema,
  entries: entriesSchema,
});
export type AgentAssignment = z.infer<typeof agentAssignmentSchema>;

// 줄이 없는 agent는 0이고, 쓸 때마다 1 오른다.
export const assignmentRevisionSchema = z.number().int().min(0).max(
  Number.MAX_SAFE_INTEGER,
);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// agent 자격은 읽지도 쓰지도 못한다.
export const agentAssignmentGet = defineRead({
  resource: "agent_assignments",
  method: "get",
  name: "GetAgentAssignment",
  input: z.strictObject({ agent: agentRefSchema }),
  output: withReadCommon(z.object({
    assignment: agentAssignmentSchema,
    revision: assignmentRevisionSchema,
  })),
  actors: ["user", "machine"],
  errors: [...readErrors],
});

// entries를 통째로 바꾼다. compare의 revision이 지금 값과 다르면 conflict이고 아무것도 쓰지 않는다
// (두 창에서 같은 할당을 고칠 때 앞 저장을 덮지 않는다).
export const agentAssignmentSet = defineCommand({
  resource: "agent_assignments",
  method: "set",
  name: "SetAgentAssignment",
  input: z.strictObject({ agent: agentRefSchema, entries: entriesSchema }),
  compare: z.strictObject({ revision: assignmentRevisionSchema }),
  output: z.object({
    assignment: agentAssignmentSchema,
    revision: assignmentRevisionSchema,
  }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

export const AGENT_ASSIGNMENT_ROUTES = [
  agentAssignmentGet,
  agentAssignmentSet,
] as const;
