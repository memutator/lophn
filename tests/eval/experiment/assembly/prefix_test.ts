// - contract: eval roadmap "experiment". prefixBoundaries는 제품 assembleTurnPrompt의 cache_boundaries와 같은 hash를 낸다.
// - 현실적 회귀: 제품의 hash 식이나 층 순서가 바뀌었는데 이 쪽 숫자가 조용히 틀어진다.
// - 왜 지금 test로 못 잡나: 제품 test는 hash 값을 보지만 이 재계산과 맞는지는 아무도 안 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anthropicSystem,
  anthropicTools,
  assembleTurnPrompt,
  type PromptRequest,
} from "../../../../packages/core/lophn-agent/prompt-assembly/mod.ts";
import { prefixBoundaries } from "./prefix.ts";

test("prefixBoundaries가 제품 assembleTurnPrompt의 cache_boundaries와 같은 hash를 낸다", async () => {
  let body: unknown = null;
  const result = await assembleTurnPrompt(
    {
      role_prompt: "You are the operator.",
      tools: [
        {
          name: "skill.read",
          description: "read a skill",
          input_schema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
        {
          name: "app.create",
          description: "create an app",
          input_schema: { type: "object" },
        },
      ],
      instructions: {
        global: "be brief",
        project: "",
        domain: "",
        agent: "no emoji",
      },
      skills: [{ name: "calendar", description: "plan days", enabled: true }],
      place: {
        text: "# Place\nproject p1",
        kinds: null,
        agents: [],
      },
      history: [{ role: "user", parts: [{ kind: "text", text: "hi" }] }],
      limits: {
        context_limit: 100000,
        input_limit: 100000,
        output_limit: 4000,
      },
      reserved_output: 1000,
    },
    {
      pack: (request: PromptRequest) => {
        body = {
          model: "m",
          max_tokens: 1000,
          system: anthropicSystem(request),
          messages: [],
          tools: anthropicTools(request),
        };
        return { body, opaque_bytes: 0 };
      },
    },
  );
  assert.ok(result.status === "ready");
  const ours = await prefixBoundaries(body);
  assert.deepStrictEqual(
    ours.map((b) => [b.layer, b.prefix_hash]),
    result.cache_boundaries.map((b) => [b.after, b.prefix_hash]),
  );
  assert.deepStrictEqual(ours.length, 3);
});
