import { z } from "zod";
import { problemReportInputSchema } from "../../problems/problem-report.ts";
import { reportAcceptanceSchema } from "../../problems/reports.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  runtimeModeSchema,
} from "../channel-values.ts";
import { appIdSchema } from "../../projects/values.ts";
import { appApiCallOutputSchema, appApiKeySchema } from "./call.ts";
import { projectSummarySchema } from "./project.ts";

// 앱 process가 broker socket으로 부르는 경로.
export const APP_BROKER_PATHS = {
  call: "/_lophn/broker/apps/call",
  projects: "/_lophn/broker/projects/list",
  problemsReport: "/_lophn/broker/problems/report",
} as const;

// 자식 credential·현재 mode·nonce에 묶인다. 신원은 요청 본문이 정하지 않는다.
const childFields = {
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
};

// project 칸이 없다. core가 부른 invocation의 project를 넘긴다.
export const brokerAppCallInputSchema = z.strictObject({
  ...childFields,
  target_app: appIdSchema,
  api: appApiKeySchema,
  input: jsonValueSchema.optional(),
  parent_invocation: invocationIdSchema.nullable(),
});
export const brokerAppCallOutputSchema = appApiCallOutputSchema;

export const brokerProjectsListInputSchema = z.strictObject(childFields);
export const brokerProjectsListOutputSchema = z.object({
  projects: z.array(projectSummarySchema),
});

export const brokerReportProblemInputSchema = problemReportInputSchema
  .safeExtend(
    childFields,
  );
export const brokerReportProblemOutputSchema = reportAcceptanceSchema;
