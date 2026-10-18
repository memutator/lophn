# mi-core

- 단위: mi-core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{models,model-picker,resolved-model,option-axes,mod}.ts` and their tests
  - `packages/core/lophn-agent/models/**`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/session/{compactor,commands}.ts`

## The task

Store person-entered model info for custom provider models in the catalog's own shape, merge it as the catalog `user` layer, and fix the 4096 output cap. Follow the plan README "정한 것" exactly. The roadmap `project-docs/products/roadmap/model-info.md` has the facts of today's code ("지금 코드").

Work, in this order:

1. Output cap. Replace `MAX_OUTPUT_TOKENS = 4096` in `packages/core/lophn-agent/models/resolve.ts` with one constant `OUTPUT_CAP = 32000`:
   - sent `max_tokens` for openai-responses and chat: `min(OUTPUT_CAP, output_limit)`;
   - Anthropic: `min(output_limit, OUTPUT_CAP + thinking budget)`;
   - the output share the input budget keeps: `run-loop/prepare.ts` (`deps.reservedOutput ?? 8000`) and `session/compactor.ts` (`RESERVED_OUTPUT = 4000`) both become `min(OUTPUT_CAP, output_limit)` from the same constant. Export it from one place; no copies.
   - `UNLISTED_LIMITS` keeps output 4096.
   - Fix comments and docs strings in your files that still say 4096 or 8000 for this.
2. `MODEL_MEDIA` (`resolved-model.ts`) gains `"pdf"`. Check the models.dev adapter (`models/adapters/models-dev.ts`) maps `pdf` through. Do not regenerate `models/snapshot.json`.
3. Protocol for user model info (in `models.ts`, exported via `mod.ts`):
   - A command to save one model's info: input `{ provider_definition, model_name, info }`, actor user, compare `{ seq }`.
   - A command to remove one: input `{ provider_definition, model_name }`, compare `{ seq }`.
   - A read returning `{ seq, items: [{ provider_definition, model_name, info }] }`.
   - Follow the existing hidden-models routes (`ChangeHiddenModels` / `ReadHiddenModels`, tables `model_hidden`, `model_hidden_seq`) for naming, seq handling and registration.
   - `info` mirrors `CatalogEntry` field names: `context_limit`, `input_limit`, `output_limit` (positive int or null), `supports_tools` (bool or null), `input_media`, `output_media` (MODEL_MEDIA lists that must include text), `effort` (`{ values: EffortName[] (min 1, weak to strong), default_value: EffortName | null } | null`), `price` (`{ input, output, cache_read, cache_write }` nullable USD-per-1M decimal strings, or null). Reuse the existing schemas/refinements (effort names, decimal strings, media list) instead of writing new ones.
   - Reject a `provider_definition` that is a built-in or OAuth definition (`invalid_input`).
4. Core storage (`models/schema.ts`, `store.ts`, `commands.ts`, `reads.ts`): a table keyed (provider_definition, model_name) with the info JSON, plus a seq table. Edit the schema step in place; no migration (dev data is wiped).
5. Merge as the `user` layer: build a `CatalogEntry` per item with `source: "user"`:
   - `options`: an effort axis from `effort` (fixed labels, `wire: null`, `budget: null`, `default_value`), or `[]` when `effort` is null;
   - `price_basis`: one rate from `price`, `currency: "USD"`, a `source`/`revision` that says it was entered by the person; null when every price is null;
   - `preview`, `deprecated` null.
   Every place that reads the catalog must see it:
   - `ReadModelCatalog`: user entries win over the same key;
   - the turn resolver's `catalog()` (`createModelResolver`);
   - the save-time checks: `checkChoice` (`models/commands.ts`) and the session model check (`register.ts:237`, `snapshotCatalogEntry`). A choice with an effort value for a user entry must save and resolve.
   Do not write user entries into `derived/lophn-agent/catalog.json`. If the catalog file still has a code path that reads `source: "user"` entries back (`models/work.ts`), remove it.
6. Null limits in a user entry: the resolver fills each null field from the unlisted defaults (context 131072, input = context, output 4096, tools true), field by field. A user entry with all limits set uses them as is.
7. `selectableModels` (`model-picker.ts`): for any definition, the result is the reported list (or, when it is null or empty, the definition's catalog entries, as today) plus every `source: "user"` entry of that definition not already in it. Keep the comment accurate.
8. Chat-completions effort (`models/wire.ts`): `maximum` maps to `"max"` for `openai-chat-completions` only. The Responses table stays without `maximum`.
9. Fix renderer compile only if your protocol changes break it (minimal lines; list them under "넘길 줄"). Do not build UI.

Risk tests (`.claude/skills/write-test`), a few, in-memory, no server:
- a saved user entry survives a catalog refresh and wins over a same-key catalog entry;
- a choice with an effort value on a user entry passes the save-time check and becomes `reasoning_effort` in a chat request body;
- remove/save with a stale `seq` does not write.

Checks: `deno task check:full`, two core boots, `deno run -A packages/shell/renderer/build.ts`.

Report the exact protocol names (commands, read, resource, input/output types) you added, so the shell task can use them.
