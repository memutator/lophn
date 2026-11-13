import assert from "node:assert/strict";
import { test } from "node:test";
import { opencodeGoShape } from "./opencode-go.ts";

test("같은 session은 같은 대화 값을, 다른 session은 다른 값을 쓰고 session이 없으면 하나로 모은다", () => {
  const shape = opencodeGoShape("opencode-go", "openai-chat-completions")!;
  const at = (session: string | null) =>
    shape({
      endpoint: "https://opencode.ai/inference/go/openai/v1",
      session,
      body: {},
    }).headers["x-opencode-session"];
  assert.equal(at("ses_a"), at("ses_a"));
  assert.notEqual(at("ses_a"), at("ses_b"));
  assert.equal(at(null), at(null));
});
