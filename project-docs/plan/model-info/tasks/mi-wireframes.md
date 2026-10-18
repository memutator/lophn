# mi-wireframes

- 단위: mi-wireframes (wave 3)
- 선행: mi-shell
- 소유(이 task만 고친다):
  - `tools/wireframes/**`
  - `packages/shell/renderer/workspace/agents/fake-source.ts` (additions only)

## The task

Add gallery pages for the model info work so the person can review it. Use only real components (ui-kit rules, `tools/check-kit.ts`). Follow the existing Manage models entries in `tools/wireframes/pages/screens/agent.tsx` and `agent-pages.tsx`.

Pages (ids start with `new-model-info-`):
- Manage models with built-in and custom providers: media icons and context on rows, [Edit] on custom rows, [Add model].
- Model info form, new model (empty, placeholders visible).
- Model info form, editing a model with image input, effort on (low/medium/high/maximum, default high) and prices.
- Model info form after a stale save (the conflict line).
- Model picker on that custom model, showing its effort axis.

Register the pages in `tools/wireframes/pages/index.ts`. Checks: `deno task wireframes`, `deno task check`. Report each page id.
