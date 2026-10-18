# mi-shell

- 단위: mi-shell (wave 2)
- 선행: mi-core
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/model-picker/**`
  - `packages/shell/renderer/conversation/{agent-tab-core-source-model,agent-tab-core-source,agent-tab-fake-source,agent-tab-fake-models,agent-tab-source}.ts`
  - `packages/shell/renderer/workspace/agents/**`
  - `packages/shell/renderer/desktop/settings/providers/manage-models-host.tsx`
  - `packages/shell/renderer/icons/**`
  - `packages/design/wording/catalog/conversation.ts` and its regenerated `*.placeholders.ts` (run `deno task wording`; never hand-edit placeholders)

## The task

Let the person see model info in Manage models and enter it for custom provider models, using the protocol that mi-core added. Follow the plan README "정한 것" and the roadmap `project-docs/products/roadmap/model-info.md` section "4. shell" exactly. Follow `.claude/skills/ui-design/SKILL.md` and `.claude/skills/wording/SKILL.md`.

Work, in this order:

1. Data (`workspace/agents/{source,core-source,fake-source,model-picker-data}.ts`, `model-picker/types.ts`, host): read the user model info (with its `seq`), save one, remove one. Drop the old add-name path (`addModelName` / `addReportedModel` appending to `reported_models`) and anything only it used, including its test. The Manage models view gets, per model, the catalog entry (or none) and whether the person may edit it (custom provider).
2. Icons: a new map `packages/shell/renderer/icons/model.ts` (registered in `icons/mod.ts`) for media: text `Type`, image `Image`, audio `AudioLines`, video `Video`, pdf `FileText`. Screens import the map, not lucide.
3. Manage models rows (`model-picker/manage-models.tsx`): every model row shows the model's input media as small icons (each with a tooltip/accessible name) and its context limit in short form (e.g. `128K`, `1M`) when known; nothing when unknown. Catalog models are read only.
4. Custom provider groups: replace the add-name field with an [Add model] button that opens the model info form empty. Every model row of a custom provider gets an [Edit] action in the fixed right column (before the toggle) that opens the form filled from its user info, or with only the name when it has none.
5. Model info form (a Dialog over the Manage models window, new component next to it):
   - Model name: required, sent as is; read only when editing.
   - Context, input, output limit: number inputs; blank means default, shown as a gray placeholder (131072, "same as context", 4096).
   - Tool support: Switch, on for a new model.
   - Input media and output media: five icon toggles each (`aria-pressed` buttons like `OptionAxes`); text is on and locked.
   - Reasoning effort: a Switch. When on, toggle chips for the seven effort values (weak to strong) and a Select for the default (a "model default" option plus the chosen values). At least one value when on.
   - Prices: input, output, cache read, cache write, USD per 1M tokens; blank means unknown, `0` means free.
   - A help line: lophn sends only text and images today; other media are stored and shown.
   - [Remove model] (editing only), [Cancel], [Save]. A stale `seq` conflict reloads and shows one line in the form; nothing is lost from the form.
6. The picker needs no new UI: check that a user entry's effort axis shows through the existing `OptionAxes` and that choosing it saves.
7. Fake sources: a custom provider with one model that has user info (image input, effort low/medium/high/maximum with default high, prices) and one reported model without info, so gallery pages can show both.
8. Remove now-unused CSS, wording keys and exports. `tools/wireframes`: compile fixes only (another task builds pages).

No new tests unless something risky appears (`.claude/skills/write-test`).

Checks: `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`, `deno task wording --check`, `deno task wireframes`, two core boots.
