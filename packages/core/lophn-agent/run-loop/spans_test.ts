import assert from "node:assert/strict";
import { test } from "node:test";

import {
  modelCallEndAttributes,
  modelCallStartAttributes,
  toolCallEndAttributes,
  toolCallStartAttributes,
  turnEndAttributes,
} from "./spans.ts";

const SECRET = "hunter2-the-user-typed-this";

// span 줄은 trace 설정이 켜지면 log file에 남는다. 대화·tool 입출력·오류 글이 attribute로 새지 않게 모양을 고정한다.
test("agent span attributes carry ids, names and numbers but never message or tool content", () => {
  const all = {
    ...modelCallStartAttributes({
      session: "ses_1",
      turn: "trn_1",
      provider: "anthropic",
      model: "claude-x",
      purpose: "judgment",
      kind: "initial",
      order: 1,
    }),
    ...modelCallEndAttributes(
      // provider가 낸 글(provider_code, finish_reason)은 싣지 않는다.
      {
        kind: "failed",
        code: "rate_limited",
        http_status: 429,
        provider_code: SECRET,
        finish_reason: SECRET,
      } as never,
      {
        input: 10,
        output: 2,
        cache_read: null,
        cache_write: null,
        reasoning: null,
      },
    ),
    // model이 지어낸 tool 이름은 싣지 않고 unknown으로 둔다.
    ...toolCallStartAttributes({
      session: "ses_1",
      turn: "trn_1",
      modelCall: "mcl_1",
      tool: undefined,
      attempt: 0,
    }),
    // 기계 code가 아닌 글이 오면 other로 가린다.
    ...toolCallEndAttributes({
      tool_call: "tcl_1",
      status: "failure",
      code: `Error: ${SECRET}`,
    }),
    ...turnEndAttributes({
      kind: "finished",
      outcome: { kind: "failed", reason: "model_error" },
    }),
  };
  assert.ok(!JSON.stringify(all).includes(SECRET));
  assert.equal(all["lophn.tool"], "unknown");
  assert.equal(all["lophn.code"], "other");
  assert.equal(all["lophn.tokens.input"], 10);
  assert.ok(!("lophn.tokens.cache_read" in all));
});
