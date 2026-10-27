import assert from "node:assert/strict";
import { test } from "node:test";

import { stripStatusGlyphs, tabName } from "./model.ts";

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

test("탭 이름은 사람 이름, agent 제목, 자동 이름 순이다", () => {
  const auto = "lophn";
  assert.deepStrictEqual(
    tabName({ person: "mine", agentTitle: "⠋ x", auto }),
    "mine",
  );
  assert.deepStrictEqual(
    tabName({ person: null, agentTitle: "⠋ x", auto }),
    "x",
  );
  assert.deepStrictEqual(
    tabName({ person: null, agentTitle: "✳", auto }),
    auto,
  );
  assert.deepStrictEqual(
    tabName({ person: null, agentTitle: null, auto }),
    auto,
  );
});
