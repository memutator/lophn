import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BYTES_PER_TOKEN,
  IMAGE_TOKENS,
  measureSize,
  measureWire,
  wireSize,
} from "./budget.ts";
import type { PromptRequest } from "./model.ts";

function requestWith(base64: string): PromptRequest {
  return {
    system: [],
    tools: [],
    messages: [
      {
        role: "user",
        parts: [
          { kind: "tool_result", id: "t1", text: "{}" },
          {
            kind: "tool_result_image",
            id: "t1",
            media_type: "image/png",
            data_base64: base64,
          },
        ],
      },
    ],
  };
}

const wire = (base64: string | null) => ({
  body: { image: base64 ?? "[image omitted]" },
  opaque_bytes: 0,
});

test("이미지 하나가 있어도 예산은 base64 길이가 아니라 고정 값으로 는다", () => {
  const small = "A".repeat(1_000);
  const big = "A".repeat(10_000);
  const withSmall = measureWire(wire(small), requestWith(small));
  const withBig = measureWire(wire(big), requestWith(big));
  assert.deepStrictEqual(withSmall, withBig);

  // 이미지 입력을 못 받는 model은 body에 base64가 없어 고정 값을 더하지 않는다.
  const none = measureWire(wire(null), requestWith(big));
  const noneBytes = JSON.stringify(wire(null).body).length;
  assert.deepStrictEqual(none, Math.ceil(noneBytes / BYTES_PER_TOKEN));
  const imageBytes = JSON.stringify(wire("").body).length;
  assert.deepStrictEqual(
    withSmall,
    Math.ceil(imageBytes / BYTES_PER_TOKEN) + IMAGE_TOKENS,
  );
});

test("같은 turn 앞 call의 실제 token이 있으면 늘어난 byte만 token으로 더하고 줄어든 byte는 3분의 1만 뺀다", () => {
  const anchor = { tokens: 50_000, bytes: 300_000, images: 1 };
  // 앞 call 뒤로 tool 결과 9,000 byte가 늘었다.
  assert.deepStrictEqual(
    measureSize({ bytes: 309_000, images: 1 }, anchor),
    59_000,
  );
  // 오래된 이미지 하나가 빠지고 표시 글이 붙었다.
  assert.deepStrictEqual(
    measureSize({ bytes: 300_015, images: 0 }, anchor),
    50_000 + 15 - IMAGE_TOKENS,
  );
  // 오래된 결과를 줄여 30,000 byte가 빠졌다. 실제로 줄어든 token보다 적게 뺀다.
  assert.deepStrictEqual(
    measureSize({ bytes: 270_000, images: 1 }, anchor),
    40_000,
  );
  // 앞 call이 없으면 크기로만 센다.
  assert.deepStrictEqual(
    measureSize({ bytes: 300_000, images: 1 }, null),
    100_000 + IMAGE_TOKENS,
  );
  assert.deepStrictEqual(wireSize(wire("QUJD"), requestWith("QUJD")), {
    bytes: JSON.stringify(wire("").body).length,
    images: 1,
  });
});
