import assert from "node:assert/strict";
import { test } from "node:test";

import type { AcpCommand } from "../../../protocol/acp/mod.ts";
import { slashEntriesOf } from "./agent-view-model.ts";
import { optionDescription } from "./question-card/ask-model.ts";

function command(
  name: string,
  description: string,
  over: Partial<AcpCommand> = {},
): AcpCommand {
  return {
    name,
    aliases: [],
    description,
    argument_hint: null,
    source: "harness",
    opens: null,
    ...over,
  };
}

// `/status`에서 설명에 "status"가 든 MCP가 돌고, `/context`가 네 번째로 나온 일이 있었다.
test("`/` 메뉴는 이름이 맞은 명령을 설명만 맞은 명령 위에 둔다", () => {
  const commands = [
    command("compact", "Free up context by summarizing", { source: "app" }),
    command("linear:context", "Pull context from Linear", { source: "mcp" }),
    command("contract", "Review a contract", { source: "skill" }),
    command("context", "Show the context window", {
      source: "app",
      opens: "context",
    }),
    command("config", "Open the settings", { aliases: ["settings"] }),
  ];
  const names = (query: string) =>
    slashEntriesOf(commands, query, true).map((entry) => entry.name);

  // 이름 정확 → 이름 앞부분(짧은 것이 위) → 이름 조각 → 설명 단어
  assert.deepStrictEqual(names("context"), [
    "context",
    "linear:context",
    "compact",
  ]);
  assert.deepStrictEqual(names("con"), [
    "config",
    "context",
    "contract",
    "linear:context",
    "compact",
  ]);
  // 별칭으로 맞은 명령은 어느 별칭인지 알린다.
  assert.equal(
    slashEntriesOf(commands, "settings", true)[0]?.alias,
    "settings",
  );
});

test("optionDescription hides blank or duplicate descriptions and keeps distinct ones", () => {
  const longLabel =
    "(Recommended) 대화 승인 카드로 한 번 확인 후 바로 시작 — 요약(단계·참가자·변경점)을 보고 승인 한 번으로 즉시 실행·전용 desk 열림.";
  assert.equal(
    optionDescription({ label: longLabel, description: longLabel }),
    null,
  );
  assert.equal(
    optionDescription({
      label: "First line\nSecond line",
      description: "First line Second line",
    }),
    null,
  );
  assert.equal(optionDescription({ label: "Tabs", description: "   " }), null);
  assert.equal(
    optionDescription({
      label: "Tabs",
      description: "Use tab characters for indentation",
    }),
    "Use tab characters for indentation",
  );
});
