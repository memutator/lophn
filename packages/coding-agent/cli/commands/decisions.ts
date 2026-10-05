// context command의 route 표다(T12, cli#R16). 읽기는 소유 route로 core에 닿고
// propose는 변경안 접수다. context·term 정의·assignment 관리는 화면의 몫이며 표에
// 없다(cli#R16). question·approval은 question.ts·approval.ts에 있다(T16).
import {
  CLI_DECISION_COMMANDS,
  cliContextGlossarySchema,
  cliContextItemsSchema,
  cliContextListSchema,
  cliContextOfSchema,
  cliContextShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  contextGet,
  contextList,
  contextRelated,
  outlineContext,
  termList,
} from "../../../contracts/documents/mod.ts";
import type { CommandEntry } from "./types.ts";

export const CONTEXT_COMMANDS: readonly CommandEntry[] = [
  {
    name: "context list",
    input: cliContextListSchema,
    monoRoute: contextList,
  },
  {
    name: "context show",
    input: cliContextShowSchema,
    monoRoute: contextGet,
  },
  {
    name: "context items",
    input: cliContextItemsSchema,
    monoRoute: outlineContext,
  },
  {
    name: "context glossary",
    input: cliContextGlossarySchema,
    monoRoute: termList,
  },
  {
    name: "context of",
    input: cliContextOfSchema,
    monoRoute: contextRelated,
  },
  // propose는 변경안 문서 접수다. 고정 변경안 문서 저장은 host의 몫이라
  // owner route가 없다(mcp-decisions). T12 뼈대에서는 실행 전 안내로 끝낸다.
  {
    name: "context propose",
    input: CLI_DECISION_COMMANDS[5],
  },
];
