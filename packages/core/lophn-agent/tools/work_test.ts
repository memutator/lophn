import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";
import { err, type ErrorCode } from "../../../base/mod.ts";
import { defineTool } from "./define.ts";
import type { ToolContext } from "./tool-context.ts";
import { executeToolCall } from "./work.ts";

// 실패한 대상이 model이 보낸 입력뿐인 tool은 handler 문장을 그대로 싣고, 그 밖의 tool은 공통 문장만 쓴다.
// 문장이 지워지면 model은 원인을 가릴 수 없어 같은 입력으로 되풀이한다. 반대로 남의 대상 이름이 새면 안 된다.
test("skill.read와 agent.card의 실패는 원인을 싣고 다른 tool의 not_found는 공통 문장을 쓴다", async () => {
  const failing = (name: string, code: ErrorCode) =>
    defineTool({
      name,
      description: "fail",
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () =>
        Promise.resolve(err({ code, message: "skill x has no file notes.md" })),
    });
  const ctx = {
    listed: [
      failing("skill.read", "not_found"),
      failing("agent.card", "not_found"),
      failing("file.read", "not_found"),
    ],
  } as unknown as ToolContext;
  const summary = async (wireName: string) =>
    (await executeToolCall(ctx, wireName, {})).result.summary;

  assert.deepStrictEqual(
    await summary("skill_read"),
    "tool target is not available: skill x has no file notes.md",
  );
  assert.deepStrictEqual(
    await summary("agent_card"),
    "tool target is not available: skill x has no file notes.md",
  );
  assert.deepStrictEqual(
    await summary("file_read"),
    "tool target is not available",
  );
});

// 이유를 못 받은 model이 바깥 browser를 띄운 일이 있었다. browser·tab의 unavailable·conflict는 이유 문장을 싣고,
// 그 밖의 code와 tool은 대상 이름·존재를 가리려 공통 문장을 쓴다.
test("browser 호출이 unavailable·conflict로 실패하면 model이 이유 문장을 받고 다른 경우는 공통 문장이다", async () => {
  const reason = "The tab is not open in a window. Tell the person.";
  const failing = (name: string, code: ErrorCode) =>
    defineTool({
      name,
      description: "fail",
      effect: "read",
      input: z.strictObject({}),
      routes: [],
      handler: () => Promise.resolve(err({ code, message: reason })),
    });
  const ctx = {
    listed: [
      failing("browser.snapshot", "unavailable"),
      failing("browser.act", "conflict"),
      failing("tab.open", "unavailable"),
      failing("browser.read", "not_found"),
      failing("file.read", "unavailable"),
    ],
  } as unknown as ToolContext;
  const summary = async (wireName: string) =>
    (await executeToolCall(ctx, wireName, {})).result.summary;

  assert.ok((await summary("browser_snapshot")).endsWith(reason));
  assert.ok((await summary("browser_act")).endsWith(reason));
  assert.ok((await summary("tab_open")).endsWith(reason));
  assert.equal(await summary("browser_read"), "tool target is not available");
  assert.equal(await summary("file_read"), "tool is unavailable");
});
