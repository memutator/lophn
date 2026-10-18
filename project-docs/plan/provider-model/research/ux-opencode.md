# opencode: provider and model UX (research for lophn redesign)

Date: 2026-10-18. Read-only research; nothing run that calls a model, logs in, or touches ~/.config/opencode or ~/.local/share/opencode.

## Versions and sources (read this first)

- Installed here: `opencode --version` = 1.18.35 (V1 line). Only `--help` was run.
- Upstream repo moved to `anomalyco/opencode` (was `sst/opencode`). Shallow clone at
  `/tmp/claude-1000/-home-pyosechang-projects-lophn/f3ec91a4-b3f3-468d-b135-0a94c9c54e2a/scratchpad/src/opencode`
  (HEAD 60a5a6ca7, 2026-10-18) is **OpenCode V2** (CHANGELOG.md top entry v2.0.32, 2026-10-16). V2 renamed concepts:
  providers + credentials are now **integrations** (`opencode auth login` = "connect an integration"), config key `provider` -> `providers`, `small_model` is gone (migrated into the `title` agent's `model`). V1 config is migrated on load (`packages/core/src/config/normalize.ts`).
- The live docs at https://opencode.ai/docs/providers/, /models/, /config/, /agents/ (fetched) and the in-repo docs `packages/web/src/content/docs/{providers,models,config,agents}.mdx` still describe the V1-style flow (`/connect` + `opencode.json` `provider` block). So the user-facing story below is V1/docs; V2 code adds auto-discovery and a desktop form.
- Key source files (all under the clone, `packages/`):
  - `tui/src/component/dialog-model.tsx` (model picker), `dialog-variant.tsx`, `dialog-integration.tsx` (connect), `tui/src/model-preference.ts`, `tui/src/context/local.tsx`
  - `app/src/providers/models/select-dialog.tsx`, `app/src/providers/credentials/{dialog.tsx,form.ts}` (desktop custom provider form), `app/src/settings/{providers,models}/`, `app/src/runtime/i18n/en.ts`
  - `core/src/plugin/provider/{local.ts,ollama.ts,lmstudio.ts,vllm.ts}` (model discovery), `schema/src/config.ts`, `schema/src/config/{provider,model,agent}.ts`
  - `cli/src/commands/commands.ts` (auth/models CLI spec)
- Issues: anomalyco/opencode #49091, #48935, #41318 (fetched via WebFetch).

## 1. Connecting providers

- TUI: `/connect` opens a searchable list of providers (models.dev + built-ins). Docs flow: "1. Run /connect ... 2. Authenticate. Most providers take an API key, and some offer a browser or device-code login. 3. Choose a model with /models." (opencode.ai/docs/providers).
- CLI: `opencode auth login [url]`, `auth list|ls`, `auth logout [provider]`; `opencode providers` is the alias group (installed 1.18.35 `--help`). V2 adds `auth export|import|switch`, `--method`, `--answer key=value` for scripted login (`cli/src/commands/commands.ts`). Target is "Integration ID, name, or well-known provider URL".
- Auth kinds: API key (default), OAuth/subscription per provider: OpenAI "ChatGPT Plus/Pro" (browser), Anthropic "Claude Pro/Max", GitHub Copilot device code, xAI "SuperGrok Subscription", GitLab Duo, Snowflake, DigitalOcean, Azure Entra. Some providers use env vars only (Bedrock; env-only shows as "Environment only" in the V2 list). Env keys are auto-detected: connected without any dialog.
- Storage: `~/.local/share/opencode/auth.json` ("Keys added through /connect are stored in ..."). Config (providers/models) lives separately in `opencode.json` (global `~/.config/opencode/opencode.json`, project `opencode.json`; merged by precedence). So **credential and provider definition are two stores**.
- V2 TUI list: `DialogIntegration` groups rows as "Popular" (opencode-go, opencode, openai, github-copilot, anthropic, google), "Services", "MCP"; row footer shows connection summary ("N connections") or "Sign in required ->". V2 supports several accounts per provider (switch/rename/remove; changelog #54101, "Settings -> Providers").
- V2 desktop: `Settings -> Providers` ("Connect and manage model providers"; sections "Connected providers" / "Popular providers"; tags Environment / Config / Custom / Account / Other). Command palette: "Connect provider".

## 2. Custom / OpenAI-compatible providers

- V1/docs flow (opencode.ai/docs/providers#custom-provider): `/connect` -> scroll to **Other** -> type a provider id -> type API key. The dialog then warns: "This only stores a credential for myprovider - you will need to configure it in opencode.json". Then the person hand-edits JSON:
  ```json
  { "provider": { "myprovider": {
      "npm": "@ai-sdk/openai-compatible", "name": "My AI Provider Display Name",
      "options": { "baseURL": "https://api.myprovider.com/v1" },
      "models": { "my-model-name": { "name": "My Model Display Name",
                  "limit": { "context": 200000, "output": 65536 } } } } } }
  ```
  `options.apiKey` optional (`{env:VAR}`), `options.headers` optional. `npm`: `@ai-sdk/openai-compatible` for `/v1/chat/completions`, `@ai-sdk/openai` for `/v1/responses`. Then `/models` shows it.
- **Models of a custom provider are declared by hand** (`models` map; keys must match the API's model id). The docs never mention fetching `/v1/models` for generic providers. `limit` matters: "Standard providers pull these from models.dev automatically", custom ones do not.
- Local servers (Ollama, LM Studio, llama.cpp) in docs: same config block, no `/connect` step needed, e.g. Ollama `baseURL http://localhost:11434/v1`, model `llama2`; tip: raise `num_ctx` to 16-32k if tool calls fail.
- **V2 code adds real discovery for local servers**: `core/src/plugin/provider/local.ts` `createLocalProviderPlugin` polls (every 30 s, 1 s timeout) the server and builds the provider's model list from the response: Ollama, LM Studio (`GET /api/v1/models`, filters `type == "llm"`, reads context length, vision, tool-use flags), vLLM (`GET /health`, `GET /v1/models`, `max_model_len`). Default origins are hard-coded (`http://127.0.0.1:1234`, `:8000`, ...) and overridable via the provider's `baseURL` setting. When models are found, the provider is force-activated ("activation = enabled") and its **integration row is removed** (no connect step: "integrations.remove(providerID)"). Comment in code: "Keep the last successful inventory through transient outages instead of flickering model availability." Capabilities default conservatively (tools false unless the server says so).
- **V2 desktop has a Custom provider form** (`app/src/providers/credentials/{dialog.tsx,form.ts}`, i18n `provider.custom.*`): entry "Custom OpenAI-compatible provider" at the top of the connect dialog (`CUSTOM_ID = "_custom"`). Fields: Provider ID (`^[a-z0-9][a-z0-9-_]*$`), Display name, Base URL (must be http/https), API key ("Optional. Leave empty if you manage auth via headers."; may be `{env:VAR}`), **Models rows: ID + Name with "Add model"** (at least one row, manual), Headers rows (optional). Result is written as the same `npm: "@ai-sdk/openai-compatible"` config block, key stored as credential. Error string "Custom providers are unavailable on this server" shows up in issues #50650/#51544.
- TUI still has no equivalent form. Open request #49091 (assigned, open): "Enter endpoint URL and check reachable -> optional API key -> fetch models from `/v1/models`, manual entry as fallback, choose which to enable -> save to global or project config". Duplicate #48935 closed by bot (template). Community plugin `opencode-models-discovery` v1.10.0 (cited in #49091) fills the gap but needs the provider pre-declared. #41318 (discover models for built-in providers whose models.dev entry lags, e.g. 95 listed vs 153 real) closed "not planned" by stale bot, no maintainer reply.

## 3. Choosing models

- `/models` (TUI) / "Choose model" command (desktop). List is the union of models from all **connected** providers (models.dev catalog filtered by connected ones + config-declared + discovered). V2 TUI `DialogModel`: fuzzy search; when connected and no query, sections **Favorites** (toggle), **Recent** (last 10, `model-preference.ts` `.slice(0, 10)`), then models grouped by provider name (opencode-go and opencode first, then alphabetical, Free first, newest release first); "Free" footer when all costs are 0; deprecated models hidden. Favorites/recents/variant memory stored in `<state dir>/model.json` (not in config), file-locked.
- **One flow for connect + pick in V2**: the model dialog has an action "connect integration" (or "view all integrations" when nothing is connected). It opens `DialogIntegration` with `onConnected(providerID)` that **replaces the dialog with `DialogModel providerID=<that provider>`**, i.e. after connecting you land on that provider's models, titled with the provider name. With nothing connected the model picker is effectively the onboarding screen.
- V2 desktop: model picker popover/dialog footer has two buttons, **"Manage models"** (opens Settings -> Models, "Choose which models appear in model picker", per-model on/off, enable all/disable all, grouped by provider) and **"Connect provider"** (opens connect dialog). Unpaid state shows "Free models provided by OpenCode" + "Add more models from popular providers" + "See 70+ more providers". So Settings -> Providers (credentials) and Settings -> Models (visibility only) are separate tabs, but both reachable from the picker.
- Per-session: the selection is stored per session and per agent (`local.tsx`: `selectionBySessionAgent`, "Inactive agents keep their remembered choices"). A saved session whose model is unavailable is kept, not silently replaced (changelog #53822, v2.0.27).

## 4. Model options (variants / reasoning effort)

- Variants = named option bundles on one model, no duplicate list entries. Built-ins (docs): Anthropic `high` (default), `max`; OpenAI `none|minimal|low|medium|high|xhigh` (varies by model); Google `low`, `high`. V2 derives variants from models.dev v2 `capabilities.reasoning` (`effort[]`, `budget`, `toggle`): "OpenCode builds the model's variants from it; no control means none" (`schema/src/config/provider.ts`).
- UI: after picking a model that has variants, the TUI **immediately replaces the dialog with `DialogVariant`** ("Select variant": Default + list) unless the current variant is valid for the new model. Keybind `variant_cycle` cycles in place (desktop: "Cycle thinking effort"). Choice persisted per model in `model.json` (`variant[providerID/modelID]`). The variant is not shown in the model list itself.
- Custom variants in config: `provider.<p>.models.<m>.variants.<name> = { reasoningEffort, textVerbosity }`, `{ "disabled": true }` removes one. Plain `options` per model for fixed settings; agent keys override.
- V2 config model reference syntax includes the variant: `"provider/model#variant"` (`schema/src/config/model.ts` Short pattern `^[^/#]+\/[^#]+(?:#[^#]+)?$`), also usable in agent `model` and top-level `model`.

## 5. Defaults

- Global default: config `model: "provider_id/model_id"` (V2: description "Default model to use when no session or agent model is selected"). Custom provider: provider key + model key from `models`. Set by editing config only; no settings UI to write it (the TUI picker just records "recent").
- Startup priority (docs/models): `--model/-m` flag, then config `model`, then last used (recent), then first model by internal priority. V2 code (`local.tsx` `newSessionModel`): per-location/agent remembered choice, then `agent.model`, then fallback (flag, config model, first valid recent, first model).
- Per agent: `agent.<name>.model` in JSON or markdown frontmatter. Primary agent without it uses the global model; **subagent without it inherits the invoking primary agent's model** (docs/agents). Extra keys on the agent (e.g. `reasoningEffort`, `textVerbosity`) pass through as model options. Agent model is config/markdown only.
- Small model: V1 `small_model` "for lightweight tasks like title generation"; if unset opencode tries a cheaper model of the same provider, else the main model. V2 removes the key and models it as the `title` agent's `model`.
- Admin filters: `enabled_providers` / `disabled_providers` (disabled wins; models hidden); per provider `blacklist` / `whitelist` of model ids (docs/providers "Hiding models").

## 6. Recent changes and confusion signals

- V2 (since ~v2.0.26-2.0.32, Oct 2026): "integration" vocabulary; multi-account providers (#54101); Vertex gcloud flow; `opencode auth login` headless fix (#56082); `/connect` from model picker lands on that provider's models; local-server auto-discovery plugins; desktop custom provider form; "Settings -> Models" visibility tab. Config schema accepts both V1 and V2 shapes during migration (#55524).
- Pain points in issues: hand-editing JSON "error-prone and hard to discover" (#49091); `/connect Other` only stores a credential and tells you to edit config (credential loop troubleshooting in docs: provider id in `/connect` must equal id in config); custom providers stop loading after update (#50650, #51544: "unavailable on this server"); agent `model` ignored for new sessions in v2.0.29 (#55727, open, reproduced); models.dev catalog lag with no way to discover (#41318). No prominent issue explicitly titled "provider vs model confusion", but the complaints above are the same split: credential, provider definition, model list, default model live in four places.
- Third-party corroboration (secondary): https://haimaker.ai/blog/opencode-custom-provider-setup/ (providers in opencode.jsonc, keys in separate auth file).

## What lophn could take

- **Make the model picker the entry point for connecting.** Put "Connect provider" as an action inside the picker (and as the empty-state when no provider is connected); after connect, return to the picker already filtered to that provider (opencode `DialogModel` + `onConnected(providerID)`). One flow instead of Settings -> Providers then Settings -> Agents.
- **A custom provider is a single form that includes its models.** opencode desktop form: Provider ID, Display name, Base URL, optional API key, Models rows (ID + Name, add/remove), optional Headers. This directly solves "custom provider has no models to pick": model list is part of the provider definition.
- **Auto-discover models from the endpoint** for OpenAI-compatible bases: opencode does it only for local servers (poll `GET /v1/models`, 1 s timeout, 30 s refresh, keep last good list on failure, conservative capabilities: tools unknown). Suggest: on saving the custom form, call `GET {baseURL}/models` once, prefill rows, keep manual rows as fallback (what #49091 asks for and opencode never shipped for generic providers). Let people add a typed model ID even when discovery fails.
- **Model reference = `provider/model#variant`** string everywhere (default model, agent definition Model field, conversation picker). Same parser for all three places; effort/variant is chosen right after model (second step only when the model has variants) and remembered per model.
- **Picker structure worth copying:** Favorites, Recent (cap 10), then grouped by provider; "Free" tag; hide deprecated; keep a session's unavailable model visible instead of silently replacing it. Keep recents/favorites in app state, not in provider config.
- **Resolution order stated in one place:** conversation choice > agent definition model > global default > last used > first available; subagent/agent without model inherits the caller's. Maps cleanly onto lophn's Default model, agent Model field, and conversation picker; show the resolved source in the UI ("from Agent X").
- Small/utility model as just another agent with a `model` field (opencode V2 migrated `small_model` that way) rather than a special setting.

## What not to copy

- The credential / config split (auth.json vs opencode.json) and the `/connect Other` dialog that stores a key and then tells the person to edit JSON. This is the main source of confusion.
- Settings -> Models as a separate tab that only toggles visibility; it adds a third place to look. Prefer visibility toggles inside the provider's detail page or the picker ("Manage models").
- Config-file-only defaults (global `model`, agent `model`, `small_model`) with no UI.
- Provider IDs that must match across two files, `npm` package names, `limit.context/output` hand entry for users; hide behind form defaults (`@ai-sdk/openai-compatible` equivalent) and infer limits from discovery when available.
- Silent hard-coded local default origins and background polling for every provider; only worth it if lophn targets Ollama/LM Studio explicitly.
