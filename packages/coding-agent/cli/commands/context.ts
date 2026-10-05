// context command의 route 표와 propose 실행이다(T12·T17, cli#R18·R19). 읽기는 소유 route로
// core에 닿는다: 보관 포함 목록·상세·기준과 참고와 watch 항목·glossary·문서를 참조하는
// context. 생성·항목 추가와 제거·보관은 CLI에 없고 화면에서 한다(cli#R18). propose는 고정
// 변경안·이유 문서의 접수이고 MCP `lophn_context propose`와 같은 통로를 쓴다: 변경안
// 문서만 남기고 context·용어는 그대로이며 run도 질문도 만들지 않는다(cli#R19, Q14).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
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
  documentPrepare,
  documentSave,
  outlineContext,
  termList,
} from "../../../contracts/documents/mod.ts";
import {
  type ContextProposalDeps,
  type ContextProposalReport,
  describeContextProposal,
  proposeContextChange,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

const cliContextProposeSchema = CLI_DECISION_COMMANDS[5];

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
  {
    name: "context propose",
    input: cliContextProposeSchema,
    // propose가 이어 부르는 소유 route들이다: 대상 context 읽기와 변경안 문서의 준비·저장.
    // context·term command route는 없다.
    opRoutes: {
      context: contextGet,
      prepare: documentPrepare,
      save: documentSave,
    },
  },
];

export type ContextProposeDeps = ContextProposalDeps;

// 검사한 입력으로 변경안을 접수한다. 실패는 단계의 오류 그대로다.
export async function runContextPropose(
  input: { change: unknown; reason: string; idempotency_key?: string },
  deps: ContextProposeDeps,
): Promise<Result<ContextProposalReport, LophnError>> {
  const proposed = await proposeContextChange(deps, {
    change: input.change,
    reason: input.reason,
    ...(input.idempotency_key === undefined
      ? {}
      : { idempotency_key: input.idempotency_key }),
  });
  if (!proposed.ok) return err(proposed.error);
  return ok(describeContextProposal(proposed.value));
}
