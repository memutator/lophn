import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { agentIdSchema } from "../lophn-agent/workspaces.ts";

// 할당. agent가 부를 수 있는 앱과 그 앱에서 뺀 tool이다. 저장은 agent 정의 파일의 `apps`(앱 slug)와
// `permissions.deny`(`lophn(<앱 slug> <command 낱말>)`)이고, 이 route는 그것을 앱 id와 command 이름으로 풀어 읽고 쓴다.
// 줄은 앱뿐이다. MCP server는 설정한 층(전역, project, agent 정의)이 곧 할당이고 끄기는 `mcp_off`라 줄이 없다.
// 할당한 tool의 바깥 효과는 묻지 않는다. 사람이 묻기로 정하면 줄에 `no_ask_tools: ToolKey[]`를 더하고
// `judge`의 바깥 효과 줄을 켠다.
// 다른 기계의 앱이면 `machine`(그 기계의 id)과 `name`(그 기계 앱의 표시 이름: 이 기계에는 그 앱의 slug가 없고, 꺼진 기계의 앱도 이름으로 보이게 한다)이 붙는다.
// `name`은 `machine`이 있을 때만 있고 그때는 있어야 한다. 앱 id는 기계 사이에 같아 같은 줄인지는 `(machine, app)`으로 본다.
// 줄의 종류가 다시 생기면 그때 `kind`를 더한다.
export const assignmentEntrySchema = z
  .strictObject({
    app: idSchema("app"),
    machine: idSchema("mch").optional(),
    name: z.string().min(1).max(64).optional(),
    removed_tools: z.array(toolKeySchema),
  })
  .refine(
    (entry) => (entry.machine === undefined) === (entry.name === undefined),
    {
      message: "a remote app has a machine and a name, a local app has neither",
    },
  );
export type AssignmentEntry = z.infer<typeof assignmentEntrySchema>;

const entriesSchema = z
  .array(assignmentEntrySchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => `${entry.machine ?? ""}/${entry.app}`))
        .size === entries.length &&
      entries.every(
        (entry) =>
          new Set(entry.removed_tools).size === entry.removed_tools.length,
      ),
    { message: "duplicate assignment target" },
  );

// 비교 값. 할당이 없는 agent는 0이고, 있으면 할당 내용에서 정한 정수다(내용이 바뀌면 값도 바뀐다).
export const assignmentRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// ---------- 전역 agent 할당 ----------

// agent는 id 하나다. 줄은 앱과 그 앱에서 뺀 tool이다.
export const assignmentSchema = z.strictObject({
  agent: agentIdSchema,
  entries: entriesSchema,
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentGet = defineRead({
  resource: "agent_assignments",
  method: "get",
  name: "GetAgentAssignment",
  input: z.strictObject({ agent: agentIdSchema }),
  output: withReadCommon(
    z.object({
      assignment: assignmentSchema,
      revision: assignmentRevisionSchema,
    }),
  ),
  reads: [{ name: "agents", id: (input) => input.agent }],
  actors: ["user", "machine"],
  errors: [...readErrors],
});

export const assignmentSet = defineCommand({
  resource: "agent_assignments",
  method: "set",
  name: "SetAgentAssignment",
  changes: [{ name: "agents", id: (input) => input.agent }],
  input: z.strictObject({ agent: agentIdSchema, entries: entriesSchema }),
  compare: z.strictObject({ revision: assignmentRevisionSchema }),
  output: z.object({
    assignment: assignmentSchema,
    revision: assignmentRevisionSchema,
  }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

export const ASSIGNMENT_ROUTES = [assignmentGet, assignmentSet] as const;
