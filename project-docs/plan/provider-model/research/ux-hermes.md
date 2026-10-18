# Hermes Agent: provider and model UX (research for lophn redesign)

Project: **Hermes Agent**, `github.com/NousResearch/hermes-agent` (Nous Research, Python CLI/TUI + Electron "Desktop" app + web dashboard + messaging gateway). lophn harness id `hermes` runs executable `hermes` (packages/protocol/coding-agent/harness-adapter.ts:107-117). `hermes` is installed here at `/home/pyosechang/.local/bin/hermes`; I did not run it and did not read `~/.hermes`.

Sources read (clone, read-only): `/tmp/claude-1000/-home-pyosechang-projects-lophn/f3ec91a4-b3f3-468d-b135-0a94c9c54e2a/scratchpad/src/hermes` at commit `bb834a2cb329b27d67958036039d3e4fe9749a54` (2026-10-18, main; latest release v0.22.2, 2026-10-15). Paths below are relative to that clone. Docs are also published at hermes-agent.nousresearch.com/docs (source `website/docs/...`).

Key docs: `website/docs/user-guide/configuring-models.md`, `website/docs/integrations/providers.md`, `website/docs/reference/cli-commands.md`, `website/docs/user-guide/configuration.md`, `website/docs/user-guide/desktop.md`, `website/docs/reference/model-catalog.md`, `website/docs/user-guide/features/{fallback-providers,credential-pools}.md`.
Key code: `hermes_cli/main.py` (`select_provider_and_model` L2002, `_pick_provider` L1976), `hermes_cli/main_provider_setup.py` (`_build_provider_picker_rows` ~L905), `hermes_cli/model_setup_flows_custom.py` (`_model_flow_custom` L96), `hermes_cli/config_providers.py`, `apps/desktop/src/app/settings/{providers-settings,custom-endpoints-settings,model-settings}.tsx`, `apps/desktop/src/store/custom-models.ts`, `apps/desktop/src/i18n/en.ts`.
Release notes: `gh release view v0.22.0 -R NousResearch/hermes-agent`.

## Short answer

Hermes keeps **provider (connection)** and **model (choice)** as two separate concepts in storage and in the Desktop settings tree, but glues them together in three places so the person rarely feels the split:

1. In the terminal, `hermes model` is ONE flow: pick provider -> authenticate (OAuth or paste key or enter URL) -> pick model -> (optional) reasoning effort. It writes the default.
2. The model picker everywhere (composer, `/model`, Settings) is a two-column "provider | models" list that **only shows connected providers**, with an "Add provider" row inside it.
3. A custom endpoint is a first-class "provider" with its own models: models are **discovered from `/v1/models`** and can also be **typed** (`Add custom model...`) or **declared** in config.

So the split Providers vs Model is the same as lophn's today (Desktop has Settings -> Providers and Settings -> Model), but custom endpoints are not second-class: they carry their own model list.

## 1. Connecting providers

Commands (`website/docs/reference/cli-commands.md`):
- `hermes setup [model|tts|terminal|gateway|tools|agent] [--portal]`: first-run wizard. Its model step calls the same `select_provider_and_model()` as `hermes model` (docstring in `hermes_cli/main.py:2002`). `hermes setup --portal` = Nous Portal OAuth + set provider + tool gateway in one command.
- `hermes model`: "Interactive provider + model selector. This is the command for adding new providers, setting up API keys, and running OAuth flows."
- `hermes auth add|list|remove|reset|priority|refresh|status|logout`: credential pool management, e.g. `hermes auth add openrouter --api-key sk-or-v1-xxx`, `hermes auth add openrouter --type oauth` (browser PKCE mints a key), `hermes auth add openai-codex --browser`. `hermes login` is removed ("Use `hermes auth`...").
- Inside a session, `/model` can only **switch among already-configured** providers. Quote: "`/model` ... cannot add new providers, run OAuth, or prompt for API keys... To add a new provider: Exit your session, run `hermes model`". The docs repeat this warning in 3 places, i.e. a known confusion point.

Credential kinds:
- API key providers (OpenRouter, Anthropic, DeepSeek, Gemini, z.ai, Kimi, MiniMax, xAI, HF, NVIDIA, ~40 listed in `integrations/providers.md` table): env var like `OPENROUTER_API_KEY` in `~/.hermes/.env`, or entered by `hermes model`.
- OAuth / subscription: Nous Portal (recommended, "300+ models under one subscription"), ChatGPT/Codex (device code by default, `--browser` PKCE on localhost:1455), Anthropic (Claude Max + extra-usage credits only; Pro not supported), GitHub Copilot (device code), xAI SuperGrok, Qwen, MiniMax. The docs have a "Subscription plans: what your plan pays for" table because plan-vs-API billing is "the single most common source of billing surprises".
- Borrowed logins: can import `~/.codex/auth.json`, Claude Code credential store; `auth.adopt_external_logins: false` disables.
- Cloud-account providers: Bedrock (AWS chain), Vertex (service account/ADC), Azure Foundry (endpoint+key) via `hermes model`.

Storage (`user-guide/configuration.md`, "Directory Structure"):
```
~/.hermes/config.yaml   # settings incl. model, providers, auxiliary (no secrets)
~/.hermes/.env          # API keys / secrets
~/.hermes/auth.json     # OAuth credentials
```
Rule: "Secrets go in `.env`. Everything else in `config.yaml`." `hermes config set OPENROUTER_API_KEY ...` auto-routes UPPER_SNAKE to `.env`. Custom endpoint key: wizard saves `.env` var named from host:port and config references `api_key: ${VAR}` (model_setup_flows_custom.py, "The key goes to .env and config.yaml only references it"). Provider entries also accept `key_env`, inline `api_key`, or `key_cmd` (command that prints a short-lived token).

Desktop (`user-guide/desktop.md` L245-250, `apps/desktop/src/i18n/en.ts` L745-755): Settings -> **Providers** has sub-pages **Accounts** (OAuth), **API keys**, **Custom Endpoints**, **Local Models**. Separate Settings -> **Model** has sub-pages **Main model**, **Auxiliary models**, **Mixture of Agents**, **Fallback models**. First-run onboarding: guided setup chat on a free trial model (`nous/welcome`) so no key is needed; "Choose provider later" skip exists (v0.22.0).

## 2. Custom endpoints (OpenAI-compatible)

CLI: `hermes model` -> "Custom endpoint (enter URL manually)". Prompts in order (hermes_cli/model_setup_flows_custom.py):
1. `API base URL [e.g. https://api.example.com/v1]`
2. `API key [optional]` (masked)
3. For local-looking URLs without `/v1`: "Hint: Did you mean to add /v1 at the end?"
4. **Probe** `/models` of the endpoint.
5. API mode: auto-detect / chat_completions / responses / anthropic_messages.
6. **Model**: if probe found 1 model "Detected model: X. Use this model? [Y/n]"; if several, numbered list "Select model [1-N] or type name"; if none, type "Model name (e.g. gpt-4, llama-3-70b)". So models are discovered AND freely typeable.
7. `Context length in tokens [leave blank for auto-detect]`, `Display name`.
Result saved twice: default (`model.provider: custom`, `base_url`, `api_key: ${...}`) and as a named entry so it appears in the provider menu next time ("Auto-save to custom_providers so it appears in the menu next time").

Config shape (`integrations/providers.md` "Named Custom Providers"):
```yaml
model:
  default: qwen2.5-coder:32b
  provider: custom
  base_url: http://localhost:11434/v1
  context_length: 64000
providers:
  local:   { api: http://localhost:8080/v1 }          # key omitted for local
  work:    { api: https://gpu.internal/v1, key_env: CORP_API_KEY, transport: chat_completions }
  my-gateway:
    api: https://llm.internal.example.com/v1
    discover_models: false          # skip /models, use only the list below
    models: [my-finetune-v2, my-finetune-v1]   # or dict with per-model context_length, supports_vision, ...
```
Per-entry fields: `api`/`base_url`, `name`, `key_env|api_key|key_cmd`, `transport`, `default_model`, `models`, `context_length`, `discover_models`, `extra_body`, `extra_headers`, `session_affinity_header`, `ssl_*`, `catalog_provider`, `enabled: false`. Legacy `custom_providers:` list auto-migrated to `providers:` dict (config v12).

How models become selectable (the part lophn lacks):
- Live `/v1/models` probe (8s in the wizard; Ollama native `/api/tags` when detected); result is **persisted into the entry** "so no-probe surfaces (dashboard, desktop, ACP) show the full list" (`_discover_named_custom_models`, comment in model_setup_flows_custom.py).
- `discover_models: false` + explicit `models:` list for gateways with slow/noisy listings.
- Typed free-form: Desktop picker has "Add custom model..." with placeholder "Type a model id, e.g. openai/gpt-5". Comment in `apps/desktop/src/store/custom-models.ts`: "The catalog is a hint list; a slug the row lacks is still a real model to the backend... remembering it makes it a normal row on every picker instead of something to retype."
- Desktop Settings -> Providers -> Custom Endpoints form fields (en.ts `customEndpoints`): Name, Provider ID, Endpoint URL, Default Model, Context, API Key, API Mode, "Use for new chats", "Discover models", buttons **Test** / **Save**. **Test** sends a one-token request to the real route and reports "Endpoint is reachable. Found N models."; after Test the Default Model becomes a dropdown of discovered models (custom-endpoints-settings.tsx L227-250, L341 `allModelOptions = discovered + typed`). Empty state: "Add an OpenAI-compatible endpoint below."
- Metadata for unknown models: context length resolution chain (config pin -> per-model -> cache -> endpoint `/models` -> OpenRouter -> models.dev -> 128K default). `catalog_provider: deepseek` lets a gateway inherit a known vendor's model metadata. `model.supports_vision: true` for models absent from models.dev. So models.dev is used only as **metadata** (context, vision, reasoning), not as the gate for what can be selected.
- Local servers: Ollama/vLLM/SGLang/llama.cpp/LM Studio are all "custom endpoint with a URL" (docs have a per-server recipe, e.g. Ollama `http://localhost:11434/v1`, no key, with a large caution box about Ollama's 4k default context). LM Studio additionally has its own provider (`lmstudio`, optional `LM_API_KEY`). Since v0.22.0, built-in **Local Models** (Settings -> Providers -> Local Models; `hermes model` -> Local models): Hermes installs llama.cpp, shows catalog rated against the machine ("Fits your GPU"), downloads, starts server, "Use".
- Remote vs local is not a separate concept; only URL + optional key.

## 3. Choosing models

Where the person picks:
- **Terminal default**: `hermes model` (provider then model, one flow; provider rows are grouped, e.g. "Anthropic ▸", with an active row marked "← currently active"; trailing rows: "Custom endpoint (enter URL manually)", "Remove a saved custom provider", "Reasoning effort for the current model...", "Configure auxiliary models...", "Leave unchanged"). Saved custom providers appear as flat rows `Name (host) — saved-model`. `main_provider_setup.py::_build_provider_picker_rows`.
- **In session**: `/model gpt-5.4 --provider openrouter`, `/model zai:glm-5`, `/model custom:local:qwen-2.5`, `/model custom` (auto-detect via `/models` if exactly one loaded). Session-only by default; `--global` persists (or `model.persist_switch_by_default: true`); `--once` = one turn then restore. `/model X --reasoning high`.
- **Desktop composer**: model picker left of mic; hover a row for thinking/effort/fast; separate reasoning pill. Doc quote (desktop.md L106): "The composer picker is sticky UI state and never touches your default" (remembered per device, scoped to current chat), "Set the default in Settings -> Model. That 'main' model is your per-profile global default - it's what new chats, crons, subagents, and auxiliary tasks start from, and it's the only place that writes it." Exception: on a fresh profile with no default, the first pick is persisted.
- **Dashboard** Models page: left column = authenticated providers, right = curated model list; **Switch** applies to new sessions only; open chats keep their model, use `/model`.

Model list construction:
- Picker lists only **authenticated** providers (API key set, OAuth'd, or custom endpoint defined). Quote (configuring-models.md): "If a provider is missing, head to Keys and add its credential." Picker has "Add provider" row (en.ts `modelPicker.addProvider`) and empty text "No authenticated providers."
- Per provider: a **curated** list (agentic models), "not the raw `/models` dump (which on OpenRouter includes 400+ models including TTS, image generators, rerankers)". OpenRouter and Nous curated lists come from a remote manifest `https://hermes-agent.nousresearch.com/docs/api/model-catalog.json` with in-repo snapshot fallback, 20-minute TTL (`reference/model-catalog.md`). One entry per provider can be `default: true` = "silent default". Other providers use live catalog cache `~/.hermes/provider_models_cache.json`; picker never blocks on probes, background refresh, explicit "Refresh models" / `/model --refresh`.
- Desktop: "Edit models" shortlist (show/hide per provider, "Reset to defaults"), Favorites (star), per-device custom models.
- `model_catalog.excluded_providers: [...]` hides providers.
- Choosing model and choosing provider: one flow in CLI and in picker (provider column + model column; switching provider switches the model list). But *connecting* a provider is a different place from in-session `/model`.

## 4. Model options and auxiliary / per-task models

- Reasoning effort: `agent.reasoning_effort` (none, minimal, low, medium, high, xhigh, max, ultra; empty = medium). After picking a model in `hermes model`, a **reasoning-effort step** follows (skipped when the catalog says the model has no reasoning control); separate menu row "Reasoning effort for the current model...". Desktop: pill next to model picker, hidden for non-reasoning models; per-model remembered effort/fast presets (desktop-local). Custom endpoints: effort passed as-is to chat_completions/responses; `extra_body` for provider-specific fields (e.g. `chat_template_kwargs.enable_thinking`). Gateway aliases like `gpt-5.6-sol-high` discovered from `/v1/models` pin effort via `agent.reasoning_overrides`.
- Other per-model knobs: service tier `agent.service_tier` normal/fast/ultrafast (Settings -> Model -> Main model -> Speed), `text_verbosity`, per-model `context_length`, `supports_vision`, `prompt_caching`, `answer_in_reasoning`.
- **Auxiliary models** (configuring-models.md): "two kinds of model slots": Main + Auxiliary. 11 slots listed in the doc: vision, compression, approval, title_generation, tts_audio_tags, voice_chat, triage_specifier, kanban_decomposer, profile_describer, curator, (skills hub, mcp, web_extract per older table); plus `delegation` (subagents) in its own `delegation.*` block. Default `provider: auto, model: ''` = use the main model; override per task = provider + model (+ per-task `reasoning_effort`, `fallback_chain`). "Never guesses a provider you did not configure": with a main provider and no fallback, the side task is skipped with a warning rather than billed elsewhere. UI: "Show auxiliary" panel, **Change** per row opens the same picker, **Reset all to auto**, "Use as" dropdown on any model card (assign to main / all aux / one task). Desktop warns when the main model switches provider while aux tasks stay pinned to another provider.
- Named aliases: `model_aliases:` (`fav: {model, provider, base_url?, key_env?}`) usable as `/model fav` or `hermes chat --model fav`.

## 5. Defaults, switching, fallbacks

- Default = `model.provider` + `model.default` (+ `base_url`, `api_mode`) in `config.yaml`. Fresh install: `model: ""` sentinel until first `hermes setup`/`hermes model`.
- Precedence: CLI arg (`hermes chat --model X --provider Y`) > config.yaml > .env > built-in.
- Mid-session switching resets prompt cache; docs warn; if live context > 100k tokens (`model.switch_context_confirm_tokens`), a confirmation ("Switch anyway" / "Keep current model"). Also warns for expensive models and data-training tiers (`-contributor` suffix); unattended runs (cron, kanban) fail closed.
- Fallbacks: `fallback_providers: [{provider, model}, ...]` managed by `hermes fallback add|list|remove|clear` (same picker as `hermes model`); Desktop Settings -> Model -> Fallback models. Layers: credential pool (same-provider key rotation, `hermes auth`) first, then cross-provider fallback, then separate aux fallback (`auxiliary.<task>.fallback_chain`). Fallback swaps provider+model mid-session, restored next turn. `fallback.min_switch_reset_seconds` avoids swapping if primary reopens soon.
- Profiles: each profile has its own config/default; Desktop shows an "Applies to" chip row on settings pages with 2+ profiles.

## 6. Recent changes and known confusion

- v0.22.0 "The Threshold Release" (2026-10-14): guided first-launch setup chat on free `nous/welcome` model with "Choose provider later"; one-click Local Models; "A model picker that knows your plans" (stars, subscription-remaining and reset time in picker; reasoning effort chosen "as part of choosing a model in `hermes model`, `/model` (`/model X --reasoning high`) and Desktop"); "No surprise billing - auto-routing never bills a provider you didn't pick"; "Keys stay on their hosts - configured base_url honored everywhere"; Custom Endpoints got API Mode + transport-checking Test; custom endpoint legacy list -> `providers:` dict migration (config v12).
- Open issues that show the friction (NousResearch/hermes-agent):
  - #20582 "Model picker only shows one model for custom providers" (custom provider with `/v1/models` returning several; picker showed only the saved one). Later fixed by persisting discovered catalogs.
  - #134735 custom-endpoint probes with 5s budgets hide slow-catalog providers from the picker (probe timeouts are a real failure mode).
  - #130410 `hermes model` keeps the previous endpoint's API key after switching to another custom endpoint (stale credentials when provider and model share `model:` block).
  - #15267 picker lists providers without credentials (feature request: hide unconfigured). Now handled in Desktop/dashboard (authenticated only); CLI `hermes model` still lists all, because that is where you add them.
  - #117325 Desktop settings do not show which profile/bot they apply to (keys/custom endpoints "vanish on bot switch") -> led to the "Applies to" chip.
  - #57547 custom endpoint puts API key inside config.yaml (leak into context) -> wizard now writes key to `.env` and references `${VAR}`.
- Docs tell users repeatedly "`hermes model` vs `/model`" (three separate warnings), "Main model didn't change in my running chat", "No authenticated providers in the picker", "I picked a model but Hermes switched providers on me": the places where provider/model split still confuses.

## What lophn could take

1. **Make a custom provider own its model list.** Give a custom provider (a) "Test" that probes `/v1/models` and shows "Found N models" and (b) the persisted discovered list, (c) a free-typed "Add model id" fallback, (d) an optional manual list with a "don't discover" toggle. Treat models.dev only as optional metadata (context, vision, reasoning) for known ids, never as the gate for what is selectable. Hermes: `discover_models`, `models`, `catalog_provider`, "Add custom model...".
2. **Keep Providers (connect) and Model (choose) as separate settings pages, but put "Add provider" inside every model picker** and show only connected providers there, with an empty state "No connected providers" linking to Settings -> Providers. This is Hermes' Desktop layout (Providers: Accounts/API keys/Custom endpoints; Model: Main/Aux/Fallbacks) and its picker's `addProvider` row.
3. **One-step "connect then pick a model"** after saving a provider (custom form has "Default Model" dropdown filled by Test, plus "Use for new chats"), so a new provider is never left with zero models and no obvious next step. Hermes' CLI does connect -> model -> effort in one flow.
4. **Separate "default" from "this conversation".** Hermes: the composer picker is sticky/per-chat and never writes the default; only Settings -> Model writes the default; first-ever pick on an empty profile persists. Maps cleanly to lophn's Default model, agent definition Model, per-conversation picker (decide precedence explicitly: conversation > agent definition > default).
5. **Model options live with the model pick**: ask reasoning effort right after selecting a model (hidden if the model has no reasoning control) and show it as a pill next to the picker; allow per-model remembered options.
6. **Per-task models as "auto = use main"** with a Reset-all button, and a warning when the main model moves to another provider while task models stay pinned elsewhere; never silently fall through to a different connected provider (cost surprise). Relevant to lophn's agent-definition Model field.
7. Store non-secret provider definition and secret separately and reference the secret (`api_key: ${VAR}` / `key_env`) so config can be shown to agents without leaking the key.

## What not to copy

- Surface sprawl: `hermes model`, `hermes setup`, `hermes auth`, `hermes fallback`, `/model`, dashboard, Desktop, `config set` all write overlapping state; the docs need three warnings to explain `hermes model` vs `/model`. Pick one place to connect, one to choose.
- Config duplication of the same endpoint (`model.base_url`/`api_key` AND `providers.<name>`), legacy `custom_providers` list, `OPENAI_BASE_URL` env fallbacks, alias keys (`default`/`model`, `base_url`/`url`/`api`): produced stale-key bugs (#130410) and migrations. lophn's no-compat rule makes this avoidable: one provider record, one model reference `{provider, model}`.
- Selection-by-string syntax (`custom:work:llama3`, `zai:glm-5`, bare model names resolving "within the aggregator first" -> "Hermes switched providers on me"). Always store provider id and model id as two fields.
- Huge knob surface per provider (`extra_body`, `session_affinity_header`, `key_cmd`, `answer_in_reasoning`, ...): prototype does not need it; add `extra_headers`/`extra_body` only when a real endpoint demands it.
- Live probing in the picker's hot path (timeouts #134735); probe on Test/Save and cache, refresh on explicit action.
