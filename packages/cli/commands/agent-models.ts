import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  type CatalogEntry,
  modelCatalogRead,
  optionAxesOf,
  providerRead,
  selectableModels,
  shownModelsRead,
} from "../../protocol/lophn-agent/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

export const agentModels = defineCommand({
  name: "agent.models",
  summary: "List the models the person enabled and their options",
  description:
    "List the models the person enabled in the model picker, with provider IDs and names, supported option axes and values, defaults, token limits, media and prices (USD per 1M tokens). " +
    "Read this before choosing a model for agent.create or agent.update. Use provider and model_name as returned, and set model.option_values to an object of option axis IDs and supported values (for example {effort: 'high'}); {} leaves options to the model defaults. " +
    "options: null means unknown; [] means no options. A model with unknown options accepts only {}. This reads saved information without contacting model providers or changing which models are enabled.",
  input: z.strictObject({}),
  effect: "read",
  routes: [shownModelsRead, providerRead, modelCatalogRead],
  workspaces: WORKSPACE_KINDS,
  run: async (_input, ctx) => {
    const shown = await ctx.core.read(shownModelsRead, {});
    if (!shown.ok) return shown;
    const models: Record<string, unknown>[] = [];
    const items = shown.value.shown.items;
    for (const id of new Set(items.map((item) => item.provider))) {
      const read = await ctx.core.read(providerRead, { provider: id });
      if (!read.ok) {
        // 목록을 읽은 뒤 연결을 끊은 provider는 picker에서도 빠진다.
        if (read.error.code === "not_found") continue;
        return read;
      }
      const provider = read.value.provider;
      const catalog: CatalogEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await ctx.core.read(modelCatalogRead, {
          provider_definition: provider.definition.key,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) return page;
        catalog.push(...page.value.entries);
        cursor = page.value.next_cursor ?? undefined;
      } while (cursor !== undefined);
      const enabled = new Set(
        items
          .filter((item) => item.provider === id)
          .map((item) => item.model_name),
      );
      for (const { model_name, entry } of selectableModels({
        definition: provider.definition.key,
        catalog,
        reported: provider.credential.reported_models,
      })) {
        if (!enabled.has(model_name)) continue;
        models.push({
          provider: id,
          provider_name: provider.name,
          model_name,
          options: entry?.options == null ? null : optionAxesOf(entry),
          context_limit: entry?.context_limit ?? null,
          input_limit: entry?.input_limit ?? null,
          output_limit: entry?.output_limit ?? null,
          supports_tools: entry?.supports_tools ?? null,
          input_media: entry?.input_media ?? null,
          output_media: entry?.output_media ?? null,
          price_basis: entry?.price_basis ?? null,
        });
      }
    }
    return ok({
      summary: `${models.length} enabled models`,
      content: { models },
      arrayKeys: ["models"],
    });
  },
});
