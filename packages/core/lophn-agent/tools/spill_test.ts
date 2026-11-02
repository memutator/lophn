import assert from "node:assert/strict";
import { test } from "node:test";

import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { toolResultFile } from "../../../protocol/lophn-agent/tool-results.ts";
import { jsonBytes, TEXT_MAX_BYTES } from "./result.ts";
import { type SpillableResult, spillLarge } from "./spill.ts";

const call = { session: "ses_a", tool_call: "tcl_b" };

function result(
  content: unknown,
  arrayKeys: readonly string[],
): SpillableResult {
  return {
    status: "success",
    summary: "big",
    content: content as ToolResult["content"],
    complete: true,
    source: null,
    continuation: null,
    pending: [],
    spill: { arrayKeys },
  };
}

// 상한을 넘은 결과는 전체가 session의 tool-results 파일에 가고, model(과 기록)에는 상한 안의 미리보기와 경로만 간다.
test("상한을 넘는 결과는 파일에 전체를 쓰고 미리보기와 경로를 돌려준다", async () => {
  const items = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    text: "x".repeat(40),
  }));
  const files = new Map<string, string>();
  const spill = {
    dataRoot: "/data",
    write: (path: string, text: string) => {
      files.set(path, text);
      return Promise.resolve();
    },
  };
  for (const keys of [["items"], []]) {
    const content = { items };
    const out = await spillLarge({ ...call, spill }, result(content, keys));
    const path = toolResultFile("/data", call.session, call.tool_call);
    assert.deepStrictEqual(files.get(path), JSON.stringify(content, null, 2));
    assert.ok(jsonBytes(out.content) <= TEXT_MAX_BYTES);
    assert.strictEqual(out.complete, false);
    assert.ok(out.pending.at(-1)?.includes(path));
    assert.ok(!("spill" in out));
    // 같은 입력은 같은 미리보기다(history가 매번 같은 bytes).
    const again = await spillLarge({ ...call, spill }, result(content, keys));
    assert.deepStrictEqual(again, out);
  }
});

test("파일을 쓰지 못해도 tool 호출은 실패하지 않고 경로 없는 미리보기를 준다", async () => {
  const spill = {
    dataRoot: "/data",
    write: () => Promise.reject(new Error("disk full")),
  };
  const original = console.error;
  console.error = () => {};
  try {
    const out = await spillLarge(
      { ...call, spill },
      result({ text: "y".repeat(TEXT_MAX_BYTES * 2) }, []),
    );
    assert.ok(jsonBytes(out.content) <= TEXT_MAX_BYTES);
    assert.strictEqual(out.complete, false);
    assert.ok(!out.pending.join(" ").includes("/data"));
  } finally {
    console.error = original;
  }
});
