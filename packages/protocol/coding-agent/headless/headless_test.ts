import assert from "node:assert/strict";
import { test } from "node:test";

import { HARNESS_ADAPTERS } from "../harness-adapter.ts";
import { FIXTURES } from "./fixtures.ts";
import type { HeadlessEvent } from "./types.ts";

function parse(id: "claude" | "codex" | "opencode", run: "run1" | "run2") {
  const parser = HARNESS_ADAPTERS[id].headless!.parser();
  return FIXTURES[id][run].flatMap((line) => parser(line));
}

// 녹화한 실제 출력에서 메시지 글, tool, session id, 끝이 나와야 한다. 출력 모양이 판마다 바뀌면 여기서 깨진다.
const EXPECTED: [
  "claude" | "codex" | "opencode",
  string,
  HeadlessEvent[],
  HeadlessEvent[],
][] = [
  [
    "claude",
    "a80193a9-afb4-4c9d-b4eb-c0f863e7682c",
    [
      { kind: "tool", name: "Read", summary: "/work/note.txt", status: "done" },
      { kind: "text", text: "done" },
      { kind: "end", ok: true },
    ],
    [
      { kind: "text", text: "hello" },
      { kind: "end", ok: true },
    ],
  ],
  [
    "codex",
    "01a1a61f-c897-7401-af11-52b2aa917174",
    [
      { kind: "text", text: "I’ll run `cat note.txt`.\n" },
      {
        kind: "tool",
        name: "command",
        summary: "/bin/bash -lc 'cat note.txt'",
        status: "done",
      },
      { kind: "text", text: "done" },
      { kind: "end", ok: true },
    ],
    [
      { kind: "text", text: "hello" },
      { kind: "end", ok: true },
    ],
  ],
  [
    "opencode",
    "ses_e59df9fb9ffeQuLauX2nTxSp3g",
    [
      { kind: "text", text: "Reading note.txt, then confirming." },
      { kind: "tool", name: "read", summary: "note.txt", status: "done" },
      { kind: "text", text: "done" },
    ],
    [{ kind: "text", text: "hello" }],
  ],
];

for (const [id, session, run1, run2] of EXPECTED) {
  test(`${id}: 녹화 출력에서 session id, 글, tool, 끝을 낸다`, () => {
    assert.deepEqual(parse(id, "run1"), [
      { kind: "session", id: session },
      ...run1,
    ]);
    // resume한 run도 같은 session id를 낸다.
    assert.deepEqual(parse(id, "run2"), [
      { kind: "session", id: session },
      ...run2,
    ]);
  });
}

// 권한 표: deny는 disallow로 옮기고, 지킬 수 없는 harness는 규칙이 있으면 띄우지 않는다. 전부 허락 flag는 어디에도 없다.
test("권한 표는 deny를 disallow로 옮기고 전부 허락 flag를 내지 않는다", () => {
  const claude = HARNESS_ADAPTERS.claude.headless!;
  const deny = claude.permissions(["lophn(notes remove)"]);
  assert.deepEqual(deny, [
    "Bash(lophn notes remove)",
    "Bash(lophn notes remove *)",
  ]);
  assert.equal(claude.permissions(["Bash(rm *)"]), null);
  assert.equal(
    HARNESS_ADAPTERS.codex.headless!.permissions(["lophn(notes remove)"]),
    null,
  );
  assert.equal(
    HARNESS_ADAPTERS.opencode.headless!.permissions(["lophn(notes remove)"]),
    null,
  );
  for (const id of ["claude", "codex", "opencode"] as const) {
    const spec = HARNESS_ADAPTERS[id].headless!;
    for (const sessionId of [null, "abc"]) {
      const argv = spec.args({
        prompt: "hi",
        sessionId,
        forkFrom: null,
        deny: spec.permissions([]) ?? [],
      });
      assert.ok(
        !argv.some((arg) =>
          /bypassPermissions|danger-full-access|dangerously|--auto|dontAsk/.test(
            arg,
          ),
        ),
        `${id} ${argv.join(" ")}`,
      );
    }
  }
  const resumed = claude.args({
    prompt: "hi",
    sessionId: "abc",
    forkFrom: null,
    deny: deny ?? [],
  });
  assert.deepEqual(resumed.slice(-2), ["--", "hi"]);
  assert.ok(
    resumed.includes("--disallowed-tools") && resumed.includes("--resume"),
  );
});
