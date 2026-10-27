import assert from "node:assert/strict";
import { test } from "node:test";
import type { HistoryMessage } from "../prompt-assembly/mod.ts";
import { omitOldImages } from "./history.ts";

// n번 tool 호출이 각각 이미지 하나를 낸 history다.
function historyWith(images: number): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  for (let i = 0; i < images; i++) {
    history.push(
      {
        role: "assistant",
        parts: [{ kind: "tool_use", id: `t${i}`, name: "read", input: {} }],
      },
      {
        role: "user",
        parts: [
          { kind: "tool_result", id: `t${i}`, text: `r${i}` },
          {
            kind: "tool_result_image",
            id: `t${i}`,
            media_type: "image/png",
            data_base64: `img${i}`,
          },
        ],
      },
    );
  }
  return history;
}

test("이미지가 2개를 넘으면 오래된 것부터 빠지고 짝 글에 표시가 붙는다", () => {
  for (const count of [0, 2, 3, 5]) {
    const input = historyWith(count);
    const before = structuredClone(input);
    const out = omitOldImages(input, 2);
    assert.deepStrictEqual(input, before);

    const omitted = Math.max(0, count - 2);
    const parts = out.flatMap((m) => m.parts);
    const images = parts.filter((p) => p.kind === "tool_result_image");
    assert.deepStrictEqual(
      images.map((p) => p.id),
      Array.from({ length: count - omitted }, (_, i) => `t${omitted + i}`),
    );
    for (let i = 0; i < count; i++) {
      assert.deepStrictEqual(
        parts.filter((p) => p.kind === "tool_use" && p.id === `t${i}`).length,
        1,
      );
      assert.deepStrictEqual(
        parts.filter((p) =>
          p.kind === "tool_result" && p.id === `t${i}` &&
          p.text === (i < omitted ? `r${i}\n[image omitted]` : `r${i}`)
        ).length,
        1,
      );
    }
  }
});
