import assert from "node:assert/strict";
import { test } from "node:test";

import { idSchema } from "../../../protocol/base/ids.ts";
import { guiSessionId, stripStatusGlyphs, tabName } from "./model.ts";

test("터미널 제목 앞의 상태 글리프를 뗀다", () => {
  const cases: [string, string][] = [
    ["✳ Claude Code", "Claude Code"],
    ["⠋ lophn", "lophn"],
    ["◐ lophn", "lophn"],
    ["* Fix the build", "Fix the build"],
    [". Fix the build", "Fix the build"],
    ["OC | session title", "OC | session title"],
    ["a.b *c", "a.b *c"],
    ["⠋", ""],
  ];
  for (const [title, expected] of cases) {
    assert.deepStrictEqual(stripStatusGlyphs(title), expected);
  }
});

test("탭 이름은 사람 이름, GUI 제목, harness session 이름, agent 제목, 자동 이름 순이다", () => {
  const auto = "lophn";
  assert.deepStrictEqual(
    tabName({
      person: "mine",
      guiTitle: null,
      sessionName: "named",
      agentTitle: "⠋ x",
      auto,
    }),
    "mine",
  );
  assert.deepStrictEqual(
    tabName({
      person: "mine",
      guiTitle: "gui",
      sessionName: "named",
      agentTitle: "user@host: ~",
      auto,
    }),
    "mine",
  );
  assert.deepStrictEqual(
    tabName({
      person: null,
      guiTitle: "gui",
      sessionName: "named",
      agentTitle: "user@host: ~",
      auto,
    }),
    "gui",
  );
  assert.deepStrictEqual(
    tabName({
      person: null,
      guiTitle: null,
      sessionName: "named",
      agentTitle: "⠋ x",
      auto,
    }),
    "named",
  );
  assert.deepStrictEqual(
    tabName({
      person: null,
      guiTitle: null,
      sessionName: null,
      agentTitle: "⠋ x",
      auto,
    }),
    "x",
  );
  assert.deepStrictEqual(
    tabName({
      person: null,
      guiTitle: null,
      sessionName: null,
      agentTitle: "✳",
      auto,
    }),
    auto,
  );
  assert.deepStrictEqual(
    tabName({
      person: null,
      guiTitle: null,
      sessionName: null,
      agentTitle: null,
      auto,
    }),
    auto,
  );
});

test("GUI 화면의 session id는 ACP 입력의 session 검사를 통과한다", () => {
  const session = guiSessionId("win_01hzx3k4m5n6p7q8r9s0t1v2w3");
  assert.equal(session, "ses_01hzx3k4m5n6p7q8r9s0t1v2w3");
  assert.ok(idSchema("ses").safeParse(session).success);
});
