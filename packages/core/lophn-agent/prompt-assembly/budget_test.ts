import { assertEquals } from "@std/assert";
import { IMAGE_TOKENS, measureWire } from "./budget.ts";
import type { PromptRequest } from "./model.ts";

function requestWith(base64: string): PromptRequest {
  return {
    system: [],
    tools: [],
    messages: [{
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
    }],
  };
}

const wire = (base64: string | null) => ({
  body: { image: base64 ?? "[image omitted]" },
  opaque_bytes: 0,
});

Deno.test("이미지 하나가 있어도 예산은 base64 길이가 아니라 고정 값으로 는다", () => {
  const small = "A".repeat(1_000);
  const big = "A".repeat(10_000);
  const withSmall = measureWire(wire(small), requestWith(small));
  const withBig = measureWire(wire(big), requestWith(big));
  assertEquals(withSmall, withBig);

  // 이미지 입력을 못 받는 model은 body에 base64가 없어 고정 값을 더하지 않는다.
  const none = measureWire(wire(null), requestWith(big));
  assertEquals(none, JSON.stringify(wire(null).body).length);
  assertEquals(
    withSmall,
    none + IMAGE_TOKENS - "[image omitted]".length,
  );
});
