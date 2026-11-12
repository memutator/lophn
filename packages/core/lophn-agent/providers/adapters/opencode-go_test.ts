import assert from "node:assert/strict";
import { test } from "node:test";
import { joinEndpoint } from "./compat.ts";
import {
  isOpenCodeGoDefinition,
  OPENCODE_GO_CLIENT,
  OPENCODE_GO_MODELS_URL,
  opencodeGoShape,
} from "./opencode-go.ts";

test("OpenCode Go shape은 정의의 wire로 경로를 고르고 session·User-Agent header를 싣는다", () => {
  const cases = [
    ["opencode-go-chat", "openai-chat-completions", "/chat/completions"],
    ["opencode-go-responses", "openai-responses", "/responses"],
    ["opencode-go-messages", "anthropic-messages", "/messages"],
  ] as const;
  for (const [definition, protocol, path] of cases) {
    const shape = opencodeGoShape(definition, protocol);
    assert.ok(shape, definition);
    const call = shape!({
      endpoint: "https://opencode.ai/inference/go/openai/v1",
      session: "ses_same",
      body: { model: "glm-5.3" },
    });
    assert.deepStrictEqual(
      call.url,
      joinEndpoint("https://opencode.ai/inference/go/openai/v1", path),
    );
    assert.equal(call.headers["user-agent"], OPENCODE_GO_CLIENT);
    assert.match(call.headers["x-opencode-session"]!, /^ses_[0-9a-f]{32}$/);
    assert.equal(
      call.headers["anthropic-version"] === undefined,
      definition !== "opencode-go-messages",
    );
    // gateway는 stream 요청만 받는다.
    assert.deepStrictEqual(JSON.parse(call.body), {
      model: "glm-5.3",
      stream: true,
    });
  }
});

test("같은 session은 같은 대화 값을, 다른 session은 다른 값을 쓰고 session이 없으면 하나로 모은다", () => {
  const shape = opencodeGoShape("opencode-go-chat", "openai-chat-completions")!;
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

test("다른 정의나 protocol에서는 shape을 만들지 않는다", () => {
  assert.equal(opencodeGoShape("anthropic", "anthropic-messages"), null);
  assert.equal(opencodeGoShape("opencode-go-chat", "openai-responses"), null);
  assert.equal(isOpenCodeGoDefinition("opencode-go-chat"), true);
  assert.equal(isOpenCodeGoDefinition("anthropic"), false);
  assert.equal(
    OPENCODE_GO_MODELS_URL,
    "https://opencode.ai/inference/go/openai/v1/models",
  );
});
