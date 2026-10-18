# mi-connect

- 단위: mi-connect (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/providers/**`
  - `packages/shell/renderer/conversation/model-picker/**`
  - `packages/shell/renderer/workspace/agents/**`
  - `packages/design/wording/catalog/{settings,conversation}.ts` and their regenerated `*.placeholders.ts` (run `deno task wording`; never hand-edit placeholders)
  - `tools/wireframes/**`

## The task

Make connecting a custom provider end with usable models, and let the person pick the custom provider's API. Follow the plan README "정한 것" (the `mi-connect` lines) exactly. Follow `.claude/skills/ui-design/SKILL.md` and `.claude/skills/wording/SKILL.md`.

Today (read the code first):
- The custom form (`desktop/settings/providers/connect-dialog.tsx`, `CustomProviderBody`) takes Provider ID, Display name, Base URL; https URLs then get the key in a protected window. `registerCustom` (`desktop/settings/providers/core-source.ts`) hard-codes `protocols: ["openai-chat-completions"]` and `protocol: "openai-chat-completions"`.
- After connecting, `ConnectProviderHost` (`connect-host.tsx`) finds the new provider and, when there is no global default model, opens the default-model dialog. From Manage models, "+ Connect provider" comes back with that provider's group on top.
- Core already supports `openai-responses` and `anthropic-messages` for built-in providers: request paths in `packages/core/lophn-agent/providers/invoke.ts` (`/responses`, `/messages` appended to the endpoint), and the resolver sends `x-api-key` for Anthropic Messages and Bearer for the OpenAI protocols (`packages/core/lophn-agent/models/resolve.ts`). Core needs no change for a custom provider to use them; if you find otherwise, stop and report instead of editing core.

Work:

1. API select in the custom form: a Select "API" with Chat Completions (default), Responses, Anthropic Messages. `registerCustom` uses the chosen protocol for both `definition.protocols` and `protocol`. Help text under Base URL: the address goes right before `/chat/completions`, `/responses` or `/messages` (e.g. `https://api.example.com/v1`). Keep the existing URL and key rules.
2. After a custom provider connects (both entry points: Settings → Providers and Manage models' "+ Connect provider"), read its model list once through the existing refresh (`refreshModels` / `RefreshProviderModels`) and then:
   - models found: the window the person lands in shows one line "Found N models on <provider>." (Manage models, or the default-model dialog);
   - no list (read failed or empty): open Manage models with that provider's group on top and its model info form (Add model) already open, with one line saying the provider did not list models, so the person adds them by name. This comes before the default-model dialog; after the person saves a model and closes, continue to the default-model dialog as today if there is still no global default.
   Keep built-in providers' flow unchanged.
3. Fakes (`desktop/settings/providers/testdata/fake-providers.ts`, `workspace/agents/fake-source.ts`) so both outcomes can be shown.
4. Gallery (`tools/wireframes`): update the custom provider form page to show the API select and URL help; add `new-model-info-connect-found` (landing after a custom provider whose list was read) and `new-model-info-connect-empty` (landing in the Add model form after a provider with no list). Register them like the other `new-model-info-*` pages.
5. Remove now-unused code, CSS and wording keys.

No new tests unless something risky appears (`.claude/skills/write-test`).

Checks: `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`, `deno task wording --check`, `deno task wireframes`, two core boots. Report the page ids.
