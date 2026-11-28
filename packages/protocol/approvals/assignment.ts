import { z } from "zod";
import { toolKeySchema } from "../apps/channel-values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { agentIdSchema } from "../lophn-agent/workspaces.ts";

// 다른 컴퓨터 앱 할당. agent가 부를 수 있는 다른 컴퓨터의 앱과 그 앱에서 뺀 tool(`removed_tools`), 부를 때마다 물을 tool(`ask_tools`)이다.
// 저장은 agent 정의 파일의 `remote_apps`이고, 이 route는 그것을 읽고 쓴다. 이 컴퓨터의 앱은 할당이 아니라 skill 배포가 닿게 한다.
// `machine`은 그 기계의 id이고 `name`은 그 기계 앱의 표시 이름이다(이 기계에는 그 앱의 slug가 없고, 꺼진 기계의 앱도 이름으로 보이게 한다).
// 앱 id는 기계 사이에 같아 같은 줄인지는 `(machine, app)`으로 본다.
export const assignmentEntrySchema = z.strictObject({
  app: idSchema("app"),
  machine: idSchema("mch"),
  name: z.string().min(1).max(64),
  removed_tools: z.array(toolKeySchema),
  ask_tools: z.array(toolKeySchema).optional(),
});
export type AssignmentEntry = z.infer<typeof assignmentEntrySchema>;

const entriesSchema = z
  .array(assignmentEntrySchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => `${entry.machine}/${entry.app}`)).size ===
        entries.length &&
      entries.every((entry) => {
        const askTools = entry.ask_tools ?? [];
        return (
          new Set(entry.removed_tools).size === entry.removed_tools.length &&
          new Set(askTools).size === askTools.length
        );
      }),
    { message: "duplicate assignment target" },
  )
  .refine(
    (entries) =>
      entries.every((entry) => {
        const askTools = entry.ask_tools ?? [];
        if (askTools.length === 0 || entry.removed_tools.length === 0) {
          return true;
        }
        const removed = new Set(entry.removed_tools);
        return askTools.every((tool) => !removed.has(tool));
      }),
    { message: "removed_tools and ask_tools must not overlap" },
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

// agent는 id 하나다. 줄은 다른 컴퓨터의 앱과 그 앱에서 뺀 tool이다.
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
