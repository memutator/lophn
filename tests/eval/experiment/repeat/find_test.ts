// 세 질문
// - contract: 같은 tool·같은 입력 hash가 한 session에서 3번 이상이면 묶음이 되고, 재시도에 밀린 행과 model 탓이 아닌 미실행은 세지 않으며, 막힌(denied) 반복은 센다.
// - 현실적 회귀: 세는 규칙이 틀려 judge가 엉뚱한 묶음으로 돈다(재시도 행이 되풀이로 세어지거나 denied 반복이 빠진다).
// - 왜 지금 test로 못 잡나: 이 규칙을 보는 다른 test가 없고 진짜 trial 없이는 묶음을 볼 일이 없다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCall } from "../../../../packages/protocol/lophn-agent/tool-values.ts";
import type {
  CollectedToolCall,
  SessionRecord,
  TrialRecord,
} from "../../types.ts";
import { findRepeatGroups } from "./find.ts";
import { repeatKindInput } from "./input.ts";

type Row = [
  id: string,
  tool: string,
  input: string,
  outcome: [kind: string, code: string] | null,
  retryOf?: string,
];

const calls = (rows: Row[]): CollectedToolCall[] =>
  rows.map(([id, tool, input, outcome, retry_of]) => ({
    call: {
      id,
      tool,
      input,
      retry_of: retry_of ?? null,
      state: "finished",
      outcome: outcome && { kind: outcome[0], code: outcome[1] },
    } as unknown as ToolCall,
    input: { hash: input },
    output: null,
    body_truncated: false,
  }));

const session = (name: string, rows: Row[]): SessionRecord =>
  ({ session: name, tool_calls: calls(rows) }) as unknown as SessionRecord;

const FAIL: [string, string] = ["failed", "boom"];

test("findRepeatGroups groups 3+ same tool and input per session, skips retried and excluded rows, counts denied", () => {
  const trial = {
    index: 0,
    sessions: [
      session("s1", [
        ["a1", "read", "h1", FAIL],
        ["a2", "list", "h2", FAIL],
        ["a3", "read", "h1", FAIL],
        ["a4", "read", "h1", FAIL],
        ["b1", "write", "h3", FAIL], // 2번뿐
        ["b2", "write", "h3", FAIL],
        ["c1", "grep", "h4", FAIL], // 재시도에 밀려 c3은 2번으로 센다
        ["c2", "grep", "h4", FAIL, "c1"],
        ["c3", "grep", "h4", FAIL],
        ["d1", "ask", "h5", ["not_executed", "stopped"]], // model 탓이 아니다
        ["d2", "ask", "h5", ["not_executed", "stopped"]],
        ["d3", "ask", "h5", ["not_executed", "stopped"]],
        ["e1", "call", "h6", ["not_executed", "denied"]], // 막힌 반복은 센다
        ["e2", "call", "h6", ["not_executed", "denied"]],
        ["e3", "call", "h6", ["not_executed", "denied"]],
      ]),
      session("s2", [
        ["x1", "read", "h1", FAIL],
        ["x2", "read", "h1", FAIL],
      ]),
    ],
  } as unknown as TrialRecord;

  const groups = findRepeatGroups(trial);
  assert.deepStrictEqual(
    groups.map((g) => [g.session, g.tool, g.calls]),
    [
      ["s1", "read", ["a1", "a3", "a4"]],
      ["s1", "call", ["e1", "e2", "e3"]],
    ],
  );
  assert.deepStrictEqual(
    groups[0].timeline.map((t) => t.call.id),
    ["a1", "a2", "a3", "a4"],
  );

  const text = repeatKindInput(groups[0]);
  assert.deepStrictEqual(
    text.split("\n").filter((l) => l.startsWith("#2 ")).length,
    1,
  );
  assert.deepStrictEqual(text.includes("#1 *read"), true);
  assert.deepStrictEqual(text.includes("#2 list"), true);
});
