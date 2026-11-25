import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { cleanUpModeSchema, followUpItemSchema } from "../base/follow-ups.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import { readCursorSchema, seqSchema } from "../base/values.ts";
import { workflowInputValuesSchema } from "./inputs.ts";
import {
  handResultSchema,
  listWorkflowsResponseSchema,
  remoteStepSchema,
  reportLineSchema,
  workflowCheckpointSchema,
  workflowChildSummarySchema,
  workflowEditInputSchema,
  workflowInstanceSchema,
  workflowInstanceSummarySchema,
  workflowLineSchema,
  workflowSessionNodeSchema,
} from "./instances.ts";
import {
  derivedStatusSchema,
  sessionChoiceSchema,
  sessionOpenModeSchema,
  stepNameSchema,
  stepNextSchema,
  workflowDataSchema,
  workflowKeySchema,
  workflowNameSchema,
  workflowRefsSchema,
  workflowStateSchema,
  workflowTextSchema,
  workflowTitleSchema,
} from "./values.ts";

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
  output: listWorkflowsResponseSchema,
  actors: ["user", "agent"],
  errors: [...readErrors],
});

// key나 project가 안 풀리면 not_found, 시작할 수 없는 workflow는 conflict, 없는 step은 not_found다.
// 시작 입력에는 8 KiB 한도를 두지 않는다.
export const workflowStart = defineMemory({
  resource: "workflows",
  method: "start",
  name: "StartWorkflow",
  changes: [],
  input: z.strictObject({
    workflow: workflowKeySchema,
    title: workflowTitleSchema.optional(),
    text: z.string().min(1),
    step: stepNameSchema.optional(),
    inputs: workflowInputValuesSchema.optional(),
    open: sessionOpenModeSchema.optional(),
    step_open: z.record(stepNameSchema, sessionOpenModeSchema).optional(),
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

// handed는 넘기지 않았을 때 null이다. line은 report 줄의 seq다(뒤따르는 handed·ended 줄이 아니다). 다른 컴퓨터에서 받은 step의
// report는 그 컴퓨터로 가는 mail이 되어 이 컴퓨터에 줄이 없다(line null).
export const workflowReport = defineMemory({
  resource: "workflows",
  method: "report",
  name: "ReportWorkflow",
  changes: [],
  input: z.strictObject({
    ...instanceRef,
    step: stepNameSchema,
    text: workflowTextSchema,
    next: stepNextSchema.optional(),
    session: sessionChoiceSchema.optional(),
    // 산출물 경로(명시한 것만 모은다)와 선택적 구조화 값.
    refs: workflowRefsSchema.optional(),
    data: workflowDataSchema.optional(),
  }),
  output: z.object({
    line: seqSchema.nullable(),
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
  changes: [],
  input: workflowEditInputSchema,
  output: z.object({
    line: seqSchema,
    handed: handResultSchema.nullable(),
  }),
  actors: ["user", "agent"],
  errors: [...readErrors, "conflict"],
});

// running이면서 계산 상태가 blocked인 step에만 된다(아니면 conflict). 기록된 같은 session에 이어서 하라는 입력을 넣는다.
// session이 열리기 전(not_handed)이면 넘기기를 다시 한다. step을 빼면 current step이다. line은 retried 줄의 seq다.
export const workflowRetry = defineMemory({
  resource: "workflows",
  method: "retry",
  name: "RetryWorkflowStep",
  changes: [],
  input: z.strictObject({ ...instanceRef, step: stepNameSchema.optional() }),
  output: z.object({ instance: workflowInstanceSchema, line: seqSchema }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

// flow process가 멈춘(blocked) running flow instance의 process를 다시 띄워 replay로 이어간다.
// 기본은 시작 시점 code snapshot을 쓰고, use_latest_code: true면 최신 flow code로 snapshot을 갱신한 뒤 이어간다.
export const workflowResume = defineMemory({
  resource: "workflows",
  method: "resume",
  name: "ResumeWorkflow",
  changes: [],
  input: z.strictObject({
    ...instanceRef,
    use_latest_code: z.boolean().optional(),
  }),
  output: z.object({ instance: workflowInstanceSchema }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

export const workflowStop = defineMemory({
  resource: "workflows",
  method: "stop",
  name: "StopWorkflow",
  changes: [],
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
      // 다른 컴퓨터로 넘긴 step call마다 지금 상태(handed 줄의 remote.call로 잇는다).
      remote_steps: z.array(remoteStepSchema),
      // 2a: 읽을 때 계산한 상태, 이 instance의 workflow_origin을 가진 session tree, report가 명시한 산출물 경로.
      derived_status: derivedStatusSchema.optional(),
      sessions: z.array(workflowSessionNodeSchema).optional(),
      refs: workflowRefsSchema.optional(),
      // Phase 4: durable checkpoint 목록과 자식 sub-workflow 요약.
      checkpoints: z.array(workflowCheckpointSchema).optional(),
      children: z.array(workflowChildSummarySchema).optional(),
    }),
  ),
  reads: [{ name: "workflow_instances", id: (input) => input.instance }],
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
  reads: ["workflow_instances"],
  actors: ["user", "agent"],
  errors: [...readErrors],
});

// idle-exit가 보는 일이다. project를 가리지 않고 running인 instance가 있으면 true다.
export const workflowInstanceActivity = defineRead({
  resource: "workflow_instances",
  method: "activity",
  name: "WorkflowInstanceActivity",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ busy: z.boolean() })),
  actors: ["machine"],
  errors: [...readErrors],
});

export const workflowRename = defineMemory({
  resource: "workflows",
  method: "rename",
  name: "RenameWorkflow",
  changes: ["projects", "jobs", "workflow_instances"],
  input: z.strictObject({
    project: idSchema("prj").optional(),
    from: workflowNameSchema,
    to: workflowNameSchema,
  }),
  output: z.object({
    project: idSchema("prj"),
    from: workflowNameSchema,
    to: workflowNameSchema,
    updated_jobs: z.number().int().nonnegative(),
  }),
  actors: ["user", "agent"],
  errors: [...readErrors, "conflict"],
});

export const workflowDelete = defineMemory({
  resource: "workflows",
  method: "delete",
  name: "DeleteWorkflow",
  changes: ["projects", "jobs", "workflow_instances", "follow_ups", "sessions"],
  input: z.strictObject({
    project: idSchema("prj").optional(),
    name: workflowNameSchema,
    clean_up: cleanUpModeSchema.optional(),
  }),
  output: z.object({
    project: idSchema("prj"),
    name: workflowNameSchema,
    erased_jobs: z.number().int().nonnegative(),
    follow_ups: z.array(followUpItemSchema),
    handoff_session: idSchema("ses").nullable(),
  }),
  actors: ["user", "agent"],
  errors: [...readErrors, "conflict"],
});

export const WORKFLOW_EXPORT_MAX_FILES = 200;
export const WORKFLOW_EXPORT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export const workflowExportFileSchema = z.strictObject({
  path: z.string().min(1).max(512),
  content_base64: z.string(),
});

export type WorkflowExportFile = z.infer<typeof workflowExportFileSchema>;

export const workflowExport = defineMemory({
  resource: "workflows",
  method: "export",
  name: "ExportWorkflow",
  input: z.strictObject({
    project: idSchema("prj"),
    name: workflowNameSchema,
  }),
  output: z.object({
    project: idSchema("prj"),
    name: workflowNameSchema,
    files: z.array(workflowExportFileSchema),
  }),
  actors: ["user"],
  errors: [...readErrors, "forbidden"],
});

export const workflowImport = defineMemory({
  resource: "workflows",
  method: "import",
  name: "ImportWorkflow",
  changes: ["projects"],
  input: z.strictObject({
    project: idSchema("prj"),
    name: workflowNameSchema,
    files: z
      .array(workflowExportFileSchema)
      .min(1)
      .max(WORKFLOW_EXPORT_MAX_FILES),
    overwrite: z.boolean().optional(),
  }),
  output: z.object({
    project: idSchema("prj"),
    name: workflowNameSchema,
    files_written: z.number().int().nonnegative(),
  }),
  actors: ["user"],
  errors: [...readErrors, "forbidden", "conflict"],
});

export const workflowTitleRequestSchema = z.strictObject({
  instance: idSchema("wfi"),
  workflow: workflowNameSchema,
  input: z.string(),
  inputs: workflowInputValuesSchema.optional(),
  expected: z.string().nullable(),
});
export type WorkflowTitleRequest = z.infer<typeof workflowTitleRequestSchema>;

// agent-runtime이 새로 시작된 workflow instance의 AI 제목 생성 요청을 하나씩 가져간다.
export const workflowTitleRequestTake = defineMemory({
  resource: "workflow_instances",
  method: "title-request-take",
  name: "TakeWorkflowTitleRequest",
  input: z.strictObject({}),
  output: z.object({
    request: workflowTitleRequestSchema.nullable(),
  }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "unavailable"],
});

export const WORKFLOW_ROUTES = [
  workflowList,
  workflowStart,
  workflowCheck,
  workflowRename,
  workflowDelete,
  workflowExport,
  workflowImport,
  workflowReport,
  workflowEdit,
  workflowRetry,
  workflowResume,
  workflowStop,
  workflowInstanceRead,
  workflowInstanceList,
  workflowInstanceActivity,
  workflowTitleRequestTake,
] as const;
