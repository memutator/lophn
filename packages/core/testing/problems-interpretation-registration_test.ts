// problems 해석 연결 시험의 harness 등록. Deno.test는 없다. grouping fixture에 agent run 판정 port와,
// lophn-agent ToolCall 성공 안에서 LinkProblemInterpretation을 같은 Tx로 부르는 시험 command를 더한다
// (질문 Q13). 이 파일이 core testing에 있는 까닭은 platform의 run 판정 port를 packages/core/problems가 못 받기 때문이다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
} from "../../protocol/server/mod.ts";
import {
  interpretationLinkInputSchema,
  linkProblemInterpretation,
} from "../../protocol/problems/mod.ts";
import { runAdmission } from "../storage/ledger/mod.ts";
import { createLedgerTestRegistration as grouping } from "../problems/grouping/testing/mod.ts";
import { defineTxPort } from "./ledger.ts";

// ToolCall 성공 기록이다. 같은 transaction에서 해석 연결이 거절되면 이 행도 남지 않아야 한다.
const toolCall = defineCommand({
  resource: "problems",
  method: "test-tool-call",
  name: "problems.testing.tool-call",
  input: z.object({
    id: z.string(),
    problem: z.string(),
    interpretation: interpretationLinkInputSchema.nullable(),
  }),
  output: z.object({ linked: z.boolean() }),
  compare: z.strictObject({
    problem_seq: z.string(),
    previous: interpretationLinkInputSchema.nullable(),
  }),
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "forbidden", "conflict"],
});

const toolCallCommand: CommandDefinition<typeof toolCall> = {
  route: toolCall,
  handle(tx, _ctx, input, compare) {
    tx.sql.run("insert into test_tool_calls (id) values (?)", [input.id]);
    const called = tx.call(
      linkProblemInterpretation,
      { problem: input.problem, interpretation: input.interpretation },
      compare,
    );
    if (!called.ok) return called;
    return ok({ linked: true });
  },
};

export function createLedgerTestRegistration() {
  const base = grouping();
  return {
    ...base,
    schemaSteps: [
      ...base.schemaSteps,
      {
        id: "problems.testing_tool_calls",
        sql: "create table test_tool_calls (id text primary key) strict;",
      },
    ],
    commands: [...base.commands, toolCallCommand as CommandDefinition],
    ports: [
      defineTxPort(runAdmission, () => ({ status: () => "active" as const })),
    ],
  };
}
