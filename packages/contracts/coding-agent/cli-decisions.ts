import { z } from "zod";
import {
  contextGet,
  contextList,
  contextPerspectiveSchema,
  contextRelated,
  outlineContext,
  termList,
} from "../documents/mod.ts";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import { thingsToConfirmLinkSchema } from "../shell/mod.ts";
import { cliCommonSchema } from "./cli-core.ts";
import { contextProposeFields } from "./mcp-decisions.ts";

const common = cliCommonSchema.shape;
const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
) => input.extend({ command: z.literal(command), ...common });

// CLI도 MCP가 고른 op 목록 밖의 command를 만들지 않는다. 위치 인자가 없고 선택값만 있다.
export const cliContextListSchema = withCommon(
  "context list",
  contextList.input,
);
export const cliContextShowSchema = withCommon(
  "context show",
  contextGet.input,
);
export const cliContextItemsSchema = withCommon(
  "context items",
  outlineContext.input.extend({
    perspective: contextPerspectiveSchema.optional(),
  }),
);
export const cliContextGlossarySchema = withCommon(
  "context glossary",
  termList.input,
);
export const cliContextOfSchema = withCommon(
  "context of",
  contextRelated.input,
);

export const CLI_DECISION_NAMES = [
  "context list",
  "context show",
  "context items",
  "context glossary",
  "context of",
  "context propose",
  "question list",
  "question show",
  "question open",
  "approval list",
  "approval show",
  "approval open",
] as const;

// open은 exact 결정 화면 링크와 대기 사실만 낸다. 답·허락·거절·승인을 입력받지 않는다.
export const cliQuestionListSchema = withCommon(
  "question list",
  questionList.input,
);
export const cliQuestionShowSchema = withCommon(
  "question show",
  questionRead.input,
);
export const cliQuestionOpenSchema = withCommon(
  "question open",
  z.strictObject({ question: questionRead.input.shape.question }),
);
export const cliApprovalListSchema = withCommon(
  "approval list",
  approvalsList.input,
);
export const cliApprovalShowSchema = withCommon(
  "approval show",
  approvalsGet.input,
);
export const cliApprovalOpenSchema = withCommon(
  "approval open",
  z.strictObject({ approval: approvalsGet.input.shape.approval }),
);

export const CLI_DECISION_COMMANDS = [
  cliContextListSchema,
  cliContextShowSchema,
  cliContextItemsSchema,
  cliContextGlossarySchema,
  cliContextOfSchema,
  withCommon("context propose", z.strictObject(contextProposeFields)),
  cliQuestionListSchema,
  cliQuestionShowSchema,
  cliQuestionOpenSchema,
  cliApprovalListSchema,
  cliApprovalShowSchema,
  cliApprovalOpenSchema,
] as const;

export type CliDecisionName = (typeof CLI_DECISION_NAMES)[number];

// 대기 위치는 사람이 결정하는 화면이다. 창을 직접 열거나 승인 입력을 받지 않는다.
export function decisionLink(id: string): string {
  return thingsToConfirmLinkSchema.parse(`lophn://things-to-confirm/${id}`);
}
