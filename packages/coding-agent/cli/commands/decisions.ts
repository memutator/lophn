// question·approval command의 route 표다(T12, cli#R16·R21). 읽기는 소유 route로 core에
// 닿고 open은 결정 화면 링크다. context command는 context.ts에 있다(T17).
// assignment 관리는 화면의 몫이며 표에 없다(cli#R16).
import {
  cliApprovalListSchema,
  cliApprovalOpenSchema,
  cliApprovalShowSchema,
  cliQuestionListSchema,
  cliQuestionOpenSchema,
  cliQuestionShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  approvalsGet,
  approvalsList,
} from "../../../contracts/platform/mod.ts";
import {
  questionList,
  questionRead,
} from "../../../contracts/lophn-agent/mod.ts";
import type { CommandEntry } from "./types.ts";

export const QUESTION_COMMANDS: readonly CommandEntry[] = [
  {
    name: "question list",
    input: cliQuestionListSchema,
    monoRoute: questionList,
  },
  {
    name: "question show",
    input: cliQuestionShowSchema,
    monoRoute: questionRead,
  },
  // open은 결정 화면 링크와 대기 사실만 낸다. 답을 입력받지 않는다(cli#R21).
  {
    name: "question open",
    input: cliQuestionOpenSchema,
  },
];

export const APPROVAL_COMMANDS: readonly CommandEntry[] = [
  {
    name: "approval list",
    input: cliApprovalListSchema,
    monoRoute: approvalsList,
  },
  {
    name: "approval show",
    input: cliApprovalShowSchema,
    monoRoute: approvalsGet,
  },
  // open은 결정 화면 링크와 대기 사실만 낸다. 허락을 입력받지 않는다(cli#R21).
  {
    name: "approval open",
    input: cliApprovalOpenSchema,
  },
];
