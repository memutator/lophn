import assert from "node:assert/strict";
import { test } from "node:test";
import { readLines } from "./supervisor.ts";

test("pipe 조각 사이에 갈린 UTF-8과 큰 JSON 한 줄을 보존한다", async () => {
  const expected = [
    JSON.stringify({ text: "한글🙂" }),
    JSON.stringify({ text: "x".repeat(1024 * 1024) }),
    "done",
  ];
  const encoded = new TextEncoder().encode(expected.join("\n") + "\n");
  async function* pieces() {
    for (let i = 0; i < 24; i++) yield encoded.subarray(i, i + 1);
    for (let i = 24; i < encoded.length; i += 8192)
      yield encoded.subarray(i, i + 8192);
  }
  const lines: string[] = [];
  await readLines(pieces(), (line) => lines.push(line));
  assert.deepStrictEqual(lines, expected);
});
