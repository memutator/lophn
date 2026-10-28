// 진짜 provider에 요청 셋을 보내 응답을 단정하는 공용 suite. 제품의 resolver·번역·parser를 그대로 쓰고
// 대답의 내용은 보지 않는다. key는 env에서 읽어 전송 직전에만 붙인다(찍지도 저장하지도 않는다).

import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { err, ok } from "../../packages/base/mod.ts";
import {
  providerRead,
  type ProviderRecord,
  toWireToolName,
  userModelInfoRead,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { routePath } from "../../packages/protocol/base/mod.ts";
import { placeToolNames } from "../../packages/core/agent-places/tool-lists.ts";
import { FILE_HOOKS } from "../../packages/core/agent-places/hooks.ts";
import { agentTools } from "../../packages/core/main/agent-tools.ts";
import { snapshotCatalogEntry } from "../../packages/core/lophn-agent/models/mod.ts";
import { createModelResolver } from "../../packages/core/lophn-agent/models/resolve.ts";
import {
  inputJsonSchema,
  selectTools,
} from "../../packages/core/lophn-agent/tools/mod.ts";
import { builtinProviderDefinition } from "../../packages/core/lophn-agent/providers/definitions.ts";
import type { SecretAttachLike } from "../../packages/core/lophn-agent/providers/mod.ts";
import type { ModelCallOutput } from "../../packages/core/lophn-agent/providers/work.ts";
import type {
  PromptMessage,
  PromptTool,
} from "../../packages/core/lophn-agent/prompt-assembly/mod.ts";
import { CALL_TIMEOUT_MS, createBudget, FIXTURE_ROOT } from "./budget.ts";

export type LiveProvider = {
  provider: string;
  protocol: "anthropic-messages" | "openai-responses";
  // API base다. adapter가 path를 붙인다.
  endpoint: string;
  model: string;
  keyEnv: string;
  // 있으면 reasoning이 한도 안에 드는지 보는 잘림 행을 더한다.
  truncationModel?: string;
};

type Row = "text" | "tool" | "image" | "truncation";

const PROVIDER_ID = "pvd_00000000000000000000000000";
// 1x1 PNG.
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// 실제 project place의 tool 묶음이다. model에 보이는 칸만 싣는다.
const TOOLS: PromptTool[] = selectTools(
  placeToolNames("project"),
  { input_media: ["text", "image"] },
  agentTools({ file: FILE_HOOKS }),
).map((tool) => ({
  name: toWireToolName(tool.name),
  description: tool.description,
  input_schema: inputJsonSchema(tool),
}));

const text = (value: string): PromptMessage["parts"][number] => ({
  kind: "text",
  text: value,
});

const MESSAGES: Record<Row, PromptMessage[]> = {
  text: [{ role: "user", parts: [text("Say hello in one short sentence.")] }],
  tool: [{ role: "user", parts: [text("file.read로 README.md를 읽어 줘")] }],
  // 제품은 이미지를 tool 결과(image.read)로만 싣는다.
  image: [
    { role: "user", parts: [text("이 이미지를 설명해 줘")] },
    {
      role: "assistant",
      parts: [
        {
          kind: "tool_use",
          id: "call_image",
          name: "image_read",
          input: { path: "pixel.png" },
        },
      ],
    },
    {
      role: "user",
      parts: [
        { kind: "tool_result", id: "call_image", text: "pixel.png" },
        {
          kind: "tool_result_image",
          id: "call_image",
          media_type: "image/png",
          data_base64: PIXEL_PNG,
        },
      ],
    },
  ],
  truncation: [
    {
      role: "user",
      parts: [
        text(
          "Think carefully, then explain step by step: in how many ways can 12 people sit around a round table if A and B must not sit next to each other?",
        ),
      ],
    },
  ],
};

export async function callLive(
  config: LiveProvider,
  row: Row,
  deps: { fetch: typeof fetch; key: string },
): Promise<ModelCallOutput> {
  const model = row === "truncation" ? config.truncationModel : config.model;
  const definition = builtinProviderDefinition(config.provider);
  const entry =
    model === undefined
      ? undefined
      : snapshotCatalogEntry(config.provider, model);
  if (!definition.ok || model === undefined || entry === undefined) {
    throw new Error(`no snapshot entry for ${config.provider}/${model}`);
  }
  const provider: ProviderRecord = {
    id: PROVIDER_ID,
    name: config.provider,
    definition: definition.value,
    endpoint: config.endpoint,
    protocol: config.protocol,
    credential: {
      kind: "api_key",
      secret_ref: { name: "live-key" },
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
      reported_models: null,
    },
    revision: 1,
  };
  const attach: SecretAttachLike = {
    send: (_input, transmit) => transmit(deps.key),
  };
  const resolve = createModelResolver({
    machine: (path) =>
      Promise.resolve(
        path === routePath(providerRead)
          ? ok({ provider, as_of_seq: "0", next_cursor: null })
          : path === routePath(userModelInfoRead)
            ? ok({ seq: "0", items: [], as_of_seq: "0", next_cursor: null })
            : err({ code: "not_found", message: path }),
      ),
    attach,
    catalog: () => Promise.resolve(ok([entry])),
    fetch: deps.fetch,
  });
  const bound = await resolve({
    model: { provider: PROVIDER_ID, model_name: model, option_values: {} },
  });
  if (!bound.ok) throw new Error(`resolve failed: ${bound.error.message}`);
  const binding = bound.value;
  const packed = binding.pack({
    system: [{ layer: "role", text: "You are a test agent." }],
    tools: TOOLS,
    messages: MESSAGES[row],
  });
  const called = await binding.invoke(
    {
      callId: "mcl_live",
      turn: null,
      session: null,
      purpose: "judgment",
      model: binding.call,
      endpoint: binding.endpoint,
      inputHash: "h",
      contextBasisHash: "h",
      body: packed.body as Record<string, unknown>,
      usageRevision: binding.usageRevision,
    },
    AbortSignal.timeout(CALL_TIMEOUT_MS),
  );
  if (!called.ok) throw new Error(`invoke failed: ${called.error.message}`);
  return called.value;
}

// 단정 넷. 대답의 내용은 보지 않는다.
export function assertLive(row: Row, output: ModelCallOutput): void {
  const { outcome } = output;
  const shown = JSON.stringify(outcome);
  assert.ok(
    outcome.http_status !== null &&
      outcome.http_status >= 200 &&
      outcome.http_status < 300,
    `HTTP not 2xx: ${shown}`,
  );
  // partial은 한도에서 잘렸다는 뜻이다.
  assert.deepStrictEqual(outcome.kind, "complete", `outcome ${shown}`);
  if (row === "tool") {
    const call = output.toolCalls[0];
    assert.ok(call !== undefined, "no tool call");
    assert.ok(
      TOOLS.some((tool) => tool.name === call.name),
      `tool name not in the bundle: ${call.name}`,
    );
    const args = JSON.parse(call.args);
    assert.ok(
      typeof args === "object" && args !== null && !Array.isArray(args),
      "tool args are not a JSON object",
    );
  }
  assert.ok(
    typeof output.usage?.input === "number" &&
      typeof output.usage?.output === "number",
    `usage lacks token counts: ${JSON.stringify(output.usage)}`,
  );
}

export function liveSuite(config: LiveProvider): void {
  const budget = createBudget({
    record: process.env["LOPHN_LIVE_RECORD"] === "1" ? FIXTURE_ROOT : null,
  });
  const rows: Row[] = ["text", "tool", "image"];
  if (config.truncationModel !== undefined) rows.push("truncation");
  for (const row of rows) {
    test(`live ${config.provider} ${row}`, async () => {
      const key = process.env[config.keyEnv] ?? "";
      assert.ok(key !== "", `${config.keyEnv} is not set`);
      assertLive(
        row,
        await callLive(config, row, {
          fetch: budget.fetchFor(config.provider, row, key),
          key,
        }),
      );
    });
  }
}
