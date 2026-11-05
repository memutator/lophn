import { z } from "zod";
import { defineMemory, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { readCursorSchema, seqSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  sessionChoiceSchema,
  stepNameSchema,
  stepNextSchema,
  workflowKeySchema,
  workflowNameSchema,
  workflowStateSchema,
  workflowTextSchema,
} from "./values.ts";
import {
  handResultSchema,
  reportLineSchema,
  workflowEditInputSchema,
  workflowEntrySchema,
  workflowInstanceSchema,
  workflowInstanceSummarySchema,
  workflowLineSchema,
} from "./instances.ts";

const instanceRef = { instance: idSchema("wfi") };

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const workflowList = defineMemory({
  resource: "workflows",
  method: "list",
  name: "ListWorkflows",
  // prj id 또는 project 이름. agent가 project workspace에 있으면 생략한다.
  input: z.strictObject({ project: z.string().min(1).optional() }),
  output: z.object({ workflows: z.array(workflowEntrySchema) }),
  actors: ["user", "agent"],
  errors: [...readErrors],
});

// key나 project가 안 풀리면 not_found, 시작할 수 없는 workflow는 conflict, 없는 step은 not_found다.
// 시작 입력에는 8 KiB 한도를 두지 않는다.
export const workflowStart = defineMemory({
  resource: "workflows",
  method: "start",
  name: "StartWorkflow",
  input: z.strictObject({
    workflow: workflowKeySchema,
    text: z.string().min(1),
    step: stepNameSchema.optional(),
  }),
  // flow는 넘기지 않아 handed가 null이다.
  output: z.object({
    instance: workflowInstanceSchema,
    handed: handResultSchema.nullable(),
  }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

// errors가 비면 통과다.
export const workflowCheck = defineMemory({
  resource: "workflows",
  method: "check",
  name: "CheckWorkflow",
  input: z.strictObject({ workflow: workflowKeySchema }),
  output: z.object({ errors: z.array(z.string()) }),
  actors: ["agent"],
  errors: [...readErrors],
});

// handed는 넘기지 않았을 때 null이다. line은 report 줄의 seq다(뒤따르는 handed·ended 줄이 아니다).
export const workflowReport = defineMemory({
  resource: "workflows",
  method: "report",
  name: "ReportWorkflow",
  input: z.strictObject({
    ...instanceRef,
    step: stepNameSchema,
    text: workflowTextSchema,
    next: stepNextSchema.optional(),
    session: sessionChoiceSchema.optional(),
  }),
  output: z.object({
    line: seqSchema,
    handed: handResultSchema.nullable(),
  }),
  actors: ["user", "agent"],
  errors: [...readErrors, "conflict"],
});

// stopped인 instance는 conflict. 이름이 겹치는 add는 conflict, 없는 name의 update·remove는 not_found다.
export const workflowEdit = defineMemory({
  resource: "workflows",
  method: "edit",
  name: "EditWorkflow",
  input: workflowEditInputSchema,
  output: z.object({
    line: seqSchema,
    handed: handResultSchema.nullable(),
  }),
  actors: ["user", "agent"],
  errors: [...readErrors, "conflict"],
});

export const workflowStop = defineMemory({
  resource: "workflows",
  method: "stop",
  name: "StopWorkflow",
  input: z.strictObject(instanceRef),
  output: z.object({ instance: workflowInstanceSchema }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

// machine도 받는다. core 안 service(wf-service)가 상태를 읽어 plan을 만든다.
// last_reports는 step마다 가장 큰 seq의 report 줄이고, lines는 seq 오름차순 200개씩이다.
export const workflowInstanceRead = defineRead({
  resource: "workflow_instances",
  method: "read",
  name: "ReadWorkflowInstance",
  input: z.strictObject({
    ...instanceRef,
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(
    z.object({
      instance: workflowInstanceSchema,
      last_reports: z.record(stepNameSchema, reportLineSchema),
      lines: z.array(workflowLineSchema),
    }),
  ),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

// 새것이 앞이고 50개씩이다.
export const workflowInstanceList = defineRead({
  resource: "workflow_instances",
  method: "list",
  name: "ListWorkflowInstances",
  input: z.strictObject({
    project: idSchema("prj"),
    workflow: workflowNameSchema.optional(),
    state: workflowStateSchema.optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(
    z.object({
      instances: z.array(workflowInstanceSummarySchema),
    }),
  ),
  actors: ["user", "agent"],
  errors: [...readErrors],
});

export const WORKFLOW_ROUTES = [
  workflowList,
  workflowStart,
  workflowCheck,
  workflowReport,
  workflowEdit,
  workflowStop,
  workflowInstanceRead,
  workflowInstanceList,
] as const;
