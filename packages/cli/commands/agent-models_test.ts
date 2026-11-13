import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import {
  modelCatalogRead,
  providerRead,
  shownModelsRead,
  userModelInfoRead,
} from "../../protocol/lophn-agent/mod.ts";
import { agentModels } from "./agent-models.ts";
import type { CommandContext } from "./types.ts";

test("agent.models는 켠 model의 선택 정보만 내고 provider 계정과 credential 정보는 내지 않는다", async () => {
  const axis = {
    id: "effort",
    label: "Effort",
    default_value: "high",
    budget: null,
    values: [{ value: "high", label: "High", wire: null }],
  };
  const entry = (name: string) => ({
    provider_definition: "example",
    model_name: name,
    context_limit: 131072,
    input_limit: 131072,
    output_limit: 4096,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    options: [axis],
    price_basis: null,
  });
  const result = await agentModels.run({}, {
    core: {
      read: async (route: { name: string }, input: { cursor?: string }) => {
        if (route.name === shownModelsRead.name)
          return ok({
            shown: {
              items: ["enabled", "unknown", "removed"].map((model_name) => ({
                provider: "provider-id",
                model_name,
              })),
            },
          });
        if (route.name === providerRead.name)
          return ok({
            provider: {
              name: "My provider",
              definition: { key: "example", client_secret: "SECRET_CANARY" },
              endpoint: "https://PRIVATE_CANARY.example",
              credential: {
                account: "ACCOUNT_CANARY",
                secret_name: "SECRET_CANARY",
                reported_models: ["enabled", "unknown", "disabled"],
              },
            },
          });
        if (route.name === modelCatalogRead.name)
          return ok({
            entries:
              input.cursor === undefined
                ? [entry("disabled")]
                : [entry("enabled"), entry("removed")],
            next_cursor: input.cursor === undefined ? "next" : null,
          });
        if (route.name === userModelInfoRead.name)
          return ok({ seq: "0", items: [] });
        throw new Error(`unexpected route: ${route.name}`);
      },
    },
  } as unknown as CommandContext);
  assert.ok(result.ok);
  assert.deepStrictEqual(result.value.content, {
    models: [
      {
        provider: "provider-id",
        provider_name: "My provider",
        model_name: "enabled",
        options: [
          {
            id: "effort",
            label: "Effort",
            default_value: "high",
            values: [{ value: "high", label: "High" }],
          },
        ],
        context_limit: 131072,
        input_limit: 131072,
        output_limit: 4096,
        supports_tools: true,
        input_media: ["text"],
        output_media: ["text"],
        price_basis: null,
      },
      {
        provider: "provider-id",
        provider_name: "My provider",
        model_name: "unknown",
        options: null,
        context_limit: null,
        input_limit: null,
        output_limit: null,
        supports_tools: null,
        input_media: null,
        output_media: null,
        price_basis: null,
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result.value), /CANARY/);
});
