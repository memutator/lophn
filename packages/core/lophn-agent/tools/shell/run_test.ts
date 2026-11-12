import assert from "node:assert/strict";
import { test } from "node:test";

import type { ToolContext } from "../tool-context.ts";
import { collect, runShell } from "./run.ts";

function streamOf(bytes: Uint8Array, chunkSize = 5000) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunkSize) {
        controller.enqueue(bytes.slice(at, at + chunkSize));
      }
      controller.close();
    },
  });
}

const encode = (text: string) => new TextEncoder().encode(text);

test("shell 출력은 stream마다 상한을 넘지 않고 앞뒤가 남으며 가운데 생략이 표시된다", async () => {
  const small = "hello\nworld\n";
  assert.deepStrictEqual(await collect(streamOf(encode(small))), {
    text: small,
    truncated: false,
  });

  const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join(
    "\n",
  );
  const big = await collect(streamOf(encode(lines)));
  assert.ok(big.truncated);
  assert.ok(big.text.startsWith("line 0\n"));
  assert.ok(big.text.endsWith("line 19999"));
  assert.ok(big.text.includes("bytes omitted"));
  assert.ok(encode(big.text).length < 24 * 1024 + 200);

  // 앞뒤 자르는 자리가 2 byte 문자 한가운데에 걸린다.
  const multi = "x" + "é".repeat(30_000);
  const cut = await collect(streamOf(encode(multi)));
  assert.ok(cut.truncated);
  assert.ok(!cut.text.includes("�"));
});

test("Windows에서 Git Bash를 못 찾으면 shell tool은 unavailable로 끝나고 아무것도 띄우지 않는다", async () => {
  const ctx = {
    scope: { base: "C:\\work", read: [] },
  } as unknown as ToolContext;
  const deps = {
    platform: "win32",
    env: { ProgramFiles: "C:\\Program Files" },
    exists: () => false,
    spawn: (() => {
      throw new Error("must not spawn");
    }) as never,
    onExit: () => () => {},
  };
  const result = await runShell({ command: "echo hi" }, ctx, deps);
  assert.ok(!result.ok);
  assert.equal(result.error.code, "unavailable");
  assert.match(result.error.message, /LOPHN_GIT_BASH/);
});
