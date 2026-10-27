// - contract: eval roadmap "experiment". 재생은 같은 대화일 때만 숫자를 낸다.
// - 현실적 회귀: session이 여럿이거나 compaction·재시도가 낀 trial을 재생해 순서가 어긋난 요청으로 숫자를 낸다. tool 흐름이 다른데 같은 대화인 척한다. prefix가 깨진 call을 못 짚는다.
// - 왜 지금 test로 못 잡나: measureAssembly는 core를 띄워 test하지 않으므로 이 순수 판정이 유일한 방어선이다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrialRecord } from "../../types.ts";
import { firstDivergence, sideStat } from "./compare.ts";
import type { Boundary } from "./prefix.ts";
import { scriptOf } from "./script.ts";

const user = (content: unknown) => ({ role: "user", content });
const assistant = (content: unknown) => ({ role: "assistant", content });
const use = (id: string, name: string) => ({
  type: "tool_use",
  id,
  name,
  input: { a: 1 },
});
const result = (id: string, is_error?: boolean) => ({
  type: "tool_result",
  tool_use_id: id,
  content: "x",
  ...(is_error ? { is_error } : {}),
});

const r1 = { messages: [user("hi")] };
const r2 = {
  messages: [
    user("hi"),
    assistant([{ type: "thinking", thinking: "..." }, {
      type: "text",
      text: "looking",
    }, use("t1", "app_list")]),
    user([result("t1")]),
  ],
};
const r3 = {
  messages: [...r2.messages, assistant([{ type: "text", text: "all set" }])],
};

const call = (
  id: string,
  request: unknown,
  over: Record<string, unknown> = {},
) => ({
  call: {
    id,
    purpose: "judgment",
    state: "finished",
    outcome: { kind: "complete" },
    attempt_kind: "initial",
    ...over,
  },
  request,
});
const session = (id: string, calls: ReturnType<typeof call>[]) => ({
  session: id,
  model_calls: calls,
});
const trialOf = (sessions: unknown[], kind = "idle") =>
  ({
    index: 0,
    settle: { kind, unstarted: [] },
    sessions,
  }) as unknown as TrialRecord;

test("scriptOf가 다음 요청의 assistant message에서 답을 되살리고 재생 못 하는 trial은 이유와 함께 거절한다", () => {
  const ok = scriptOf(
    trialOf([
      session("s1", [call("m1", r1), call("m2", r2), call("m3", r3)]),
      session("s2", []),
    ]),
  );
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.value.replies, [
    {
      kind: "tool",
      calls: [{ id: "t1", name: "app_list", arguments: '{"a":1}' }],
      text: "looking",
    },
    { kind: "text", text: "all set" },
    { kind: "text", text: "done" },
  ]);

  const refused = (t: TrialRecord) => {
    const got = scriptOf(t);
    assert.ok(!got.ok);
    return got.error.message;
  };
  assert.ok(
    refused(
      trialOf([
        session("s1", [call("m1", r1), call("m2", r2)]),
        session("s2", [call("m3", r1)]),
      ]),
    ).includes("2 sessions"),
  );
  assert.ok(
    refused(
      trialOf([
        session("s1", [
          call("m1", r1),
          call("m2", r2, { purpose: "conversation_compression" }),
        ]),
      ]),
    ).includes("m2"),
  );
  assert.ok(
    refused(
      trialOf([
        session("s1", [
          call("m1", r1),
          call("m2", r2, { attempt_kind: "retry" }),
        ]),
      ]),
    ).includes("retry"),
  );
  assert.ok(
    refused(trialOf([session("s1", [call("m1", r1)])])).includes(
      "one model call",
    ),
  );
  assert.ok(
    refused(
      trialOf([session("s1", [call("m1", r1), call("m2", r2)])], "timeout"),
    ).includes("settle"),
  );
});

test("firstDivergence가 tool 흐름이 처음 다른 call을 짚고 글 차이는 무시한다", () => {
  const noticed = {
    messages: [
      user([{ type: "text", text: "hi" }, { type: "text", text: "<notice>" }]),
    ],
  };
  assert.deepStrictEqual(
    firstDivergence([r1, r2, r3], [noticed, r2, r3]),
    null,
  );
  const wrong = {
    messages: [...r2.messages.slice(0, 2), user([result("t1", true)])],
  };
  assert.deepStrictEqual(firstDivergence([r1, r2, r3], [r1, wrong, r3])?.at, 2);
  assert.deepStrictEqual(firstDivergence([r1, r2, r3], [r1, r2])?.at, 3);
});

test("sideStat이 prefix가 깨진 call과 layer를 짚고 없어진 layer는 깨짐으로 센다", () => {
  const b = (layer: string, hash: string, text: string): Boundary => ({
    layer,
    prefix_hash: hash,
    text,
  });
  const stat = sideStat([
    [
      b("role", "r", "R"),
      b("instructions", "i1", "# Instructions\nbe brief"),
      b("place", "p1", "place A"),
    ],
    [
      b("role", "r", "R"),
      b("instructions", "i1", "# Instructions\nbe brief"),
      b("place", "p2", "place B"),
    ],
    [b("role", "r", "R"), b("place", "p3", "place B")],
  ]);
  const by = (layer: string) => stat.layers.find((l) => l.layer === layer)!;
  assert.deepStrictEqual(stat.layers.map((l) => l.layer), [
    "role",
    "instructions",
    "place",
  ]);
  assert.deepStrictEqual(by("role").rate, 1);
  assert.deepStrictEqual(
    [by("instructions").stable, by("instructions").pairs],
    [1, 2],
  );
  assert.deepStrictEqual(by("instructions").first_break, {
    call: 3,
    before: "# Instructions",
    after: "(absent)",
  });
  assert.deepStrictEqual(by("place").first_break, {
    call: 2,
    before: "place A",
    after: "place B",
  });
  assert.deepStrictEqual(by("place").rate, 0);
});
